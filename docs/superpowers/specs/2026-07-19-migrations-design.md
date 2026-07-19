# Design: Schema & custom-shape migrations for `@nodus/core`

- **Date:** 2026-07-19
- **Status:** Approved (design); ready for implementation plan
- **Area:** `packages/core/src/serialization`, `packages/core/src/registries`, `packages/core/src/editor`
- **Motivation:** A four-lane audit vs Excalidraw/tldraw identified the *absent custom-shape
  migration path* as the decisive SDK-adoption blocker. The migration API was deliberately removed
  (`engine-hardening.test.ts` enforces its absence), `restore()` ignores `schemaVersion`
  (`serialization/index.ts:156`), and custom `props` are opaque and never validated on load. A
  third-party that ships v1, then renames a custom-node prop in v2, has zero framework help — every
  persisted `*.nodus.json` is silently wrong. tldraw's headline feature; cheap to add now,
  expensive to retrofit once real documents exist in the wild.

## Goals

1. A consumer can evolve a custom node/edge type's `props` shape across versions and have old
   documents migrate automatically on load.
2. Nodus can evolve its own record shape (a future breaking change) via the same mechanism.
3. Migrations respect the git-native moat: canonical output stays deterministic and minimal-diff;
   loading + re-saving an old document produces a *reviewable* diff, never silent corruption.
4. A bad or unknown migration never crashes a document load (defensive-restore parity).

## Non-goals

- Down-migrations (`down`). Up-only; opening-in-an-older-client is handled by preservation, not
  reversal. (YAGNI — revisit only if a concrete need appears.)
- A configurable migration-error policy. The default (fault-isolate) is the only behavior in v1; a
  `RestoreOptions` policy flag can be layered on later without breaking the API.
