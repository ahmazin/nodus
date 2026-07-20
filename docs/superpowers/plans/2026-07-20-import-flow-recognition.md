# Smoother Import Flow + Better Per-Type Recognition — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make importing smoother (one auto-detecting entry point with a pre-commit preview) and sharpen recognition per type (Terraform reference-based edges, Kubernetes YAML input + skip reporting).

**Architecture:** "Analysis-first." Each parser package gains a rich `analyzeX()` that returns `{ records, skipped, notes }`; the existing `fromTerraform`/`fromKubernetes`/`fromMermaid` become thin, non-breaking wrappers. The example app adds `import-analyze.ts` (content-shape `detectImportFormat` + an `analyzeImport` orchestrator returning one `ImportAnalysis`), and the import modal becomes analysis-driven (detected-format badge, `N nodes · M edges · K skipped`, real parser errors, parse-on-type), committing already-parsed records in one undo entry.

**Tech Stack:** TypeScript (strict), pnpm workspace, Vitest (node env), `@nodus/core` signals/store, `@nodus/preset-infra` `modelToRecords`, `@nodus/preset-diagrams` builders, the `yaml` npm package (v2), React 18 (example app), playwright-core (browser verify).

## Global Constraints

- **Static gate is `pnpm typecheck`** (tsc `--strict` + `noUncheckedIndexedAccess`). There is **no lint step**. Run it after every task.
- **Tests run under `environment: 'node'` (no jsdom).** `test.include` is `packages/**/*.test.{ts,tsx}` — Task 4 adds one explicit example-app test path to this glob.
- **Source-first dev loop:** packages resolve via `src/index.ts` aliases; no `pnpm build` in the loop.
- **Non-breaking wrappers:** `fromTerraform`, `fromKubernetes`, `fromMermaid` keep working for every existing caller (`import.test.ts`, `sync-infra.tsx`, MCP/CLI). `fromKubernetes` may only *widen* its parameter (`K8sObject[]` → `string | K8sObject[]`).
- **Only one new dependency is allowed:** `yaml` (`^2.4.2`, already resolved in the lockfile), added to `@nodus/import-infra` only. Adding it touches `pnpm-lock.yaml` — flag this to the human before running install.
- **Route diagram mutations through `store.apply` / editor helpers** with `capture: 'immediately'` for a one-undo import. Never mutate records in place.
- **Edge direction convention:** `{ from: dependency, to: dependent }` (matches the existing `depends_on` code).
- **Commit each task** only after its tests pass and `pnpm typecheck` is clean.

---

### Task 1: Terraform reference-based edges (`@nodus/import-infra`)

Infer edges from implicit interpolation references in the `configuration` block (union with `depends_on`), not just `depends_on`. Add `analyzeTerraform()`; make `fromTerraform()` a wrapper.

**Files:**
- Modify: `packages/import-infra/src/index.ts` (Terraform section, ~lines 22–72)
- Test: `packages/import-infra/src/import.test.ts`

**Interfaces:**
- Consumes: `modelToRecords`, `InfraModel` (already imported); `terraformKind` (existing).
- Produces:
  - `interface TerraformAnalysis { records: NodusRecord[]; skipped: { label: string; count: number }[]; notes: string[]; }`
  - `function analyzeTerraform(showJson: unknown): TerraformAnalysis`
  - `function fromTerraform(showJson: unknown): NodusRecord[]` (unchanged signature; now delegates)

- [ ] **Step 1: Write the failing tests**

Add to `packages/import-infra/src/import.test.ts` (inside the existing `describe('terraform import', …)` or a new `describe`):

```ts
import { analyzeTerraform } from '@nodus/import-infra';

// A `terraform show -json` PLAN: nodes come from planned_values, edges from configuration references.
const PLAN = {
  format_version: '1.2',
  planned_values: {
    root_module: {
      resources: [
        { address: 'aws_vpc.main', type: 'aws_vpc', name: 'main' },
        { address: 'aws_subnet.main', type: 'aws_subnet', name: 'main' },
        { address: 'aws_instance.web', type: 'aws_instance', name: 'web' },
        { address: 'aws_db_instance.orders', type: 'aws_db_instance', name: 'orders' },
      ],
    },
  },
  configuration: {
    root_module: {
      resources: [
        { address: 'aws_vpc.main', type: 'aws_vpc', name: 'main', expressions: { cidr_block: { constant_value: '10.0.0.0/16' } } },
        { address: 'aws_subnet.main', type: 'aws_subnet', name: 'main', expressions: { vpc_id: { references: ['aws_vpc.main.id', 'aws_vpc.main'] } } },
        {
          address: 'aws_instance.web', type: 'aws_instance', name: 'web',
          expressions: {
            // nested block reference must be found by the recursive walker
            network_interface: [{ subnet_id: { references: ['aws_subnet.main.id', 'aws_subnet.main'] } }],
            ami: { references: ['data.aws_ami.ubuntu.id', 'data.aws_ami.ubuntu'] }, // data.* → ignored
            key_name: { references: ['var.key_name'] },                             // var.* → ignored
          },
        },
        { address: 'aws_db_instance.orders', type: 'aws_db_instance', name: 'orders', expressions: { vpc_security_group_ids: { references: ['aws_instance.web.id'] } } },
      ],
    },
  },
};

it('infers edges from implicit configuration references (not just depends_on)', () => {
  const { records, notes } = analyzeTerraform(PLAN);
  const ed = new Editor();
  installInfraPreset(ed);
  ed.loadSnapshot({ schemaVersion: 1, document: { records } });
  expect(ed.store.nodes()).toHaveLength(4);
  // vpc→subnet, subnet→web, web→orders. data.* and var.* references create NO edges.
  expect(ed.store.edges()).toHaveLength(3);
  expect(notes).toHaveLength(0); // configuration present → no "state only" note
});

it('unions references with depends_on and de-dups', () => {
  const withDep = structuredClone(PLAN) as typeof PLAN & { planned_values: { root_module: { resources: Array<{ depends_on?: string[] }> } } };
  // orders already gets web→orders via a reference; add the SAME edge via depends_on — must not double.
  (withDep.planned_values.root_module.resources[3] as { depends_on?: string[] }).depends_on = ['aws_instance.web'];
  const { records } = analyzeTerraform(withDep);
  const ed = new Editor();
  installInfraPreset(ed);
  ed.loadSnapshot({ schemaVersion: 1, document: { records } });
  expect(ed.store.edges()).toHaveLength(3); // still 3, not 4
});

it('notes that state-only JSON (no configuration) limits edges to depends_on', () => {
  const stateOnly = { values: { root_module: { resources: [
    { address: 'aws_instance.web', type: 'aws_instance', name: 'web' },
    { address: 'aws_db_instance.orders', type: 'aws_db_instance', name: 'orders', depends_on: ['aws_instance.web'] },
  ] } } };
  const { records, notes } = analyzeTerraform(stateOnly);
  const ed = new Editor();
  installInfraPreset(ed);
  ed.loadSnapshot({ schemaVersion: 1, document: { records } });
  expect(ed.store.edges()).toHaveLength(1);
  expect(notes.join(' ')).toMatch(/state JSON/i);
});

it('resolves references inside a child module', () => {
  const modPlan = {
    planned_values: { root_module: { child_modules: [{
      address: 'module.data',
      resources: [
        { address: 'module.data.aws_subnet.db', type: 'aws_subnet', name: 'db' },
        { address: 'module.data.aws_db_instance.main', type: 'aws_db_instance', name: 'main' },
      ],
    }] } },
    configuration: { root_module: { module_calls: { data: { module: { resources: [
      { address: 'aws_subnet.db', type: 'aws_subnet', name: 'db', expressions: {} },
      { address: 'aws_db_instance.main', type: 'aws_db_instance', name: 'main', expressions: { subnet_id: { references: ['aws_subnet.db.id', 'aws_subnet.db'] } } },
    ] } } } } },
  };
  const { records } = analyzeTerraform(modPlan);
  const ed = new Editor();
  installInfraPreset(ed);
  ed.loadSnapshot({ schemaVersion: 1, document: { records } });
  expect(ed.store.nodes()).toHaveLength(2);
  expect(ed.store.edges()).toHaveLength(1); // module.data.aws_subnet.db → module.data.aws_db_instance.main
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run packages/import-infra/src/import.test.ts -t "configuration references"`
Expected: FAIL — `analyzeTerraform` is not exported (import error / not a function).

