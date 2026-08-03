# Schema & Custom-Shape Migrations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `@nodus-dev/core` a migration engine so old documents (both Nodus's own record shape and third-party custom-shape `props`) upgrade automatically and safely on load.

**Architecture:** A document-level `typeVersions` map records the version each shape `type`'s props were written at. Optional `migrations: Migration[]` on a `NodeUtil`/`EdgeUtil` define ordered up-steps (version = `migrations.length`). `restore()` stays a pure function by default; the `Editor` injects a `resolveMigrations` resolver built from its registries so migrations run at load, before normalization, with per-record fault isolation. On save the Editor stamps `max(loadedVersion, currentVersion)` per type so an older client never downgrades newer data.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), vitest (node env, no DOM), pnpm workspace. No new dependencies.

## Global Constraints

- `SCHEMA_VERSION` stays **1** — `typeVersions` is an additive optional envelope field. Do NOT bump it (bumping forces a repo-wide reformat of every committed `*.nodus.json`).
- Canonical output for a document with no migration-bearing types MUST be **byte-identical** to today (`typeVersions` omitted when empty). `canonical.test.ts` must stay green unchanged.
- `restore(snapshot)` (one arg) MUST behave exactly as today (no migration, `migrationErrors: 0`, `unmigrated: 0`). Only the Editor passes the second arg.
- Migrations are **up-only** and **pure** (`(props) => props`). Version is **derived** from `migrations.length` — there is no separate version number to store on a util.
- Route all edits through the existing patterns; the static gate is `pnpm typecheck` (no eslint). Run it after each task.
- Every task ends with a commit. Commit trailers (append to every commit message):
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01QLZrHEgrC92ZXAByYmBraz
  ```

---

### Task 1: `Migration` type, util fields, registration validation

**Files:**
- Modify: `packages/core/src/registries/index.ts`
- Test: `packages/core/src/registries/migrations-registry.test.ts` (create)

**Interfaces:**
- Produces: `type Migration<P = Record<string, unknown>> = (props: P) => P;` · `NodeUtil.migrations?: Migration[]` · `EdgeUtil.migrations?: Migration[]` · `validateNodeUtil`/`validateEdgeUtil` now also reject a non-array-of-functions `migrations`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/registries/migrations-registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Registry, validateNodeUtil, validateEdgeUtil, type NodeUtil, type EdgeUtil } from './index.js';

const baseNode: NodeUtil = {
  type: 'demo',
  getDefaultProps: () => ({}),
  getGeometry: () => ({}) as never,
  draw: () => {},
};
const baseEdge: EdgeUtil = { type: 'demo-edge', getRoute: () => [], draw: () => {} };

describe('migration registration validation', () => {
  it('accepts a node util with an array of migration functions', () => {
    expect(() => validateNodeUtil({ ...baseNode, migrations: [(p) => p, (p) => p] })).not.toThrow();
  });
  it('accepts a util with no migrations field', () => {
    expect(() => validateNodeUtil(baseNode)).not.toThrow();
  });
  it('rejects migrations that is not an array', () => {
    expect(() => validateNodeUtil({ ...baseNode, migrations: 'nope' as never })).toThrow(/migrations/);
  });
  it('rejects an array whose entries are not all functions', () => {
    expect(() => validateNodeUtil({ ...baseNode, migrations: [(p) => p, 3 as never] })).toThrow(/migrations/);
  });
  it('validates edge util migrations the same way, and Registry.register enforces it', () => {
    const edges = new Registry<EdgeUtil>({ label: 'edge type', validate: validateEdgeUtil });
    expect(() => edges.register({ ...baseEdge, migrations: [1 as never] })).toThrow(/migrations/);
    expect(() => edges.register({ ...baseEdge, migrations: [(p) => p] })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/registries/migrations-registry.test.ts`
Expected: FAIL (`migrations` is not a known property on `NodeUtil`; validation does not exist).

- [ ] **Step 3: Add the type, util fields, and validation**

In `packages/core/src/registries/index.ts`:

Add the type above `interface NodeUtil` (after the `DEFAULT_CAPABILITIES` block):

```ts
/**
 * An ordered, up-only, pure props transform. A type with `migrations = [m1, m2]` is at version 2;
 * a record stored at version `v` runs steps `v … length-1` to reach `length`. See the migration
 * design spec.
 */
export type Migration<P extends Record<string, unknown> = Record<string, unknown>> = (props: P) => P;
```

Add `migrations` to `NodeUtil` (inside the interface, after `capabilities`):

```ts
  readonly capabilities?: Partial<NodeCapabilities>;
  /** Ordered up-migrations for this type's `props`. Version === migrations.length. */
  readonly migrations?: Migration[];
```

Add `migrations` to `EdgeUtil` (after `draw`):

```ts
  draw(api: DrawApi, edge: EdgeRecord, tokens: ResolvedTokens, route: Vec2[]): void;
  /** Ordered up-migrations for this type's `props`. Version === migrations.length. */
  readonly migrations?: Migration[];
```

Add a validator helper (after `requireMethod`):

```ts
/** Throw if `util.migrations` is present but not an array of functions. */
function validateMigrations(util: { readonly type: string; migrations?: unknown }, label: string): void {
  const m = util.migrations;
  if (m === undefined) return;
  if (!Array.isArray(m) || !m.every((fn) => typeof fn === 'function')) {
    throw new Error(`Cannot register ${label} ${describe(util.type)}: 'migrations' must be an array of functions.`);
  }
}
```

Call it from both validators:

```ts
export function validateNodeUtil(util: NodeUtil): void {
  requireMethod(util, 'node type', 'getGeometry');
  requireMethod(util, 'node type', 'draw');
  validateMigrations(util, 'node type');
}

export function validateEdgeUtil(util: EdgeUtil): void {
  requireMethod(util, 'edge type', 'getRoute');
  requireMethod(util, 'edge type', 'draw');
  validateMigrations(util, 'edge type');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/src/registries/migrations-registry.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck`
Expected: exit 0.

```bash
git add packages/core/src/registries/index.ts packages/core/src/registries/migrations-registry.test.ts
git commit -m "feat(core): Migration type + util.migrations field with registration validation

<trailers>"
```

---

### Task 2: `typeVersions` data model — Snapshot, RestoreResult, serializeRecords, canonical output

**Files:**
- Modify: `packages/core/src/serialization/index.ts`
- Modify: `packages/core/src/editor/index.ts:1162-1163` (`toJSON` — signature adaptation only)
- Modify: `packages/cli/src/commands/fmt.ts:24` (preserve `typeVersions`)
- Test: `packages/core/src/serialization/typeversions.test.ts` (create)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `Snapshot.typeVersions?: Record<string, number>` · `RestoreResult.migrationErrors: number` + `.unmigrated: number` (both `0` for now) · `serializeRecords(records, opts?: { meta?; typeVersions? })` · `toCanonicalString` emits `typeVersions` when non-empty.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/serialization/typeversions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { serializeRecords, toCanonicalString, restore, type NodusRecord } from './index.js';

const recs: NodusRecord[] = [];

