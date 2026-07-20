# Design: Smoother Import Flow + Better Per-Type Recognition

- **Date:** 2026-07-20
- **Status:** Approved (scope + key decisions); ready for an implementation plan
- **Area:** `@nodus/import-infra` (Terraform + Kubernetes recognition), `@nodus/from-mermaid` (small non-breaking skip-count add), example app (`examples/browser/src/` — new `import-analyze.ts`, `import-editor.tsx`, `main.tsx`), `scripts/verify-import.mjs`.
- **Motivation:** Two distinct problems live in two layers. **(1) The flow** forces the user to pick a format *before* the modal opens, accepts K8s only as pre-converted JSON, commits blindly with no preview, and reports generic errors. **(2) The recognition** is uneven: Mermaid is mature, but Terraform infers edges *only* from `depends_on` (which real code rarely uses — dependencies are implicit via interpolation references), so a typical `terraform show -json` imports as a pile of nodes with almost no edges; Kubernetes can't take YAML (the format manifests actually ship in) and silently drops kinds with no report.

## Goals

1. **Auto-detect format** — one `Import…` entry that recognizes Mermaid vs Terraform vs Kubernetes from the pasted content; format still overridable.
2. **Terraform reference-based edges** — infer edges from implicit interpolation references (`configuration…expressions…references`), not just `depends_on`. The single biggest recognition win.
3. **Accept YAML for Kubernetes** — real multi-doc (`---`) YAML manifests, not only `kubectl -o json`.
4. **Preview before commit** — in the modal, show detected format, `N nodes · M edges · K skipped (…)`, and the **real** parser error, before records land on the canvas.

## Non-goals (v1)

- **Expanding Mermaid syntax coverage.** Mermaid's parser stays as-is (still routes through auto-detect). Subgraphs, sequence/C4 diagrams, `&` multi-targets remain out of scope. (Only a tiny, non-behavior-changing skip-count is added so the preview can show "K skipped".)
- **Parsing Terraform HCL.** Input remains `terraform show -json` (state or plan). HCL parsing is a separate, much larger effort.
- **A live mini-render preview.** The preview is a textual summary (counts + skipped + notes + error), not an in-modal canvas render.
- **A new `@nodus/import` façade package.** Detection/orchestration lives in the example app for now; extract a package later if a second consumer (CLI/MCP) needs it.
- **New Kubernetes node kinds / owner-reference edges.** The K8s kind→type map is unchanged; the recognition win is YAML input + skip reporting + normalization moved into the package. (ownerReferences / HPA→target edges noted as possible follow-ups, not v1.)

## Locked decisions

1. **Architecture:** "Analysis-first" (Approach A). One `ImportAnalysis` contract powers all four features. Parsers gain rich analyzers returning `{ records, skipped, notes, error? }`; existing `fromTerraform`/`fromKubernetes`/`fromMermaid` stay as thin, non-breaking record-returning wrappers.
2. **YAML:** add the `yaml` npm dependency to `@nodus/import-infra`; `fromKubernetes` accepts `string | objects`. (Lockfile change — surfaced to the human at implementation time.)
3. **Preview depth:** textual summary — detected-format badge, `N nodes · M edges · K skipped` + skip chips + the actual parser error. Parse-on-type (debounced); commit uses the already-parsed records (no re-parse).
4. **Recognition boundaries stay in the packages** (tested, reusable by CLI/MCP); **flow logic (detect + modal orchestration) stays in the app**; the modal remains package-free (calls an injected `analyze()` callback).

## Architecture

### 1. The contract (app-level, `examples/browser/src/import-analyze.ts` — new)

```ts
export type ImportFormat = 'mermaid' | 'terraform' | 'kubernetes';

/** What a parser reports about a paste, beyond the records themselves. */
export interface AnalysisMeta {
  skipped: { label: string; count: number }[];  // e.g. [{ label: 'ConfigMap', count: 3 }]
  notes: string[];                               // e.g. "state JSON — edges limited to depends_on"
}

export interface ImportAnalysis extends AnalysisMeta {
  format: ImportFormat;
  records: NodusRecord[];
  nodeCount: number;
  edgeCount: number;
  error: string | null;   // real parser message; when set, records is [] and commit is disabled
}

/** Content-shape detection — no parser imports; pure string/JSON/YAML inspection. */
export function detectImportFormat(text: string): ImportFormat | null;

/** Parse + summarize for a KNOWN format. Never throws — parse failure -> { error, records: [] }. */
export function analyzeImport(text: string, format: ImportFormat): ImportAnalysis;
```

