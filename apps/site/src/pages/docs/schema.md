---
layout: ../../layouts/DocsLayout.astro
title: Data schema
description: The .nodus.json document model — flat, tagged-union records with canonical, git-diffable serialization.
---

The diagram document model lives in `@nodus/core` (`model.ts` + `serialization/index.ts`) and is at
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
  meta?: Record<string, unknown>;          // in-memory only — NOT written to disk
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

| Record | `typeName` | Key fields |
| --- | --- | --- |
| **Node** | `'node'` | `type` (registry key, e.g. `infra.db`), `x` `y` `w` `h`, `rotation?`, `z` (fractional-index **string**), `visual`, `props`, `label?`, `locked?`, `hidden?`, `parentId?`, `meta?` |
| **Edge** | `'edge'` | `type`, `from`/`to` (`Endpoint`), `visual`, `flow?`, `props`, `label?`, `meta?` — **no geometry**; the routed polyline is *derived* from endpoints |
| **Page** | `'page'` | `name`, `index` |

```ts
interface NodeRecord extends BaseRecord<'node'> {
  type: string; x: number; y: number; w: number; h: number;
  rotation?: number; z: string;
  locked?: boolean;    // interaction guard (distinct from the 'locked' visual skin)
  hidden?: boolean;    // in-document but not rendered/hit-tested (distinct from 'ghost')
  parentId?: Id;       // group / frame parent, by id-reference
  visual: VisualState; label?: string;
  props: Record<string, unknown>;   // interpreted by the registered NodeUtil
  meta?: Record<string, unknown>;   // host scratch — never on disk
}

interface EdgeRecord extends BaseRecord<'edge'> {
  type: string; from: Endpoint; to: Endpoint;
  visual: VisualState; label?: string;
  flow?: FlowSpec;                  // animated packets / marching dashes
  props: Record<string, unknown>;
  meta?: Record<string, unknown>;
}
```

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
- **`meta`** — volatile keys (`updated`, `exportedBy`) that would change every save.
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

See **[Concepts →](/docs/concepts)** for how records flow through the one mutation channel, and the
**[CLI →](/docs/cli)** for `fmt` / `diff`, which turn this format into code-reviewed diagrams.