- [ ] **Step 3: Implement `analyzeTerraform` + config walker + reference resolver**

In `packages/import-infra/src/index.ts`, replace the current `fromTerraform` (lines ~53–72) and add the helpers above it. Keep `terraformKind`, `TfResource`, `TfModule`, `collectResources` as-is.

```ts
interface TfConfigResource {
  address: string; // module-qualified, non-indexed, e.g. "aws_instance.web" or "module.data.aws_subnet.db"
  expressions?: Record<string, unknown>;
}

interface TfConfigModule {
  resources?: Array<{ address?: string; type?: string; name?: string; expressions?: Record<string, unknown> }>;
  module_calls?: Record<string, { module?: TfConfigModule }>;
}

/** Recursively collect configuration resources, qualifying each address with its module path. */
function collectConfigResources(mod: TfConfigModule | undefined, modulePrefix: string, out: TfConfigResource[]): void {
  if (!mod) return;
  for (const r of mod.resources ?? []) {
    const base = r.address ?? (r.type && r.name ? `${r.type}.${r.name}` : undefined);
    if (!base) continue;
    out.push({ address: modulePrefix ? `${modulePrefix}.${base}` : base, expressions: r.expressions });
  }
  for (const [name, call] of Object.entries(mod.module_calls ?? {})) {
    collectConfigResources(call.module, modulePrefix ? `${modulePrefix}.module.${name}` : `module.${name}`, out);
  }
}

/** Recursively gather every `references: string[]` under an expressions tree (blocks nest arrays/objects). */
function collectReferences(expr: unknown, out: string[]): void {
  if (!expr || typeof expr !== 'object') return;
  if (Array.isArray(expr)) {
    for (const v of expr) collectReferences(v, out);
    return;
  }
  const o = expr as Record<string, unknown>;
  if (Array.isArray(o['references'])) for (const ref of o['references']) if (typeof ref === 'string') out.push(ref);
  for (const [k, v] of Object.entries(o)) {
    if (k === 'references' || k === 'constant_value') continue;
    collectReferences(v, out);
  }
}

// References that never point at a managed resource node.
const IGNORED_REF = /^(var|local|data|each|count|path|self|terraform|module)\./;

/** Resolve a reference to a known managed-resource address (module-relative first, then root), or null. */
function resolveRef(ref: string, modulePrefix: string, known: Set<string>): string | null {
  if (IGNORED_REF.test(ref)) return null;
  const candidates = modulePrefix ? [`${modulePrefix}.${ref}`, ref] : [ref];
  for (const cand of candidates) {
    const segs = cand.split('.');
    for (let len = segs.length; len >= 2; len--) {
      const prefix = segs.slice(0, len).join('.');
      if (known.has(prefix)) return prefix;
    }
  }
  return null;
}

/** Node keys (values addresses) matching a config address: exact, or its count/for_each instances. */
function nodeKeysFor(configAddr: string, nodeKeys: string[]): string[] {
  return nodeKeys.filter((k) => k === configAddr || k.startsWith(`${configAddr}[`));
}

export interface TerraformAnalysis {
  records: NodusRecord[];
  skipped: { label: string; count: number }[];
  notes: string[];
}

export function analyzeTerraform(showJson: unknown): TerraformAnalysis {
  const root = showJson as {
    values?: { root_module?: TfModule };
    planned_values?: { root_module?: TfModule };
    configuration?: { root_module?: TfConfigModule };
  };
  const rootModule = root.values?.root_module ?? root.planned_values?.root_module;
  const resources: TfResource[] = [];
  collectResources(rootModule, resources);

  const nodeKeys = resources.map((r) => r.address);
  const addresses = new Set(nodeKeys);
  const model: InfraModel = {
    nodes: resources.map((r) => ({ key: r.address, type: terraformKind(r.type), label: r.name, x: 0, y: 0 })),
    edges: [],
  };

  const seen = new Set<string>();
  const addEdge = (from: string, to: string): void => {
    if (from === to) return;
    const sig = `${from} ${to}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    model.edges!.push({ from, to });
  };

  // (1) explicit depends_on
  for (const r of resources) {
    for (const dep of r.depends_on ?? []) {
      const target = addresses.has(dep) ? dep : resources.find((o) => dep.startsWith(o.address))?.address;
      if (target) addEdge(target, r.address);
    }
  }

  // (2) implicit interpolation references from the configuration block
  const notes: string[] = [];
  if (root.configuration?.root_module) {
    const configResources: TfConfigResource[] = [];
    collectConfigResources(root.configuration.root_module, '', configResources);
    const known = new Set(configResources.map((c) => c.address));
    for (const c of configResources) {
      const prefix = c.address.split('.').slice(0, -2).join('.'); // strip the trailing type.name
      const refs: string[] = [];
      collectReferences(c.expressions, refs);
      for (const ref of refs) {
        const targetAddr = resolveRef(ref, prefix, known);
        if (!targetAddr) continue;
        for (const fromKey of nodeKeysFor(targetAddr, nodeKeys))
          for (const toKey of nodeKeysFor(c.address, nodeKeys)) addEdge(fromKey, toKey);
      }
    }
  } else {
    notes.push('state JSON — edges limited to depends_on; import a plan (terraform show -json <plan>) for full topology.');
  }

  return { records: modelToRecords(model), skipped: [], notes };
}