`analyzeImport` requires a resolved format; the modal owns the "no format" branch: it computes `format = override ?? detectImportFormat(text)` and only calls `analyzeImport` when that is non-null, otherwise it shows "Couldn't detect a format — pick one" and disables Import.

`detectImportFormat` heuristics:
- **Mermaid** — first non-empty line matches `^(graph|flowchart|stateDiagram(-v2)?|erDiagram)\b` (the headers the parser actually supports).
- Otherwise try `JSON.parse`, then `yaml.parse`, and inspect the object:
  - **Terraform** — has `values.root_module` **or** `planned_values.root_module` **or** `resource_changes` **or** (`terraform_version`/`format_version` with `configuration`).
  - **Kubernetes** — object with `kind` + `apiVersion`; or `kind: 'List'` with `items`; or an array whose elements have `kind`.
- Else `null` (the modal shows "Couldn't detect a format — pick one").

`analyzeImport` dispatches to the package analyzers (below), catches parse errors into `error`, and computes `nodeCount`/`edgeCount` from records (`isNode`/`isEdge`).

### 2. Recognition — Terraform edges (`@nodus/import-infra`)

Today (`fromTerraform`): resources → nodes; edges from `depends_on` only. Change: add reference-based edges from the `configuration` block, unioned with `depends_on`.

New internal `analyzeTerraform(showJson): { records, skipped, notes }`; `fromTerraform` becomes `(json) => analyzeTerraform(json).records` (non-breaking).

Algorithm:
1. **Nodes** — unchanged: collect resources from `values.root_module` / `planned_values.root_module` (recursively through `child_modules`); node `key` = the values `address` (may be module-prefixed / indexed, e.g. `module.vpc.aws_subnet.main[0]`).
2. **Config walk** — collect `configuration.root_module` resources recursively through `module_calls[].module`. Track each config resource's **full module-qualified address without index** (root: `type.name`; child: `module.vpc.type.name`) and its `expressions`.
3. **Reference extraction** — recursively walk each resource's `expressions` (values may be nested objects/arrays for blocks), collecting every `references: string[]`. For each reference, resolve to a managed-resource address by **longest-prefix match** against the known config addresses, resolving **within the resource's own module namespace first**, then root. References to `var.*`, `local.*`, `data.*`, `each.*`, `count.*`, and `module.*` outputs that don't resolve to a managed resource are ignored.
4. **Edges** — for each resolved (referenced → referencing) pair, emit `{ from: referenced, to: referencing }` (dependency → dependent, matching the existing `depends_on` direction). Map config addresses back to node keys by exact match **or** `nodeKey === ref` **or** `nodeKey.startsWith(ref + '[')` (indexed instances connect to all matches). **Union** with `depends_on` edges; **dedup**; drop self-edges.
5. **Notes** — if there is no `configuration` block (plain state JSON), push `"state JSON — edges limited to depends_on; import a plan (terraform show -json <plan>) for full topology"`. `skipped` for TF is typically empty (every resource maps to a kind); data sources are not nodes and are reported only if present as a note, not a skip chip.