describe('typeVersions data model', () => {
  it('serializeRecords stores a non-empty typeVersions map', () => {
    const snap = serializeRecords(recs, { typeVersions: { 'aws:ec2': 3, edge: 1 } });
    expect(snap.typeVersions).toEqual({ 'aws:ec2': 3, edge: 1 });
  });
  it('omits an empty typeVersions map', () => {
    expect(serializeRecords(recs, { typeVersions: {} }).typeVersions).toBeUndefined();
    expect(serializeRecords(recs).typeVersions).toBeUndefined();
  });
  it('canonical output emits typeVersions with sorted keys, between schemaVersion and document', () => {
    const s = toCanonicalString(serializeRecords(recs, { typeVersions: { b: 2, a: 1 } }));
    expect(s).toBe('{"schemaVersion":1,"typeVersions":{"a":1,"b":2},"document":{"records":[]}}\n');
  });
  it('canonical output is byte-identical to the no-map form when typeVersions is empty', () => {
    expect(toCanonicalString(serializeRecords(recs))).toBe('{"schemaVersion":1,"document":{"records":[]}}\n');
  });
  it('restore reports migration counters (zero before the engine exists)', () => {
    const r = restore({ schemaVersion: 1, document: { records: [] } });
    expect(r.migrationErrors).toBe(0);
    expect(r.unmigrated).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/serialization/typeversions.test.ts`
Expected: FAIL (`serializeRecords` second arg is `meta`, not an options object; `typeVersions` not emitted; `migrationErrors`/`unmigrated` missing).

- [ ] **Step 3: Update the serialization module**

In `packages/core/src/serialization/index.ts`:

Extend `Snapshot`:

```ts
export interface Snapshot {
  schemaVersion: number;
  document: { records: NodusRecord[] };
  /** Per-shape-`type` version its `props` were written at. Additive; absent ⇒ every type at v0. */
  typeVersions?: Record<string, number>;
  meta?: Record<string, unknown>;
}
```

Extend `RestoreResult`:

```ts
export interface RestoreResult {
  records: NodusRecord[];
  /** Count of edges dropped because an endpoint referenced a missing node. */
  droppedEdges: number;
  /** Count of records dropped because a migration threw. */
  migrationErrors: number;
  /** Count of records kept raw (newer-than-known version, or type util not registered). */
  unmigrated: number;
}
```

Replace `serializeRecords`:

```ts
export function serializeRecords(
  records: NodusRecord[],
  opts?: { meta?: Record<string, unknown>; typeVersions?: Record<string, number> },
): Snapshot {
  const clean = records.map((r) => ({ ...r }));
  const snap: Snapshot = { schemaVersion: SCHEMA_VERSION, document: { records: clean } };
  if (opts?.typeVersions && Object.keys(opts.typeVersions).length > 0) snap.typeVersions = opts.typeVersions;
  if (opts?.meta) snap.meta = opts.meta;
  return snap;
}
```

Update `toCanonicalString` to emit `typeVersions` when present:

```ts
export function toCanonicalString(snapshot: Snapshot): string {
  const sorted = [...snapshot.document.records].sort(compareRecords);
  const lines = sorted.map((r) => stableStringify(canonicalRecord(r)));
  const body = lines.length ? `\n${lines.join(',\n')}\n` : '';
  const tv =
    snapshot.typeVersions && Object.keys(snapshot.typeVersions).length > 0
      ? `"typeVersions":${stableStringify(snapshot.typeVersions)},`
      : '';
  return `{"schemaVersion":${snapshot.schemaVersion},${tv}"document":{"records":[${body}]}}\n`;
}
```

In `restore()`, append the two zeroed counters to the existing return line (the real logic lands in Task 3, which replaces the whole function). The current line is
`return { records: [...pages, ...nodes, ...keptEdges], droppedEdges };` — change it to:

```ts
  return { records: [...pages, ...nodes, ...keptEdges], droppedEdges, migrationErrors: 0, unmigrated: 0 };
```

- [ ] **Step 4: Fix the two `serializeRecords` call sites**

In `packages/core/src/editor/index.ts` (`toJSON`, line ~1162) — adapt to the new signature (typeVersions added in Task 4):

```ts
  toJSON(meta?: Record<string, unknown>): Snapshot {
    return serializeRecords(this.store.allRecords(), meta ? { meta } : undefined);
  }
```

In `packages/cli/src/commands/fmt.ts` (line ~24) — **preserve the input file's `typeVersions`** (fmt canonicalizes without utils, so it must not derive or drop them):

```ts
  const canonical = toCanonicalString(serializeRecords(restored.records, { typeVersions: snap.typeVersions }));
```
> `snap` is the parsed input `Snapshot` already in scope in `fmt.ts` (the value passed to `restore(snap)`). If the local variable has a different name, use whatever holds the parsed input snapshot.

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm exec vitest run packages/core/src/serialization/typeversions.test.ts`
Expected: PASS (5 tests).
Run: `pnpm exec vitest run packages/core/src/__tests__/canonical.test.ts` (guard the moat)
Expected: PASS, unchanged.
Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/serialization/index.ts packages/core/src/serialization/typeversions.test.ts packages/core/src/editor/index.ts packages/cli/src/commands/fmt.ts
git commit -m "feat(core): Snapshot.typeVersions + RestoreResult counters + canonical emit

<trailers>"
```

---

### Task 3: Migration execution in `restore()` (engine + props, fault-isolated)

**Files:**
- Modify: `packages/core/src/serialization/index.ts`
- Test: `packages/core/src/serialization/migrations.test.ts` (create)

**Interfaces:**
- Consumes: `Migration` (Task 1); `Snapshot.typeVersions`, `RestoreResult.migrationErrors/unmigrated` (Task 2).
- Produces: `interface RestoreOptions { resolveMigrations?: (record: { typeName: string; type?: string }) => Migration[] | undefined }` · `restore(input, opts?)` now runs engine + props migrations · module-level `engineMigrations` array (empty).

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/serialization/migrations.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { restore, type Migration, type Snapshot } from './index.js';

function node(id: string, type: string, props: Record<string, unknown>) {
  return { id, typeName: 'node', version: 0, type, x: 0, y: 0, w: 10, h: 10, z: 'a0', visual: { state: 'solid' }, props };
}
function snap(records: unknown[], typeVersions?: Record<string, number>): Snapshot {
  return { schemaVersion: 1, document: { records: records as never }, ...(typeVersions ? { typeVersions } : {}) };
}
// v1 renames {r} -> {radius}; v2 doubles it. Type is at version 2.
const migs: Migration[] = [
  (p) => ({ radius: p.r, ...(({ r, ...rest }) => rest)(p) }),
  (p) => ({ ...p, radius: (p.radius as number) * 2 }),
];
const resolve = (rec: { typeName: string; type?: string }): Migration[] | undefined =>
  rec.type === 'box' ? migs : undefined;

describe('restore migration execution', () => {
  it('runs the full sequence for a v0 record (no typeVersions entry)', () => {
    const r = restore(snap([node('n1', 'box', { r: 5 })]), { resolveMigrations: resolve });
    expect(r.records[0]).toMatchObject({ props: { radius: 10 } });
    expect(r.migrationErrors).toBe(0);
    expect(r.unmigrated).toBe(0);
  });
  it('runs only the remaining steps for a partially-migrated record', () => {
    const r = restore(snap([node('n1', 'box', { radius: 5 })], { box: 1 }), { resolveMigrations: resolve });
    expect(r.records[0]).toMatchObject({ props: { radius: 10 } }); // only step index 1 ran
  });
  it('does nothing when stored === current', () => {
    const r = restore(snap([node('n1', 'box', { radius: 7 })], { box: 2 }), { resolveMigrations: resolve });
    expect(r.records[0]).toMatchObject({ props: { radius: 7 } });
    expect(r.unmigrated).toBe(0);
  });
  it('isolates a throwing migration: drops that record, keeps the rest', () => {
    const boom: Migration[] = [() => { throw new Error('bad'); }];
    const r = restore(snap([node('bad', 't', {}), node('ok', 'box', { r: 1 })]),
      { resolveMigrations: (rec) => (rec.type === 't' ? boom : rec.type === 'box' ? migs : undefined) });
    expect(r.records.map((x) => x.id)).toEqual(['ok']);
    expect(r.migrationErrors).toBe(1);
  });
  it('keeps a forward-version record raw and counts it', () => {
    const r = restore(snap([node('n1', 'box', { radius: 99 })], { box: 5 }), { resolveMigrations: resolve });
    expect(r.records[0]).toMatchObject({ props: { radius: 99 } }); // untouched
    expect(r.unmigrated).toBe(1);
  });
  it('keeps an unregistered-type record raw and counts it', () => {
    const r = restore(snap([node('n1', 'mystery', { a: 1 })]), { resolveMigrations: resolve });
    expect(r.records[0]).toMatchObject({ props: { a: 1 } });
    expect(r.unmigrated).toBe(1);
  });
  it('without opts, does not migrate (pure/back-compat)', () => {
    const r = restore(snap([node('n1', 'box', { r: 5 })]));
    expect(r.records[0]).toMatchObject({ props: { r: 5 } });
    expect(r.migrationErrors).toBe(0);
    expect(r.unmigrated).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/serialization/migrations.test.ts`
Expected: FAIL (`restore` ignores `resolveMigrations`; props not transformed).

- [ ] **Step 3: Implement migration execution**

In `packages/core/src/serialization/index.ts`:

Import `Migration`:

```ts
import type { EdgeRecord, Endpoint, NodeRecord, NodusRecord, PageRecord } from '../model.js';
import type { Migration } from '../registries/index.js';
```

Add, near the top (after `SCHEMA_VERSION`):

```ts
export interface RestoreOptions {
  /** Ordered migrations for a record's type; `undefined` ⇒ the type is not registered. */
  resolveMigrations?: (record: { typeName: string; type?: string }) => Migration[] | undefined;
}

/**
 * Engine record-shape migrations, indexed by the `schemaVersion` being migrated FROM. Empty until
 * the first breaking record-shape change (which bumps SCHEMA_VERSION and adds `engineMigrations[1]`).
 */
const engineMigrations: Array<(r: Record<string, unknown>) => Record<string, unknown>> = [];
```

Replace the body of `restore()` (the per-record loop and return) with the migration-aware version. Full function:

```ts
export function restore(input: Snapshot, opts?: RestoreOptions): RestoreResult {
  const raw = input.document?.records ?? [];
  const typeVersions = input.typeVersions ?? {};
  const fromSchema = num(input.schemaVersion, SCHEMA_VERSION);

  const nodes: NodeRecord[] = [];
  const edges: EdgeRecord[] = [];
  const pages: PageRecord[] = [];
  let migrationErrors = 0;
  let unmigrated = 0;

  for (const original of raw as unknown as Array<Record<string, unknown>>) {
    let r = original;

    // 1. engine record-shape migrations (schemaVersion → SCHEMA_VERSION)
    try {
      for (let v = fromSchema; v < SCHEMA_VERSION; v++) {
        const step = engineMigrations[v];
        if (step) r = step(r);
      }
    } catch {
      migrationErrors++;
      continue;
    }

    // 2. custom-shape props migrations (nodes/edges only, and only when a resolver is provided)
    if ((r.typeName === 'node' || r.typeName === 'edge') && opts?.resolveMigrations) {
      const type = typeof r.type === 'string' ? r.type : '';
      const steps = opts.resolveMigrations({ typeName: r.typeName, type });
      if (steps === undefined) {
        unmigrated++; // type not registered — keep raw
      } else {
        const current = steps.length;
        const stored = typeVersions[type] ?? 0;
        if (stored > current) {
          unmigrated++; // newer than this client — keep raw, preserve
        } else if (stored < current) {
          try {
            let props = (r.props as Record<string, unknown>) ?? {};
            for (let i = stored; i < current; i++) props = steps[i]!(props);
            r = { ...r, props };
          } catch {
            migrationErrors++;
            continue;
          }
        }
      }
    }

    // 3. normalize (validates the migrated record)
    if (r.typeName === 'node') {
      const n = normalizeNode(r);
      if (n) nodes.push(n);
    } else if (r.typeName === 'edge') {
      const e = normalizeEdge(r);
      if (e) edges.push(e);
    } else if (r.typeName === 'page') {
      const p = normalizePage(r);
      if (p) pages.push(p);
    }
  }

  // repair: drop edges whose node endpoints reference a missing node
  const nodeIds = new Set(nodes.map((n) => n.id));
  let droppedEdges = 0;
  const keptEdges = edges.filter((e) => {
    for (const ep of [e.from, e.to]) {
      if ((ep.kind === 'node' || ep.kind === 'outline') && !nodeIds.has(ep.nodeId)) {
        droppedEdges++;
        return false;
      }
    }
    return true;
  });

  return { records: [...pages, ...nodes, ...keptEdges], droppedEdges, migrationErrors, unmigrated };
}
```
> This supersedes the placeholder counters added in Task 2 Step 3.

- [ ] **Step 4: Run test + regression**

Run: `pnpm exec vitest run packages/core/src/serialization/migrations.test.ts`
Expected: PASS (7 tests).
Run: `pnpm exec vitest run packages/core/src/serialization packages/core/src/__tests__/canonical.test.ts`
Expected: PASS (typeversions + canonical + any existing serialization tests unchanged).
Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/serialization/index.ts packages/core/src/serialization/migrations.test.ts
git commit -m "feat(core): run engine + custom-shape migrations in restore(), fault-isolated

<trailers>"
```

---

### Task 4: Editor integration — inject resolver, retain loaded versions, stamp `max()` on save

**Files:**
- Modify: `packages/core/src/editor/index.ts` (`toJSON` ~1162, `loadSnapshot` ~1165, plus a private field + two private methods; import `Migration`)
- Test: `packages/core/src/editor/migrations-editor.test.ts` (create)

**Interfaces:**
- Consumes: `restore(snap, { resolveMigrations })` and `serializeRecords(recs, { typeVersions })` (Tasks 2–3); `NodeUtil.migrations`/`EdgeUtil.migrations` (Task 1); `this.nodes`/`this.edges` registries (existing).
- Produces: end-to-end migrate-on-load + version-stamp-on-save through the public `Editor.loadSnapshot`/`toJSON`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/editor/migrations-editor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Editor, toCanonicalString, type NodeUtil, type Snapshot } from '../index.js';

// A custom node type at version 2: v0 {r} -> {radius}; v1 doubles radius.
const boxUtil: NodeUtil = {
  type: 'box',
  getDefaultProps: () => ({ radius: 1 }),
  getGeometry: (n) => ({ bounds: () => ({ x: n.x, y: n.y, w: n.w, h: n.h }) }) as never,
  draw: () => {},
  migrations: [(p) => ({ radius: p.r }), (p) => ({ radius: (p.radius as number) * 2 })],
};

function oldDoc(props: Record<string, unknown>, typeVersions?: Record<string, number>): Snapshot {
  return {
    schemaVersion: 1,
    ...(typeVersions ? { typeVersions } : {}),
    document: {
      records: [
        { id: 'n1', typeName: 'node', version: 0, type: 'box', x: 0, y: 0, w: 10, h: 10, z: 'a0', visual: { state: 'solid' }, props } as never,
      ],
    },
  };
}

describe('Editor migration integration', () => {
  it('migrates custom-shape props on load', () => {
    const ed = new Editor();
    ed.registerNodeType(boxUtil);
    ed.loadSnapshot(oldDoc({ r: 5 })); // v0 -> v2
    expect((ed.store.nodes()[0] as { props: { radius: number } }).props.radius).toBe(10);
  });

  it('stamps typeVersions at the current version on save', () => {
    const ed = new Editor();
    ed.registerNodeType(boxUtil);
    ed.loadSnapshot(oldDoc({ r: 5 }));
    expect(ed.toJSON().typeVersions).toEqual({ box: 2 });
  });

  it('preserves a forward-version document byte-identically (max rule)', () => {
    const ed = new Editor(); // this client only knows box@2
    ed.registerNodeType(boxUtil);
    const future = oldDoc({ radius: 999 }, { box: 5 }); // written by a newer client
    ed.loadSnapshot(future);
    // kept raw, and re-stamped at 5 (not downgraded to 2)
    expect(ed.toJSON().typeVersions).toEqual({ box: 5 });
    expect((ed.store.nodes()[0] as { props: { radius: number } }).props.radius).toBe(999);
  });

  it('omits typeVersions for types with no migrations', () => {
    const ed = new Editor();
    const id = ed.createNode({ type: 'rect', x: 0, y: 0 });
    expect(id).toBeTruthy();
    expect(ed.toJSON().typeVersions).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/editor/migrations-editor.test.ts`
Expected: FAIL (props not migrated; `toJSON().typeVersions` undefined).

- [ ] **Step 3: Implement the Editor integration**

In `packages/core/src/editor/index.ts`:

Add `Migration` to the registries import (find the existing `from '../registries/index.js'` import and add the type), or add:

```ts
import type { Migration } from '../registries/index.js';
```

Add a private field near the other document state (e.g. beside `zCounter`):

```ts
/** typeVersions from the most recently loaded snapshot — merged with current utils on save. */
private loadedTypeVersions: Record<string, number> = {};
```

Add two private members (place near `toJSON`):

```ts
/** Resolve a record's ordered migrations from the registries. `undefined` ⇒ type not registered. */
private readonly resolveMigrations = (record: { typeName: string; type?: string }): Migration[] | undefined => {
  const type = record.type ?? '';
  if (record.typeName === 'node') {
    const u = this.nodes.get(type);
    return u ? (u.migrations ?? []) : undefined;
  }
  if (record.typeName === 'edge') {
    const u = this.edges.get(type);
    return u ? (u.migrations ?? []) : undefined;
  }
  return undefined;
};

/** Per-type version to stamp on save: max(loaded, current) so an old client never downgrades data. */
private computeTypeVersions(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of this.store.allRecords()) {
    if (r.typeName !== 'node' && r.typeName !== 'edge') continue;
    const type = (r as NodeRecord | EdgeRecord).type;
    if (out[type] !== undefined) continue;
    const util = r.typeName === 'node' ? this.nodes.get(type) : this.edges.get(type);
    const current = util?.migrations?.length ?? 0;
    const v = Math.max(this.loadedTypeVersions[type] ?? 0, current);
    if (v > 0) out[type] = v; // omit v0 types to keep the map + diff minimal
  }
  return out;
}
```

Replace `toJSON`:

```ts
  toJSON(meta?: Record<string, unknown>): Snapshot {
    return serializeRecords(this.store.allRecords(), {
      ...(meta ? { meta } : {}),
      typeVersions: this.computeTypeVersions(),
    });
  }
```

Update `loadSnapshot` — pass the resolver and retain the loaded map (first two lines of the method body):

```ts
  loadSnapshot(snap: Snapshot, opts?: { fit?: boolean }): void {
    this.loadedTypeVersions = snap.typeVersions ?? {};
    const { records } = restore(snap, { resolveMigrations: this.resolveMigrations });
    // …rest of the method is unchanged…
```

> `NodeRecord`/`EdgeRecord` are already imported in `editor/index.ts` (used throughout). If not, add them to the existing `../model.js` type import.

- [ ] **Step 4: Run test + full core suite**

Run: `pnpm exec vitest run packages/core/src/editor/migrations-editor.test.ts`
Expected: PASS (4 tests).
Run: `pnpm exec vitest run packages/core/src/__tests__/engine-hardening.test.ts packages/core/src/__tests__/canonical.test.ts`
Expected: PASS (round-trip test #6 and canonical unaffected — default types have no migrations, so `typeVersions` stays absent).
Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/editor/index.ts packages/core/src/editor/migrations-editor.test.ts
git commit -m "feat(core): Editor migrates on load + stamps max(loaded,current) typeVersions on save

<trailers>"
```

---

### Task 5: Public exports, doc-comment fix, and EXTENDING guide

**Files:**
- Modify: `packages/core/src/index.ts` (export `Migration`, `RestoreOptions`)
- Modify: `packages/core/src/__tests__/engine-hardening.test.ts:5` (update the stale doc comment)
- Modify: `docs/EXTENDING.md` (add a "Migrating a custom shape" section)

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: `Migration` and `RestoreOptions` importable from `@nodus-dev/core`.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/serialization/migrations.test.ts`:

```ts
import * as nodus from '../index.js';
it('exports Migration and RestoreOptions from the package root', () => {
  // types are compile-time; this asserts the value graph imports cleanly and restore is the public one
  expect(typeof nodus.restore).toBe('function');
  const _m: nodus.Migration = (p) => p; // fails typecheck if Migration is not exported
  const _o: nodus.RestoreOptions = {};  // fails typecheck if RestoreOptions is not exported
  expect(_m({ a: 1 })).toEqual({ a: 1 });
  expect(_o).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm typecheck`
Expected: FAIL (`Migration` / `RestoreOptions` are not exported members of `@nodus-dev/core`).

- [ ] **Step 3: Add the exports**

In `packages/core/src/index.ts`, add `type Migration` to the registries export block:

```ts
  type NodeUtil,
  type EdgeUtil,
  type Migration,
```

Add `type RestoreOptions` to the serialization export block:

```ts
  type Snapshot,
  type RestoreResult,
  type RestoreOptions,
```

- [ ] **Step 4: Update the stale doc comment**

In `packages/core/src/__tests__/engine-hardening.test.ts`, replace line 5:

```ts
 *   3. (covered in serialization/migrations.test.ts) migration engine: versioned up-migrations run
 *      at load, fault-isolated (a throwing migration drops one record, not the document).
```

- [ ] **Step 5: Document it in EXTENDING.md**

In `docs/EXTENDING.md`, add a section after the node-type authoring section:

````markdown
### Migrating a custom shape

When you change a custom type's `props` shape, add an up-migration so old documents keep loading.
A migration is a pure `(props) => props`; the type's version is `migrations.length`.

```ts
const boxUtil: NodeUtil = {
  type: 'box',
  getDefaultProps: () => ({ radius: 4 }),
  getGeometry: (n) => rectGeometry(n),
  draw: (api, n, t) => { /* … */ },
  // v0 stored { r }; v1 renamed it to { radius }.
  migrations: [(p) => ({ radius: p.r })],
};
```

On load, a record written at version `v` runs steps `v … length-1`. The version each type was
written at is stored once per document in `typeVersions` (canonical, minimal-diff). A migration that
throws drops only that record (`RestoreResult.migrationErrors`); a document written by a newer client
is kept raw and never downgraded (`RestoreResult.unmigrated`).
````

- [ ] **Step 6: Verify + commit**

Run: `pnpm typecheck`
Expected: exit 0.
Run: `pnpm test`
Expected: PASS — full suite green (all new migration tests + the prior 358).

```bash
git add packages/core/src/index.ts packages/core/src/serialization/migrations.test.ts packages/core/src/__tests__/engine-hardening.test.ts docs/EXTENDING.md
git commit -m "feat(core): export Migration/RestoreOptions + document custom-shape migrations

<trailers>"
```

---

## Self-review (author checklist — completed)

- **Spec coverage:** typeVersions model (T2) · Migration primitive + on-util + validation (T1) · restore engine+props execution + fault isolation (T3) · pure-by-default restore (T3 back-compat test) · max() round-trip + Editor retain/stamp (T4) · canonical emit + byte-identity (T2) · SCHEMA_VERSION stays 1 (Global Constraints, T2 canonical test) · exports + engine-hardening comment + EXTENDING (T5) · testing plan items 1–8 mapped to T1/T3/T4 tests. Spec item 9 (fuzz/invariant extension) is intentionally deferred — noted below.
- **Placeholder scan:** none — every code and test block is complete.
- **Type consistency:** `Migration`, `RestoreOptions`, `resolveMigrations` signature, `typeVersions` shape, and `serializeRecords(records, opts)` are identical across Tasks 1–5.

## Deferred (not in this plan)

- Spec testing item 9 (extend the property/fuzz invariant suite for a migrate-on-load pass). The seven targeted tests here cover the behavior; folding migrations into `invariants.test.ts` is a small follow-up task, not a blocker.
- A configurable `onMigrationError` policy (spec non-goal).