- Per-field text CRDT / collaborative merge. Out of scope (that's the separate collaboration fork).

## Locked design decisions (from brainstorming)

1. **Scope:** unified — one mechanism serves both consumer custom-shape `props` migrations *and*
   engine record-shape migrations.
2. **Version model:** document-level per-type map (`typeVersions`), not per-record version fields.
3. **Failure model:** fault-isolate per record (drop-on-throw; keep-raw + preserve version on
   forward-version or unregistered type), surfaced as counts in `RestoreResult`.
4. **Registration:** migrations live *on the util* (`NodeUtil.migrations`), colocated with the
   shape definition.

## ⚠️ Refinement from the approved design (please confirm)

In the approved verbal design I said `SCHEMA_VERSION` bumps `1 → 2`. On reflection this spec keeps
**`SCHEMA_VERSION = 1`** and treats `typeVersions` as an **additive, optional, backward-compatible
envelope field**. Rationale:

- Adding an optional field is *not* a breaking schema change, so it does not warrant a version bump
  (the `schemaVersion` bump is reserved for its stated purpose: a real breaking change to the
  engine record shape).
- Bumping to 2 would make `nodus fmt --check` consider **every committed `*.nodus.json` non-canonical**
  (the number in the envelope would change), forcing a repo-wide reformat and a noisy diagrams-CI
  diff across all existing diagrams — directly at odds with the moat.
- A v1 file with no `typeVersions` is interpreted as "every type at version 0" (its pre-migration
  baseline), which is exactly correct.

The engine-migration axis still keys on `schemaVersion`; it stays built-but-empty until the first
real breaking record-shape change, which *will* bump the number and register the transform.

## Architecture

### 1. Data model — `Snapshot` gains `typeVersions`

```ts
export const SCHEMA_VERSION = 1;               // unchanged

export interface Snapshot {
  schemaVersion: number;                       // engine record-shape version
  document: { records: NodusRecord[] };
  typeVersions?: Record<string, number>;       // NEW: shape `type` -> version its props were written at
  meta?: Record<string, unknown>;
}
```

`typeVersions` is keyed by the shape's `type` field (e.g. `'aws:ec2'`, `'straight'`), **not** by
`typeName` (`node`/`edge`/`page`, which is the engine axis governed by `schemaVersion`). It lists
**only types that have migrations** (a type with `migrations.length === 0` is omitted), keeping the
map — and the diff — minimal.

### 2. The migration primitive — on the util

```ts
export type Migration<P = Record<string, unknown>> = (props: P) => P;   // up-only, pure

interface NodeUtil {
  // ...existing fields...
  migrations?: Migration[];      // ordered; the type's CURRENT version === migrations.length
}
interface EdgeUtil { /* ...same optional migrations?: Migration[] */ }
```

Version semantics: a type with `migrations = [m1, m2, m3]` is at **version 3**. A record whose props
were written at version `v` runs steps `migrations[v] … migrations[length-1]` (indices `v`
inclusive to `length-1`) to reach `length`. A record with no `typeVersions` entry is version `0`
and runs the full sequence.

`validateNodeUtil` / `validateEdgeUtil` gain a check: if `migrations` is present it must be an array
of functions (throwing → the util registration is rejected/fault-isolated exactly like today's
`getGeometry`/`draw` validation).

### 3. Engine record-shape migrations

A module-level, ordered array in `serialization`:

```ts
// index === the schemaVersion being migrated FROM; runs on the whole raw record.
const engineMigrations: Array<(r: Record<string, unknown>) => Record<string, unknown>> = [
  // (empty today — first entry lands with the first breaking record-shape change, which bumps SCHEMA_VERSION to 2)
];
```

`restore()` runs `engineMigrations[snapshot.schemaVersion … SCHEMA_VERSION-1]` on each raw record
before the per-type props migrations.

### 4. `restore()` integration — pure by default, registry-aware when asked

`restore(snapshot)` stays a pure, backward-compatible function (no migration when called with one
arg — today's behavior). Migrations arrive via an optional resolver the `Editor` builds from its
registries:

```ts
interface RestoreOptions {
  // returns the type's ordered migrations; undefined => type not registered. current version === steps.length
  resolveMigrations?: (record: { typeName: string; type?: string }) => Migration[] | undefined;
}
export function restore(input: Snapshot, opts?: RestoreOptions): RestoreResult;
```

Per raw record, **in order**:

1. **Engine migrations:** apply `engineMigrations[schemaVersion … SCHEMA_VERSION-1]` (record shape).
2. **Props migrations:** `stored = snapshot.typeVersions?.[record.type] ?? 0`; `steps =
   opts.resolveMigrations?.(record)`; `current = steps?.length ?? 0`. If `steps` and
   `stored < current`: run `steps[stored … current-1]` on `record.props`, wrapped in try/catch.
3. **Normalize:** the existing `normalizeNode/Edge/Page` validates the migrated record.

Migrations run **before** normalize so a single pass yields a validated, current-shape record.

### 5. Failure isolation — `RestoreResult` gains counts

```ts
export interface RestoreResult {
  records: NodusRecord[];
  droppedEdges: number;      // existing
  migrationErrors: number;   // NEW: records dropped because a migration threw
  unmigrated: number;        // NEW: records kept raw (forward-version OR type util not registered)
}
```

- Migration **throws** → drop that record, `migrationErrors++`. (One bad record never loses the
  document.)
- `stored > current` (file written by a newer client/plugin) → **keep raw, preserve version**,
  `unmigrated++`. The record's props (a newer shape) pass through untouched.
- Type util **not registered** (`resolveMigrations` returns undefined) → **keep raw, preserve
  version**, `unmigrated++`.

### 6. Round-trip / save semantics — the `max()` rule

Because migrations are up-only and versions never decrease, the version stamped on **save** must be,
per type: `max(loadedVersion, clientCurrentVersion)`.

- The `Editor` **retains the loaded `typeVersions`** (a small field on the loaded-document state)
  and **computes the merged map** at save time: for each type present that has migrations,
  `max(loaded[type] ?? 0, registeredUtil.migrations.length)`. It passes the result to
  `serializeRecords(records, { typeVersions })`, which simply writes the map it is given
  (`serializeRecords` stays pure — no registry or loaded-state access of its own).
- Consequence: an older client (current v3) that loads a v5 document keeps every v5 record raw and
  **re-stamps `v5`** — never `v3` over v5 props. Forward-compatibility is preserved; a stale CI
  client cannot silently downgrade or strip data it didn't understand.

> Correctness note: because a document's `typeVersions[type]` is single-valued, all records of a
> given type share one version. This is consistent under up-only migration: if `client ≥ stored`,
> *all* records of that type migrate to `client`; if `client < stored`, *all* are kept raw at
> `stored`. There is never a mixed-version type within one document.

### 7. Canonical serialization

`toCanonicalString` emits `typeVersions` in the envelope **only when non-empty**, with sorted keys
via `stableStringify`, e.g.:

```
{"schemaVersion":1,"typeVersions":{"aws:ec2":3},"document":{"records":[
...
]}}
```

Documents that use no migration-bearing types produce **byte-identical** output to today (the field
is omitted) — so `canonical.test.ts` and every committed diagram stay unchanged. Loading an old
document whose types have since gained migrations, then saving, produces a real diff: the migrated
`props` lines change and `typeVersions` appears. That diff is the point — the migration is
code-reviewed in the PR, not applied invisibly.

## Public API surface changes (additive)

- `Migration` type — exported from `@nodus/core`.
- `NodeUtil.migrations?` / `EdgeUtil.migrations?` — optional.
- `RestoreOptions` — exported; `restore(snapshot, opts?)` second parameter.
- `RestoreResult.migrationErrors`, `.unmigrated` — additive fields.
- `serializeRecords(records, opts?)` — `opts.typeVersions` (and existing `meta`).
- `Editor`: builds `resolveMigrations` from its registries and threads it through its load path;
  retains loaded `typeVersions` for the save-side `max()` stamp.

No existing signature is broken; every addition is optional/additive.

## Testing plan

New `packages/core/src/serialization/migrations.test.ts` (+ registry validation test):

1. **Round-trip up-migration:** a util with `migrations=[m1,m2]`; a snapshot with
   `typeVersions:{t:0}` (or absent) → records' props are `m2(m1(props))`; result version stamps at 2.
2. **Partial migration:** `typeVersions:{t:1}` runs only `m2` (step index 1), not `m1`.
3. **Fault isolation:** a throwing migration drops exactly that record (`migrationErrors===1`) and
   keeps the rest; the document still loads.
4. **Forward-version preservation:** current v2 util, snapshot `typeVersions:{t:5}` → record kept
   raw (`unmigrated===1`), props untouched; a serialize→canonical round-trip is **byte-identical**
   (re-stamps `5` via the `max()` rule).
5. **Unregistered type:** `resolveMigrations` returns undefined → kept raw, `unmigrated++`.
6. **Engine migration:** a stub `engineMigrations[1]` transforms a raw record when
   `snapshot.schemaVersion` is behind `SCHEMA_VERSION` (uses a temporary bumped constant in-test).
7. **Registration validation:** a util with `migrations` not an array-of-functions is rejected by
   `validateNodeUtil`.
8. **Canonical stability:** a no-migration document serializes byte-identically to the pre-change
   output; `canonical.test.ts` unchanged. A migrated document's canonical output is deterministic
   across repeated serialize.
9. **Property/invariant:** extend the existing fuzz/invariant suite so a migrate-on-load pass keeps
   the store↔index bijection and toJSON round-trip identity.

## Rollout / compatibility

- `SCHEMA_VERSION` unchanged (`1`); `typeVersions` is additive and ignored by older readers.
- Existing `*.nodus.json` in the repo are unaffected (no field, no reformat, no diagrams-CI churn).
- The first future breaking engine record-shape change bumps `SCHEMA_VERSION` to `2` and adds
  `engineMigrations[1]` — the mechanism is already in place.
- `engine-hardening.test.ts` (which asserts "migration API removed") is updated to assert the new
  contract instead (migrations present, fault-isolated, canonical-stable). It is not weakened or
  deleted — it flips from enforcing absence to enforcing the specified behavior.

## Risks & mitigations

- **Canonical drift:** mitigated by omitting empty `typeVersions` and a byte-identity test for
  no-migration documents.
- **Silent forward-downgrade:** mitigated by the `max()` save rule + preservation test.
- **`restore()` becoming registry-coupled:** avoided — the resolver is an optional injected function,
  so `restore` stays pure and unit-testable without the full editor.
- **Author forgets to bump a version:** the version is *derived* from `migrations.length`, so adding
  a migration step automatically advances the version — there is no separate number to forget.

## File-level change map (for the implementation plan)

- `serialization/index.ts` — `Snapshot.typeVersions`, `RestoreResult` fields, `engineMigrations`,
  `RestoreOptions`, migration execution in `restore()`, `serializeRecords` stamping, `toCanonicalString`
  envelope, keep `SCHEMA_VERSION=1`.
- `registries/index.ts` — `Migration` type; `NodeUtil.migrations?`/`EdgeUtil.migrations?`; validation.
- `editor/index.ts` — build `resolveMigrations` from registries; retain loaded `typeVersions`; thread
  through load/save (`loadSnapshot`, `toJSON`).
- `index.ts` — export `Migration`, `RestoreOptions`.
- `serialization/migrations.test.ts` (new); update `engine-hardening.test.ts`.
- `docs/EXTENDING.md` — document authoring migrations for a custom shape.