Scope: root + child modules; cross-module references that resolve only to module **outputs** (not resources) are best-effort (won't produce an edge). Validated against a real `terraform show -json` **plan** fixture (with `count`/`for_each` and a child module).

### 3. Recognition — Kubernetes YAML + skip reporting (`@nodus/import-infra`)

- Add dependency: **`yaml`** (v2.x, `parseAllDocuments`/`parse`).
- New internal `analyzeKubernetes(input: string | K8sObject[]): { records, skipped, notes }`; `fromKubernetes` becomes `(input) => analyzeKubernetes(input).records` (signature widens from `K8sObject[]` to `string | K8sObject[]` — additive, non-breaking for array callers).
- **Input normalization moves into the package** (out of `main.tsx`): a `string` is parsed with `yaml.parseAllDocuments` (multi-doc `---`; JSON is valid YAML so one path covers both); then any of {array, `List` with `items`, single object} → a flat object list. Null/empty docs dropped.
- **Skip reporting** — kinds that map to `null` (ConfigMap, Secret, Namespace, PVC, ServiceAccount, Role, …) are counted by kind and returned in `skipped`. Edge inference (Ingress→Service, Service→workload via selector) is unchanged.
- **Notes** — if a string parsed to zero recognized objects, note "no workloads/services/ingress found".

### 4. Recognition — Mermaid skip count (`@nodus/from-mermaid`, minimal)

- `fromMermaid` return type gains an optional `skipped?: number` = count of body statements that matched no rule (already effectively tracked as "unparsed" — currently silently `continue`d). No behavior change to what is parsed. This feeds the preview's "K skipped" for Mermaid. Purely additive.

### 5. Flow — detect + modal preview (app)

**`main.tsx`:**
- New single command/toolbar action `Import…` (group `Import`) → opens the modal in **auto** mode.
- The three existing commands (`Import Mermaid…` / `…Terraform…` / `…Kubernetes…`) still open the modal **locked** to that format (initialFormat set, override still allowed).
- `runImportText` collapses to: receive the `ImportAnalysis` from the modal → `store.apply(records)` → layout (`elk` for mermaid, `dagre` for infra) → `zoomToFit`. Empty/`error` never reaches commit (modal disables Import).

**`import-editor.tsx`:**
- Props change from `format: ImportFormat | null` to `open: boolean`, `initialFormat?: ImportFormat`, and an injected `analyze: (text: string, override?: ImportFormat) => ImportAnalysis`. `onImport` now receives the parsed `ImportAnalysis` (not raw text).
- Internal `format` state seeded from `initialFormat` or `'auto'`. A **detected-format badge** shows the auto result; a small segmented control / dropdown lets the user override.
- **Parse-on-type**: debounce (~200 ms) → `analyze` → render badge + `N nodes · M edges · K skipped` + skip chips + notes + the real `error`. Import button disabled when `error` or `nodeCount === 0`. Placeholder/hint text follows the current (detected or chosen) format.
- Commit calls `onImport(analysis)` with the already-computed analysis (no re-parse).

### 6. Data flow

```
paste ─▶ import-editor (debounced) ─▶ analyze(text, override)
                                          │
                    detectImportFormat ───┤
                                          ▼
              ┌──────────────── analyzeImport ────────────────┐
              │  mermaid → fromMermaid (+skipped)             │
              │  terraform → analyzeTerraform (refs+depends)  │  ⇒ ImportAnalysis
              │  kubernetes → analyzeKubernetes (YAML+skip)   │
              └───────────────────────────────────────────────┘
                                          │
         badge · counts · skip chips · notes · error  ◀────────┘   (preview, no commit)
                                          │  Import (enabled iff no error & nodeCount>0)
                                          ▼
              runImportText ─▶ store.apply(records) ─▶ layout ─▶ zoomToFit   (one undo entry)
```

## Error handling

- **Parse failures never throw to the UI.** `analyzeImport` catches and returns `{ error }`; the modal shows the real message (JSON position, Mermaid header hint, YAML parse error) instead of the generic "check the syntax".
- **Unknown format:** `detectImportFormat` → `null` → modal prompts for an explicit choice rather than guessing.
- **Empty result:** `nodeCount === 0` disables Import and shows a note ("nothing recognized to import").
- **Terraform without `configuration`:** not an error — a note explaining edges are `depends_on`-only.

## Testing

- **`packages/import-infra/src/import.test.ts`** (extend):
  - TF reference edges: plan-JSON fixtures — direct ref (`subnet_id = aws_subnet.main.id`), nested-block ref, `count`/`for_each` indexed instances, child module, and refs to `var`/`local`/`data` that must **not** create edges; union + dedup with `depends_on`; the "no configuration block → note" case.
  - K8s YAML: multi-doc `---`, a `List`, a single object, JSON-as-YAML; skip set (ConfigMap/Secret/Namespace) reported; Ingress/Service edges still inferred; string vs `objects[]` input parity.
- **`packages/from-mermaid/src/from-mermaid.test.ts`** (extend): `skipped` count for unrecognized statements; existing behavior unchanged.
- **App** — `scripts/verify-import.mjs` (or a `browser-verify` drive): detect → preview counts match → commit lands the expected node/edge counts with zero console errors.
- **Gates:** `pnpm typecheck` (the static gate) + `pnpm test` throughout; `pnpm verify:render` before close-out.

## Risks / open items

- **Terraform JSON shape** — the `configuration…expressions…references` structure is validated against a real `terraform show -json` plan fixture during implementation before the walker is finalized (the crux feature; don't ship on memory of the schema).
- **Module address mismatch** — nodes are keyed by *values* addresses (indexed, module-prefixed); references resolve to *config* addresses (non-indexed). The prefix-match + `startsWith(ref+'[')` rule handles the common cases; deeply nested / cross-module output references are best-effort and documented as such.
- **New dependency** — `yaml` adds supply-chain surface and touches the lockfile; surfaced to the human before the install.
