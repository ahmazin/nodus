---
layout: ../../layouts/DocsLayout.astro
title: Data schema
description: The .nodus.json document model — flat, tagged-union records with canonical, git-diffable serialization.
---

The diagram document model lives in `@nodus-dev/core` (`model.ts` + `serialization/index.ts`) and is at
`SCHEMA_VERSION = 1`. It's **flat**: every record is a tagged-union POJO with a `typeName`
discriminator, and grouping/connectivity are expressed by **id-reference, never nesting**. That
flatness is what lets each record serialize to exactly one sorted line — so a git diff of a diagram is
`+1` line per add, `-1` per delete, and one changed line per in-place edit.

## Document envelope

The whole diagram is a `Snapshot` — the on-disk `*.nodus.json`:

```ts
interface Snapshot {
  schemaVersion: number;                   // currently 1
  document: { records: NodusRecord[] };    // the entire diagram
  typeVersions?: Record<string, number>;   // per-shape-type props version (drives migrations)
  meta?: Record<string, unknown>;          // DOCUMENT-level; NOT written to disk (≠ per-record meta)
}
```

On disk it is canonical JSON: one record per line, keys sorted, trailing newline.

```json
{"schemaVersion":1,"document":{"records":[
{"h":74,"id":"node:aws_lb.edge","label":"edge","props":{"key":"aws_lb.edge"},"type":"infra.lb","typeName":"node","visual":{"state":"accent"},"w":74,"x":0,"y":0,"z":"0000000000"},
{"from":{"kind":"node","nodeId":"node:aws_lb.edge","portId":"out"},"id":"edge:0x25xe7","props":{},"to":{"kind":"node","nodeId":"node:aws_instance.api","portId":"in"},"type":"infra.connector","typeName":"edge","visual":{"state":"solid"}}
]}}
```

## Records

Every record extends `BaseRecord`; three built-in kinds are discriminated by `typeName`:

```ts
interface BaseRecord<TN> {
  id: Id<TN>;                    // `${typeName}:${string}`  e.g. "node:aws_lb.edge"
  typeName: TN;                  // 'node' | 'edge' | 'page'  (the discriminator)
  version: number;               // runtime mutation counter — STRIPPED from disk
  style?: Partial<StateTokens>;  // per-record theme-token overrides
}

type NodusRecord = NodeRecord | EdgeRecord | PageRecord;
```

> **Field whitelist — where extension data belongs.** On load, each record is rebuilt from exactly
> the fields listed below; anything else is **dropped and reported** as an `unknown-field` issue
> (so `nodus fmt` refuses the rewrite as lossy instead of silently deleting it). The sanctioned
> slots for third-party/tool data are **`props`** (interpreted by the registered util) and
> **`meta`** (host scratch, round-trips untouched) — put custom annotations there, never at the
> record's top level.

| Record | `typeName` | Key fields |
| --- | --- | --- |
| **Node** | `'node'` | `type` (registry key, e.g. `infra.db`), `x` `y` `w` `h`, `rotation?`, `z` (fractional-index **string**), `visual`, `props`, `label?`, `locked?`, `hidden?`, `parentId?`, `pageId?`, `meta?` |
| **Edge** | `'edge'` | `type`, `from`/`to` (`Endpoint`), `visual`, `flow?`, `pageId?`, `props`, `label?`, `meta?` — **no geometry**; the routed polyline is *derived* from endpoints |
| **Page** | `'page'` | `name`, `index` |

```ts
interface NodeRecord extends BaseRecord<'node'> {
  type: string; x: number; y: number; w: number; h: number;
  rotation?: number; z: string;
  locked?: boolean;    // interaction guard (distinct from the 'locked' visual skin)
  hidden?: boolean;    // in-document but not rendered/hit-tested (distinct from 'ghost')
  parentId?: Id;       // group / frame parent, by id-reference
  pageId?: Id<'page'>; // page membership — absent ⇒ implicit / first page (see note below)
  visual: VisualState; label?: string;
  props: Record<string, unknown>;   // interpreted by the registered NodeUtil
  meta?: Record<string, unknown>;   // host scratch (core never reads it) — but DOES persist / round-trip
}

interface EdgeRecord extends BaseRecord<'edge'> {
  type: string; from: Endpoint; to: Endpoint;
  pageId?: Id<'page'>;              // page membership (see NodeRecord)
  visual: VisualState; label?: string;
  flow?: FlowSpec;                  // animated packets / marching dashes
  props: Record<string, unknown>;
  meta?: Record<string, unknown>;
}
```