export function fromTerraform(showJson: unknown): NodusRecord[] {
  return analyzeTerraform(showJson).records;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run packages/import-infra/src/import.test.ts`
Expected: PASS (new reference/union/note/module tests + the pre-existing `depends_on` and kind tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: clean (no errors).

- [ ] **Step 6: Commit**

```bash
git add packages/import-infra/src/index.ts packages/import-infra/src/import.test.ts
git commit -m "feat(import-infra): infer Terraform edges from implicit references

analyzeTerraform() walks configuration.expressions.references (recursively,
module-aware), unions with depends_on, de-dups; fromTerraform delegates."
```

---

### Task 2: Kubernetes YAML input + skip reporting (`@nodus/import-infra`)

Accept real multi-doc YAML (and JSON) as a string; move input normalization into the package; report skipped kinds. Add `analyzeKubernetes()`; widen + delegate `fromKubernetes()`. Adds the `yaml` dependency.

**Files:**
- Modify: `packages/import-infra/package.json` (add `yaml` dependency)
- Modify: `packages/import-infra/src/index.ts` (Kubernetes section, ~lines 74–146)
- Test: `packages/import-infra/src/import.test.ts`

**Interfaces:**
- Consumes: `parseAllDocuments` from `yaml`; `kubernetesKind`, `modelToRecords`, `InfraModel` (existing).
- Produces:
  - `interface KubernetesAnalysis { records: NodusRecord[]; skipped: { label: string; count: number }[]; notes: string[]; }`
  - `function analyzeKubernetes(input: string | K8sObject[]): KubernetesAnalysis`
  - `function fromKubernetes(input: string | K8sObject[]): NodusRecord[]` (widened param; delegates)

- [ ] **Step 1: Add the dependency**

Edit `packages/import-infra/package.json` — add `"yaml": "^2.4.2"` to `dependencies`:

```json
"dependencies": { "@nodus/core": "workspace:*", "@nodus/preset-infra": "workspace:*", "yaml": "^2.4.2" },
```

Then install (⚠️ mutates `pnpm-lock.yaml`; `yaml@^2.4.2` is already resolved, so this is a minimal lockfile touch — the human approved adding this dep):

Run: `pnpm install`
Expected: completes; `yaml` linked to `@nodus/import-infra`.

- [ ] **Step 2: Write the failing tests**

Add to `packages/import-infra/src/import.test.ts`:

```ts
import { analyzeKubernetes } from '@nodus/import-infra';

const YAML_MANIFEST = `
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: { name: web }
spec:
  rules:
    - http:
        paths:
          - backend: { service: { name: orders-svc } }
---
apiVersion: v1
kind: Service
metadata: { name: orders-svc }
spec:
  selector: { app: orders }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: orders }
spec:
  template:
    metadata:
      labels: { app: orders }
---
apiVersion: v1
kind: ConfigMap
metadata: { name: cfg }
---
apiVersion: v1
kind: Secret
metadata: { name: creds }
`;

it('imports multi-doc YAML and reports skipped kinds', () => {
  const { records, skipped } = analyzeKubernetes(YAML_MANIFEST);
  const ed = new Editor();
  installInfraPreset(ed);
  ed.loadSnapshot({ schemaVersion: 1, document: { records } });
  expect(ed.store.nodes()).toHaveLength(3); // Ingress, Service, Deployment
  expect(ed.store.edges().length).toBeGreaterThanOrEqual(2); // Ingress→Service, Service→Deployment
  expect(skipped).toEqual(expect.arrayContaining([
    { label: 'ConfigMap', count: 1 },
    { label: 'Secret', count: 1 },
  ]));
});

it('accepts a kind:List and a single object, and matches array input', () => {
  const list = JSON.stringify({ kind: 'List', items: [
    { kind: 'Deployment', metadata: { name: 'a' } },
    { kind: 'Service', metadata: { name: 'a-svc' }, spec: { selector: {} } },
  ] });
  expect(analyzeKubernetes(list).records.filter((r) => r.typeName === 'node')).toHaveLength(2);

  const single = analyzeKubernetes('{ "kind": "Deployment", "metadata": { "name": "solo" } }');
  expect(single.records.filter((r) => r.typeName === 'node')).toHaveLength(1);

  // string vs pre-parsed array parity (the existing array path must still work)
  const arr = [{ kind: 'Deployment', metadata: { name: 'solo' } }];
  expect(analyzeKubernetes(arr).records.length).toBe(single.records.length);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm exec vitest run packages/import-infra/src/import.test.ts -t "YAML"`
Expected: FAIL — `analyzeKubernetes` not exported.

- [ ] **Step 4: Implement YAML normalization + `analyzeKubernetes`**

In `packages/import-infra/src/index.ts`: add `import { parseAllDocuments } from 'yaml';` at the top with the other imports. Keep `kubernetesKind`, `K8sObject`, `labelsMatch`, `workloadLabels`. Replace `fromKubernetes` (lines ~111–146) with:

```ts
/** Normalize string (YAML/JSON, multi-doc) or a pre-parsed array into a flat list of manifest objects. */
function toK8sObjects(input: string | K8sObject[]): K8sObject[] {
  const raw: unknown[] = typeof input === 'string'
    ? parseAllDocuments(input).map((d) => d.toJS()).filter((v) => v != null)
    : input;
  const objs: K8sObject[] = [];
  for (const doc of raw) {
    if (Array.isArray(doc)) objs.push(...(doc as K8sObject[]));
    else if (doc && (doc as { kind?: string }).kind === 'List' && Array.isArray((doc as { items?: unknown[] }).items))
      objs.push(...((doc as { items: K8sObject[] }).items));
    else if (doc) objs.push(doc as K8sObject);
  }
  return objs.filter((o) => o && typeof o === 'object' && typeof o.kind === 'string');
}

export interface KubernetesAnalysis {
  records: NodusRecord[];
  skipped: { label: string; count: number }[];
  notes: string[];
}

export function analyzeKubernetes(input: string | K8sObject[]): KubernetesAnalysis {
  const objects = toK8sObjects(input);
  const nodes: InfraModel['nodes'] = [];
  const edges: NonNullable<InfraModel['edges']> = [];
  const byName = new Map<string, K8sObject>();
  const skipCounts = new Map<string, number>();
  const keyOf = (o: K8sObject) => `${o.kind}/${o.metadata?.name ?? '?'}`;

  for (const o of objects) {
    const type = kubernetesKind(o.kind);
    if (!type) {
      skipCounts.set(o.kind, (skipCounts.get(o.kind) ?? 0) + 1);
      continue;
    }
    nodes.push({ key: keyOf(o), type, label: o.metadata?.name ?? o.kind, x: 0, y: 0 });
    byName.set(o.metadata?.name ?? '', o);
  }
  const included = new Set(nodes.map((n) => n.key));

  for (const o of objects) {
    if (o.kind === 'Ingress') {
      const rules = (o.spec?.rules as Array<{ http?: { paths?: Array<{ backend?: { serviceName?: string; service?: { name?: string } } }> } }>) ?? [];
      for (const rule of rules)
        for (const path of rule.http?.paths ?? []) {
          const svc = path.backend?.serviceName ?? path.backend?.service?.name;
          const target = svc && byName.get(svc);
          if (target && included.has(keyOf(o)) && included.has(keyOf(target))) edges.push({ from: keyOf(o), to: keyOf(target) });
        }
    } else if (o.kind === 'Service') {
      const selector = (o.spec?.selector as Record<string, string>) ?? {};
      if (Object.keys(selector).length === 0) continue;
      for (const w of objects) {
        if (kubernetesKind(w.kind) === null || w.kind === 'Service' || w.kind === 'Ingress') continue;
        if (labelsMatch(selector, workloadLabels(w)) && included.has(keyOf(w))) edges.push({ from: keyOf(o), to: keyOf(w) });
      }
    }
  }

  const skipped = [...skipCounts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  const notes: string[] = [];
  if (nodes.length === 0) notes.push('No workloads, services, or ingress found to import.');
  return { records: modelToRecords({ nodes, edges }), skipped, notes };
}

export function fromKubernetes(input: string | K8sObject[]): NodusRecord[] {
  return analyzeKubernetes(input).records;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run packages/import-infra/src/import.test.ts`
Expected: PASS (new YAML/List/single/parity tests + all pre-existing K8s + Terraform tests — the old `fromKubernetes(objects)` array test still passes).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/import-infra/package.json packages/import-infra/src/index.ts packages/import-infra/src/import.test.ts pnpm-lock.yaml
git commit -m "feat(import-infra): accept Kubernetes YAML + report skipped kinds

analyzeKubernetes() parses multi-doc YAML/JSON (adds the yaml dep),
normalizes array/List/single input, counts unmapped kinds; fromKubernetes
widens to string | objects and delegates."
```

---

### Task 3: Mermaid skipped-line count (`@nodus/from-mermaid`)

Add a `skipped` count so the preview can show unrecognized flowchart lines. Surgical, non-behavior-changing (only counts; parses exactly as before). Scoped to the flowchart parser (the dominant case); state/ER report `0` in v1.

**Files:**
- Modify: `packages/from-mermaid/src/index.ts` (`ParsedMermaid`, `parseFlowchart`, `fromMermaid`)
- Test: `packages/from-mermaid/src/from-mermaid.test.ts`

**Interfaces:**
- Produces: `ParsedMermaid` gains `skipped: number`; `parseFlowchart` returns `{ steps, links, skipped }` (extra field ignored by `buildFlowchart`).

- [ ] **Step 1: Write the failing test**

Add to `packages/from-mermaid/src/from-mermaid.test.ts`:

```ts
it('reports skipped (unrecognized) flowchart lines', () => {
  const { skipped } = fromMermaid('flowchart LR\n  A[Web] --> B[(DB)]\n  %% comment stripped\n  @@@ not a statement');
  expect(skipped).toBe(1); // the "@@@" line is unparseable; comment is stripped, A/B parse fine
});

it('reports zero skipped for a clean flowchart', () => {
  expect(fromMermaid('flowchart LR\n A --> B').skipped).toBe(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/from-mermaid/src/from-mermaid.test.ts -t "skipped"`
Expected: FAIL — `skipped` is `undefined` (`ParsedMermaid` has no such field).

- [ ] **Step 3: Implement the counter**

In `packages/from-mermaid/src/index.ts`:

(a) Extend the return type (`ParsedMermaid`, ~line 29):

```ts
export interface ParsedMermaid {
  kind: MermaidKind;
  direction: Direction;
  records: NodusRecord[];
  /** Count of body statements that matched no rule (flowchart only in v1; 0 for state/er). */
  skipped: number;
}
```

(b) In `parseFlowchart` (~lines 201–223): add a counter and increment when a statement yields nothing (but not for recognized structural keywords):

```ts
function parseFlowchart(lines: string[]): { steps: FlowStep[]; links: FlowLink[]; skipped: number } {
  const steps = new Map<string, FlowStep>();
  const links: FlowLink[] = [];
  let skipped = 0;
  const note = (t: NodeTok): void => {
    const existing = steps.get(t.id);
    if (!existing) steps.set(t.id, { id: t.id, kind: t.kind, label: t.label });
    else if (existing.label === existing.id && t.label !== t.id) steps.set(t.id, { id: t.id, kind: t.kind, label: t.label });
  };
  for (const line of bodyStatements(lines)) {
    if (/^(subgraph|end|direction|class|classDef|style|linkStyle|click)\b/i.test(line)) continue;
    const parsed = parseFlowStatement(line);
    if (!parsed || parsed.nodes.length === 0) {
      skipped++;
      continue;
    }
    for (const n of parsed.nodes) note(n);
    for (let i = 0; i < parsed.links.length; i++) {
      const from = parsed.nodes[i]!;
      const to = parsed.nodes[i + 1]!;
      const l = parsed.links[i]!;
      links.push(l.label ? { from: from.id, to: to.id, label: l.label } : { from: from.id, to: to.id });
    }
  }
  return { steps: [...steps.values()], links, skipped };
}
```

(c) In `fromMermaid` (~lines 353–366): thread `skipped` through:

```ts
export function fromMermaid(src: string): ParsedMermaid {
  const lines = cleanLines(src);
  if (lines.length === 0) throw new Error('fromMermaid: empty source');
  const kind = detectKind(lines[0]!);
  if (!kind) throw new Error(`fromMermaid: unrecognized diagram header "${lines[0]}" (expected graph/flowchart, stateDiagram, or erDiagram)`);
  const direction = kind === 'flowchart' ? readDirection(lines[0]!) : 'TB';

  let records: NodusRecord[];
  let skipped = 0;
  if (kind === 'flowchart') {
    const parsed = parseFlowchart(lines);
    records = buildFlowchart(parsed);
    skipped = parsed.skipped;
  } else if (kind === 'state') records = buildStateMachine(parseStateDiagram(lines));
  else records = buildERD(parseERDiagram(lines));

  return { kind, direction, records, skipped };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run packages/from-mermaid/src/from-mermaid.test.ts`
Expected: PASS (new `skipped` tests + all existing parser tests; `buildFlowchart` ignores the extra field).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/from-mermaid/src/index.ts packages/from-mermaid/src/from-mermaid.test.ts
git commit -m "feat(from-mermaid): report skipped flowchart lines (ParsedMermaid.skipped)"
```

---

### Task 4: App analysis contract + format detection (`examples/browser`)

Add the app-level `ImportAnalysis` contract, `detectImportFormat` (content-shape), and `analyzeImport` (orchestrator). Unit-test the pure logic under vitest by adding its one test file to the include glob.

**Files:**
- Create: `examples/browser/src/import-analyze.ts`
- Create: `examples/browser/src/import-analyze.test.ts`
- Modify: `vitest.config.ts` (add the one example test path to `test.include`)

**Interfaces:**
- Consumes: `fromMermaid` (`@nodus/from-mermaid`); `analyzeTerraform`, `analyzeKubernetes` (`@nodus/import-infra`, Tasks 1–2); `isNode`, `isEdge`, `NodusRecord` (`@nodus/core`); `ParsedMermaid.skipped` (Task 3).
- Produces:
  - `type ImportFormat = 'mermaid' | 'terraform' | 'kubernetes'`
  - `interface ImportAnalysis { format: ImportFormat; records: NodusRecord[]; nodeCount: number; edgeCount: number; skipped: { label: string; count: number }[]; notes: string[]; error: string | null; }`
  - `function detectImportFormat(text: string): ImportFormat | null`
  - `function analyzeImport(text: string, format: ImportFormat): ImportAnalysis`

- [ ] **Step 1: Widen the vitest include glob**

In `vitest.config.ts`, change the `include` line to also pick up this one example test file:

```ts
    include: ['packages/**/*.test.{ts,tsx}', 'examples/browser/src/import-analyze.test.ts'],
```

- [ ] **Step 2: Write the failing tests**

Create `examples/browser/src/import-analyze.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { detectImportFormat, analyzeImport } from './import-analyze';

describe('detectImportFormat', () => {
  it('detects mermaid by header', () => {
    expect(detectImportFormat('flowchart LR\n A --> B')).toBe('mermaid');
    expect(detectImportFormat('  stateDiagram-v2\n [*] --> On')).toBe('mermaid');
    expect(detectImportFormat('erDiagram\n A ||--o{ B : has')).toBe('mermaid');
  });
  it('detects terraform by JSON shape', () => {
    expect(detectImportFormat('{"values":{"root_module":{"resources":[]}}}')).toBe('terraform');
    expect(detectImportFormat('{"planned_values":{"root_module":{}},"configuration":{}}')).toBe('terraform');
  });
  it('detects kubernetes from JSON and from YAML', () => {
    expect(detectImportFormat('{"kind":"Deployment","apiVersion":"apps/v1"}')).toBe('kubernetes');
    expect(detectImportFormat('[{"kind":"Service","apiVersion":"v1"}]')).toBe('kubernetes');
    expect(detectImportFormat('apiVersion: v1\nkind: Service\nmetadata:\n  name: x')).toBe('kubernetes');
  });
  it('returns null for unknown content', () => {
    expect(detectImportFormat('just some prose')).toBeNull();
    expect(detectImportFormat('')).toBeNull();
  });
});

describe('analyzeImport', () => {
  it('summarizes a terraform paste (nodes, edges, notes)', () => {
    const a = analyzeImport('{"values":{"root_module":{"resources":[{"address":"aws_instance.web","type":"aws_instance","name":"web"}]}}}', 'terraform');
    expect(a.error).toBeNull();
    expect(a.nodeCount).toBe(1);
    expect(a.notes.join(' ')).toMatch(/state JSON/i); // no configuration block
  });
  it('summarizes a kubernetes YAML paste with skipped kinds', () => {
    const a = analyzeImport('apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: c', 'kubernetes');
    expect(a.nodeCount).toBe(0);
    expect(a.skipped).toEqual([{ label: 'ConfigMap', count: 1 }]);
  });
  it('returns a real error (not a throw) for malformed input', () => {
    const a = analyzeImport('{ not json', 'terraform');
    expect(a.error).toMatch(/JSON/i);
    expect(a.records).toHaveLength(0);
  });
  it('summarizes mermaid and counts nodes', () => {
    const a = analyzeImport('flowchart LR\n A[Web] --> B[(DB)]', 'mermaid');
    expect(a.error).toBeNull();
    expect(a.nodeCount).toBe(2);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm exec vitest run examples/browser/src/import-analyze.test.ts`
Expected: FAIL — `./import-analyze` does not exist.

- [ ] **Step 4: Implement `import-analyze.ts`**

Create `examples/browser/src/import-analyze.ts`:

```ts
/**
 * Import analysis — one contract behind the smoother import flow. `detectImportFormat` sniffs the
 * pasted content's shape (no full parse for the common cases); `analyzeImport` parses for a known
 * format and returns a preview summary (counts + skipped + notes) or a real parser error — never
 * throwing. The modal renders this before anything is committed to the canvas.
 */
import { isEdge, isNode, type NodusRecord } from '@nodus/core';
import { fromMermaid } from '@nodus/from-mermaid';
import { analyzeKubernetes, analyzeTerraform } from '@nodus/import-infra';

export type ImportFormat = 'mermaid' | 'terraform' | 'kubernetes';

export interface ImportAnalysis {
  format: ImportFormat;
  records: NodusRecord[];
  nodeCount: number;
  edgeCount: number;
  skipped: { label: string; count: number }[];
  notes: string[];
  /** Real parser message; when set, records is [] and the modal disables Import. */
  error: string | null;
}

const MERMAID_HEADER = /^(graph|flowchart|stateDiagram(-v2)?|erDiagram)\b/i;

function looksLikeTerraform(o: unknown): boolean {
  if (!o || typeof o !== 'object') return false;
  const r = o as Record<string, unknown>;
  const hasRoot = (m: unknown): boolean => !!m && typeof m === 'object' && 'root_module' in (m as object);
  return hasRoot(r['values']) || hasRoot(r['planned_values']) || Array.isArray(r['resource_changes']) ||
    (('terraform_version' in r || 'format_version' in r) && 'configuration' in r);
}

function looksLikeKubernetes(o: unknown): boolean {
  const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object';
  if (Array.isArray(o)) return o.some((x) => isObj(x) && typeof x['kind'] === 'string');
  if (!isObj(o)) return false;
  if (o['kind'] === 'List' && Array.isArray(o['items'])) return true;
  return typeof o['kind'] === 'string' && typeof o['apiVersion'] === 'string';
}

/** Content-shape detection: mermaid header, else JSON shape, else a YAML k8s sniff. */
export function detectImportFormat(text: string): ImportFormat | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const firstLine = trimmed.split('\n', 1)[0]!.trim();
  if (MERMAID_HEADER.test(firstLine)) return 'mermaid';

  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    obj = undefined;
  }
  if (obj !== undefined) {
    if (looksLikeTerraform(obj)) return 'terraform';
    if (looksLikeKubernetes(obj)) return 'kubernetes';
    return null;
  }
  // Not JSON, not a mermaid header → maybe YAML manifest(s). Terraform show -json is always JSON.
  if (/^\s*kind:\s*\S+/m.test(text) && /^\s*apiVersion:\s*\S+/m.test(text)) return 'kubernetes';
  return null;
}

function humanError(format: ImportFormat, e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (format === 'terraform') return `Couldn't read that Terraform JSON — ${msg}`;
  if (format === 'kubernetes') return `Couldn't read those Kubernetes manifests — ${msg}`;
  return msg; // fromMermaid already throws a descriptive header/syntax message
}

/** Parse `text` as a KNOWN format and summarize. Never throws — parse failure → { error }. */
export function analyzeImport(text: string, format: ImportFormat): ImportAnalysis {
  try {
    let records: NodusRecord[];
    let skipped: { label: string; count: number }[] = [];
    let notes: string[] = [];
    if (format === 'mermaid') {
      const parsed = fromMermaid(text);
      records = parsed.records;
      if (parsed.skipped > 0) skipped = [{ label: 'unrecognized line', count: parsed.skipped }];
    } else if (format === 'terraform') {
      const a = analyzeTerraform(JSON.parse(text));
      ({ records, skipped, notes } = a);
    } else {
      const a = analyzeKubernetes(text);
      ({ records, skipped, notes } = a);
    }
    return {
      format,
      records,
      nodeCount: records.filter(isNode).length,
      edgeCount: records.filter(isEdge).length,
      skipped,
      notes,
      error: null,
    };
  } catch (e) {
    return { format, records: [], nodeCount: 0, edgeCount: 0, skipped: [], notes: [], error: humanError(format, e) };
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run examples/browser/src/import-analyze.test.ts`
Expected: PASS (all detect + analyze cases).

- [ ] **Step 6: Full suite + typecheck (nothing regressed)**

Run: `pnpm exec vitest run` then `pnpm typecheck`
Expected: whole suite PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts examples/browser/src/import-analyze.ts examples/browser/src/import-analyze.test.ts
git commit -m "feat(example): import analysis contract — detectImportFormat + analyzeImport"
```

---

### Task 5: Analysis-driven modal, unified entry, preview (`examples/browser`)

Turn the modal into an analysis-driven preview (detected-format badge + override, live `N nodes · M edges · K skipped` + notes + real error), add a single auto-detecting `Import…` entry (keeping the three format-locked ones), collapse `runImportText` to commit already-parsed records, and extend the browser verify.

**Files:**
- Modify: `examples/browser/src/import-editor.tsx`
- Modify: `examples/browser/src/main.tsx` (import state, entry points, commit handler, render)
- Modify: `scripts/verify-import.mjs`

**Interfaces:**
- Consumes: `ImportFormat`, `ImportAnalysis`, `detectImportFormat`, `analyzeImport` (Task 4); `installDiagrams` (`@nodus/preset-diagrams`); existing `runImport`, `editor`.
- Produces: new `ImportEditor` props `{ editor, open, initialFormat?, detect, analyze, onClose, onImport }`; `onImport: (analysis: ImportAnalysis) => void`.

- [ ] **Step 1: Rewrite `ImportEditor` to be analysis-driven**

Replace `examples/browser/src/import-editor.tsx` with (keeps `data-testid`/`data-format` the existing verify relies on; adds badge/override/summary testids):

```tsx
/**
 * Import editor — an analysis-driven code editor for pasting Mermaid / Terraform / Kubernetes sources.
 * Detects the format from the pasted content (overridable), previews "N nodes · M edges · K skipped"
 * plus the real parser error BEFORE anything is committed, and hands the parsed ImportAnalysis to the
 * host via onImport. Monospace, line-numbered, with a Format/Tidy button.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@nodus/core';
import { useUiTokens } from '@nodus/react';
import type { ImportAnalysis, ImportFormat } from './import-analyze';

const META: Record<ImportFormat, { title: string; hint: string; placeholder: string; json: boolean }> = {
  mermaid: { title: 'Mermaid', hint: 'flowchart · stateDiagram · erDiagram', placeholder: 'flowchart LR\n  A[Web] --> B[(Postgres)]\n  A --> C{Redis}', json: false },
  terraform: { title: 'Terraform', hint: 'terraform show -json (state or plan)', placeholder: '{\n  "values": { "root_module": { "resources": [ … ] } }\n}', json: true },
  kubernetes: { title: 'Kubernetes', hint: 'YAML or JSON — manifests, a List, or one object', placeholder: 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web', json: false },
};
const FORMATS: ImportFormat[] = ['mermaid', 'terraform', 'kubernetes'];

export interface ImportEditorProps {
  editor: Editor;
  open: boolean;
  /** When opened from a format-locked command; omit for auto-detect. */
  initialFormat?: ImportFormat;
  detect: (text: string) => ImportFormat | null;
  analyze: (text: string, format: ImportFormat) => ImportAnalysis;
  onClose: () => void;
  onImport: (analysis: ImportAnalysis) => void;
}

export function ImportEditor({ editor, open, initialFormat, detect, analyze, onClose, onImport }: ImportEditorProps): JSX.Element | null {
  const t = useUiTokens(editor);
  const [text, setText] = useState('');
  const [override, setOverride] = useState<ImportFormat | 'auto'>('auto');
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setText('');
      setAnalysis(null);
      setBusy(false);
      setOverride(initialFormat ?? 'auto');
      const id = setTimeout(() => taRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [open, initialFormat]);

  const resolved: ImportFormat | null = override === 'auto' ? detect(text) : override;

  // Parse-on-type (debounced): analyze when we have text and a resolved format.
  useEffect(() => {
    if (!open) return undefined;
    const id = setTimeout(() => {
      if (text.trim() && resolved) setAnalysis(analyze(text, resolved));
      else setAnalysis(null);
    }, 200);
    return () => clearTimeout(id);
  }, [open, text, resolved, analyze]);

  const meta = resolved ? META[resolved] : null;
  const lineCount = text.length ? text.split('\n').length : 1;
  const canImport = !!analysis && !analysis.error && analysis.nodeCount > 0 && !busy;

  const doFormat = (): void => {
    if (meta?.json) {
      try {
        setText(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        /* leave as-is; the summary already shows the parse error */
      }
    } else {
      setText(text.split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, ''));
    }
  };

  const submit = (): void => {
    if (!canImport || !analysis) return;
    setBusy(true);
    onImport(analysis);
    setBusy(false);
    onClose();
  };

  if (!open) return null;

  const barBtn: CSSProperties = { height: 28, padding: '0 11px', borderRadius: t.radius.sm, border: `1px solid ${t.color.borderStrong}`, background: 'transparent', color: t.color.textMuted, fontFamily: t.font.family, fontSize: '12px', cursor: 'pointer' };
  const chip: CSSProperties = { fontFamily: t.font.mono, fontSize: '11px', padding: '2px 7px', borderRadius: t.radius.sm, border: `1px solid ${t.color.border}`, color: t.color.textMuted };

  return createPortal(
    <div
      onPointerDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,9,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
    >
      <div
        data-testid="import-modal"
        data-format={resolved ?? 'unknown'}
        role="dialog"
        aria-label="Import diagram"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) onClose();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
        }}
        style={{ width: 'min(680px, 94vw)', maxHeight: '88vh', background: t.color.panel, border: `1px solid ${t.color.borderStrong}`, borderRadius: t.radius.lg, boxShadow: t.shadow.popover, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        {/* header: title + format segmented control (auto badge) + Format button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: t.font.size.lg, fontWeight: 600, color: t.color.text }}>Import</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              data-testid="import-format-auto"
              onClick={() => setOverride('auto')}
              style={{ ...chip, cursor: 'pointer', ...(override === 'auto' ? { borderColor: t.color.accent, color: t.color.text } : {}) }}
            >
              {override === 'auto' && resolved ? `auto · ${META[resolved].title}` : 'auto'}
            </button>
            {FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                data-testid={`import-format-${f}`}
                onClick={() => setOverride(f)}
                style={{ ...chip, cursor: 'pointer', ...(override === f ? { borderColor: t.color.accent, color: t.color.text } : {}) }}
              >
                {META[f].title}
              </button>
            ))}
          </div>
          <span data-testid="import-detected" style={{ fontFamily: t.font.mono, fontSize: '11px', color: t.color.textFaint }}>{meta?.hint ?? 'paste to detect…'}</span>
          <button type="button" data-testid="import-format" onClick={doFormat} disabled={!meta} style={{ ...barBtn, marginLeft: 'auto' }}>
            {meta?.json ? 'Format JSON' : 'Tidy'}
          </button>
        </div>

        {/* line-numbered editor (unchanged structure) */}
        <div style={{ display: 'flex', border: `1px solid ${t.color.borderStrong}`, borderRadius: t.radius.md, overflow: 'hidden', background: t.color.canvas, height: '46vh' }}>
          <div ref={gutterRef} aria-hidden style={{ flex: '0 0 auto', width: 44, padding: '10px 8px 10px 0', textAlign: 'right', fontFamily: t.font.mono, fontSize: '12px', lineHeight: '18px', color: t.color.textFaint, background: t.color.surface, borderRight: `1px solid ${t.color.border}`, overflow: 'hidden', userSelect: 'none', whiteSpace: 'pre' }}>
            {Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}
          </div>
          <textarea
            ref={taRef}
            data-testid="import-input"
            value={text}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            onScroll={(e) => { if (gutterRef.current) gutterRef.current.scrollTop = (e.target as HTMLTextAreaElement).scrollTop; }}
            placeholder={meta?.placeholder ?? 'Paste Mermaid, Terraform (show -json), or Kubernetes manifests…'}
            style={{ flex: 1, minWidth: 0, padding: '10px 12px', border: 'none', background: 'transparent', color: t.color.text, fontFamily: t.font.mono, fontSize: '12px', lineHeight: '18px', whiteSpace: 'pre', overflow: 'auto', outline: 'none', resize: 'none' }}
          />
        </div>

        {/* preview summary / error */}
        {analysis?.error ? (
          <div data-testid="import-error" style={{ fontSize: '12px', color: t.color.danger, background: `${t.color.danger}1a`, border: `1px solid ${t.color.danger}55`, borderRadius: t.radius.md, padding: '8px 10px' }}>
            {analysis.error}
          </div>
        ) : analysis ? (
          <div data-testid="import-summary" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: '12px', color: t.color.textMuted }}>
            <span><b style={{ color: t.color.text }}>{analysis.nodeCount}</b> nodes · <b style={{ color: t.color.text }}>{analysis.edgeCount}</b> edges</span>
            {analysis.skipped.map((s) => (
              <span key={s.label} style={chip}>{s.count} {s.label}{s.count === 1 ? '' : 's'} skipped</span>
            ))}
            {analysis.notes.map((n, i) => (
              <span key={i} style={{ color: t.color.textFaint }}>{n}</span>
            ))}
          </div>
        ) : (
          <div data-testid="import-summary" style={{ fontSize: '12px', color: t.color.textFaint }}>
            {text.trim() && !resolved ? "Couldn't detect a format — pick one above." : 'Paste a diagram source to preview.'}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '11.5px', color: t.color.textFaint }}>{busy ? 'Importing…' : `${lineCount} line${lineCount === 1 ? '' : 's'}`}</span>
          <button type="button" onClick={onClose} disabled={busy} style={{ ...barBtn, marginLeft: 'auto', height: 34, padding: '0 15px', fontSize: '13px' }}>Cancel</button>
          <button
            type="button"
            data-testid="import-run"
            onClick={submit}
            disabled={!canImport}
            style={{ height: 34, padding: '0 16px', borderRadius: t.radius.md, border: 'none', background: t.color.accent, color: '#0b110e', fontFamily: t.font.family, fontSize: '13px', fontWeight: 600, cursor: canImport ? 'pointer' : 'default', opacity: canImport ? 1 : 0.55 }}
          >
            Import
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: Rewire `main.tsx` — state, entries, commit, render**

(a) Update the import editor import (~line 18):

```tsx
import { ImportEditor } from './import-editor';
import { analyzeImport, detectImportFormat, type ImportAnalysis, type ImportFormat } from './import-analyze';
```

(b) Add `installDiagrams` to the preset-diagrams import (find the existing `from '@nodus/preset-diagrams'` line and add it), e.g.:

```tsx
import { installDiagrams } from '@nodus/preset-diagrams';
```

(c) Replace the import state (~line 527):

```tsx
  const [importOpen, setImportOpen] = useState(false);
  const [importInitial, setImportInitial] = useState<ImportFormat | undefined>(undefined);
```

(d) Replace the three flow callbacks + `runImportText` (~lines 655–689) with the unified openers and a commit handler:

```tsx
  const openImport = useCallback((f?: ImportFormat): void => {
    setImportInitial(f);
    setImportOpen(true);
  }, []);
  const importMermaidFlow = useCallback((): void => openImport('mermaid'), [openImport]);
  const importTerraformFlow = useCallback((): void => openImport('terraform'), [openImport]);
  const importKubernetesFlow = useCallback((): void => openImport('kubernetes'), [openImport]);

  // Commit an already-parsed analysis: ensure the needed node types exist, then add + lay out (one undo).
  const commitImport = useCallback(
    (analysis: ImportAnalysis): void => {
      if (analysis.format === 'mermaid' && !editor.nodes.has('process')) installDiagrams(editor);
      runImport(analysis.records, analysis.format === 'mermaid' ? 'elk' : 'dagre');
    },
    [editor, runImport],
  );
```

(e) Add the unified command to the `commands` array (~line 777, alongside the three specific ones):

```tsx
      { id: 'import.auto', title: 'Import diagram…', group: 'Import', run: () => openImport() },
```

Add `openImport` to that `useMemo` dependency array.

(f) Update the render (~line 1257):

```tsx
        <ImportEditor
          editor={editor}
          open={importOpen}
          initialFormat={importInitial}
          detect={detectImportFormat}
          analyze={analyzeImport}
          onClose={() => setImportOpen(false)}
          onImport={commitImport}
        />
```

(g) The toolbar Import button (~line 1104) can stay pointing at `importMermaidFlow`, or switch to `() => openImport()` for auto. Switch it to auto:

```tsx
                      <button type="button" style={{ ...c.ghBtn, flex: 1 }} onClick={() => openImport()}>
```

- [ ] **Step 3: Typecheck the app**

Run: `pnpm typecheck`
Expected: clean. (Fixes any leftover unused `importFormat`/`ImportFormat`/`useMemo` imports.)

- [ ] **Step 4: Extend the browser verify script**

In `scripts/verify-import.mjs`, after the existing section 5 (Mermaid), add auto-detect + preview coverage (before `await browser.close()`). Add this constant near `TF_COMPACT`:

```js
const TF_PLAN = JSON.stringify({
  planned_values: { root_module: { resources: [
    { address: 'aws_subnet.main', type: 'aws_subnet', name: 'main' },
    { address: 'aws_instance.web', type: 'aws_instance', name: 'web' },
  ] } },
  configuration: { root_module: { resources: [
    { address: 'aws_subnet.main', type: 'aws_subnet', name: 'main', expressions: {} },
    { address: 'aws_instance.web', type: 'aws_instance', name: 'web', expressions: { subnet_id: { references: ['aws_subnet.main.id', 'aws_subnet.main'] } } },
  ] } },
});
const K8S_YAML = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n---\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: cfg';
```

And this verification block:

```js
  console.log('6) unified Import… auto-detects Kubernetes YAML + previews counts ...');
  await page.evaluate(() => window.__editor.loadSnapshot({ schemaVersion: 1, document: { records: [] } }));
  await page.getByRole('button', { name: 'Import diagram…', exact: false }).first().click().catch(async () => {
    // fall back to the command palette if the toolbar label differs
    await page.keyboard.press('Meta+KeyK');
    await page.getByText('Import diagram…').click();
  });
  await page.waitForSelector('[data-testid=import-modal]');
  await page.fill('[data-testid=import-input]', K8S_YAML);
  await page.waitForTimeout(320); // debounce
  assert((await page.getByTestId('import-modal').getAttribute('data-format')) === 'kubernetes', 'YAML auto-detected as kubernetes');
  const summary = (await page.getByTestId('import-summary').textContent()) ?? '';
  assert(/1\s+nodes?/.test(summary) || /1<\/b>\s*nodes/.test(summary) || summary.includes('1 nodes'), `preview shows 1 node (got "${summary.slice(0, 60)}")`);
  assert(/ConfigMap/.test(summary), 'preview reports the skipped ConfigMap');
  await page.getByTestId('import-run').click();
  await page.waitForTimeout(300);
  assert((await nodeCount(page)) === 1, `imported 1 workload from YAML (${await nodeCount(page)})`);

  console.log('7) Terraform PLAN → reference-based edges ...');
  await page.evaluate(() => window.__editor.loadSnapshot({ schemaVersion: 1, document: { records: [] } }));
  await page.getByTestId('import-format-terraform').count().catch(() => 0); // no-op guard
  await page.keyboard.press('Meta+KeyK').catch(() => {});
  await page.getByText('Import Terraform', { exact: false }).first().click().catch(() => {});
  await page.waitForSelector('[data-testid=import-modal]');
  await page.fill('[data-testid=import-input]', TF_PLAN);
  await page.waitForTimeout(320);
  await page.getByTestId('import-run').click();
  await page.waitForTimeout(300);
  const edgeCount = await page.evaluate(() => window.__editor.store.edges().length);
  assert(edgeCount >= 1, `plan references produced an edge (${edgeCount})`);
```

> The selector fallbacks keep the script robust to exact label/entry differences; the meaningful asserts are the `data-format`, the preview summary, and the resulting node/edge counts. Adjust the `.getByText`/`.getByRole` locators to match the real command/toolbar labels you wired in Step 2.

- [ ] **Step 5: Run the browser verification**

Start the dev server if not running (`pnpm dev` in a separate shell — port 5188), then:

Run: `node scripts/verify-import.mjs`
Expected: all `✓` including sections 6–7 (auto-detect kubernetes, preview counts, YAML workload imported, plan reference edge); zero console errors.

- [ ] **Step 6: Full gate**

Run: `pnpm verify:all` (typecheck + test + verify:render)
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add examples/browser/src/import-editor.tsx examples/browser/src/main.tsx scripts/verify-import.mjs
git commit -m "feat(example): auto-detecting import with pre-commit preview

One 'Import diagram…' entry detects the format and previews N nodes · M
edges · K skipped + real errors before committing; format overridable;
three format-locked commands retained. Commits already-parsed records."
```

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task:
- Goal 1 (auto-detect) → Task 4 (`detectImportFormat`) + Task 5 (unified `Import…`, badge/override).
- Goal 2 (TF reference edges) → Task 1.
- Goal 3 (K8s YAML) → Task 2.
- Goal 4 (preview) → Task 4 (`ImportAnalysis`) + Task 5 (summary/skip chips/notes/error).
- Contract (`ImportAnalysis`, `AnalysisMeta`) → Task 4. Non-breaking wrappers → Tasks 1–2 (`fromTerraform`/`fromKubernetes` delegate; `fromMermaid` gains a field). Mermaid skip-count → Task 3. Error handling (never-throw, unknown-format, empty, state-note) → Tasks 1 (note), 4 (`analyzeImport` try/catch, detect→null), 5 (disabled Import, "pick a format"). Testing (TF fixtures, K8s YAML/List/skip, mermaid skip, browser drive) → Tasks 1–5.

**2. Placeholder scan** — no `TBD`/`TODO`/"add error handling"/"similar to Task N"; every code step shows full code. (The one advisory note in Task 5 Step 1 flags removing a deliberately-illustrative line — not a placeholder in the shipped code.)

**3. Type consistency** — `analyzeTerraform`/`analyzeKubernetes` return `{ records, skipped: {label,count}[], notes }` in Tasks 1–2 and are consumed with exactly those names in Task 4. `ImportFormat`/`ImportAnalysis` defined in Task 4 are consumed unchanged in Task 5. `fromMermaid(...).skipped: number` defined in Task 3, read in Task 4. `nodeKeysFor`/`resolveRef`/`collectConfigResources` are internal to Task 1. Edge direction `{from: dependency, to: dependent}` consistent across `depends_on` and reference paths.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-20-import-flow-recognition.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Tasks 1→2→3 are independent package changes (could run in parallel); Task 4 depends on 1–3; Task 5 depends on 4.

**2. Inline Execution** — I execute tasks in this session using executing-plans, batch execution with checkpoints for review.

**Which approach?**