> **Page membership (`pageId`).** Nodes and edges carry an optional `pageId` (an id-reference to a
> `PageRecord`) in the core model + serialization, with a load migration. It is **omit-when-implicit**:
> a document with no `PageRecord` is a single implicit page and carries no `pageId` (so a pre-pages
> diagram round-trips byte-identically); once any `PageRecord` exists, every node/edge is explicit, and
> `restore()` backfills/repoints a missing or dangling `pageId` to the first page. Distinct from
> `parentId` (a group/frame parent, never a page). The editor/render wiring — an active-page atom,
> per-page culling (one scene-index predicate behind render, hit-test and marquee), and page CRUD
> (`createPage` / `moveToPage` / `deletePage`) — is implemented; a page-switcher UI is the remaining
> layer. See `docs/specs/page-membership.md`.

## Supporting types

```ts
// edge endpoints — a fixed port, a sliding outline attachment, or a free world point
type Endpoint =
  | { kind: 'node';    nodeId: Id<'node'>; portId?: string; anchor?: Vec2 }
  | { kind: 'outline'; nodeId: Id<'node'> }
  | { kind: 'point';   x: number; y: number };

// visual status — theme slices layer base < byType < state < overlay < focus
interface VisualState { state: NodeState; overlay?: string; focused?: boolean }
type NodeState = 'accent' | 'solid' | 'ghost' | 'locked' | (string & {}); // open union — presets extend it

// per-edge animated flow; `scale` maps a live metric to the visuals (data-driven flow)
interface FlowSpec {
  speed?: number; color?: string; style?: 'dots' | 'dash';
  size?: number; count?: number; reverse?: boolean;
  scale?: FlowScale; data?: number;
}
interface FlowScale {
  domain: [number, number];
  speed?: [number, number]; count?: [number, number]; size?: [number, number];
  colors?: { at: number; color: string }[]; gradient?: boolean;
}

// geometry primitives
type Id<T extends string = string> = `${T}:${string}`;
interface Vec2 { x: number; y: number }
interface Box  { x: number; y: number; w: number; h: number }
```

## The change vocabulary

Records never mutate in place — every change is one of three ops through `store.apply`:

```ts
type Change =
  | { op: 'add';    record: NodusRecord }
  | { op: 'update'; id: Id; patch: Record<string, unknown> }
  | { op: 'remove'; id: Id };

type CapturePolicy = 'immediately' | 'later' | 'never';   // undo grouping — see Concepts
type ChangeSource  = 'user' | 'remote' | 'program';
```

## What is *not* serialized

The moat is byte-stability, so anything volatile is excluded from canonical output — otherwise every
save would churn the diff:

- **`version`** — the per-record mutation counter (re-defaulted on load; drives diff/render caches only).
- **`Snapshot.meta`** — the *document-envelope* meta (e.g. `updated`, `exportedBy`); `toCanonicalString`
  never emits it. ⚠️ This is a **different field** from per-record `meta`: `NodeRecord.meta` /
  `EdgeRecord.meta` **do persist** (they round-trip via `canonicalRecord` → `normalizeNode`/`normalizeEdge`).
  Same name, opposite contract — a known footgun.
- **Camera, selection** — session state, like the viewport.
- **Flow runtime config** (`enabled` / `paused` / `speedScale` / `respectReducedMotion` / `maxFps`) and
  **flow sources** (live `poll` / `subscribe` feeds) — ephemeral, never historied.
- **Edge route points** — derived from endpoints each frame, never stored.

## Canonical serialization

`toCanonicalString` is the single on-disk byte contract, and it's valid JSON (so GitHub renders it with
highlighting + intra-line word-diff, and `restore()` can `JSON.parse` it):

- Object keys emitted in **sorted** order; `undefined`-valued keys dropped.
- **Array order preserved** — it is meaningful (route waypoints, flow color stops).
- Records **sorted by identity**, one per line → minimal, reviewable diffs.
- `hidden` is omit-when-false; non-finite numbers serialize as `null` (surfaced via an error hook).
- `typeVersions` sits between `schemaVersion` and `document`, driving per-shape `props` migrations on load.

> **These bytes are a breaking contract.** The exact output of `toCanonicalString` is a stable,
> versioned public API — real diagrams commit it to git, and a merge driver, `diff`, and code review
> all depend on it not shifting under them. A change that alters the bytes for the *same* document
> (key order, number formatting, record sort, field omission) is a **semver-breaking** change, even
> when no field is added or removed. Checked-in golden fixtures
> (`packages/core/src/__tests__/fixtures/*.nodus.json`, verified by `golden-fixtures.test.ts`) pin the
> format on every PR. If a change to them is intentional, regenerate with
> `pnpm exec tsx scripts/gen-fixtures.ts`, review the diff, and land the regenerated fixtures **plus a
> changeset** in the same PR; an incidental fixture change is CI telling you a byte-level contract just
> moved.

See **[Concepts →](/docs/concepts)** for how records flow through the one mutation channel, and the
**[CLI →](/docs/cli)** for `fmt` / `diff`, which turn this format into code-reviewed diagrams.
