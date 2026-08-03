# Flow Data Sources — Design Spec

**Date:** 2026-07-12
**Status:** Approved (design), pending implementation plan
**Sub-project:** ③ of the "configurable live flow" initiative

## Context

Sub-project ① (flow engine config) shipped. Data-driven flow already works: an edge's
`FlowSpec.scale` (a `FlowScale`) maps a live scalar **metric** to visuals, and the host feeds
metrics via `editor.setFlowMetric(id, value)` / `setFlowMetrics(entries)` into an ephemeral
`flowMetrics: Map<Id, number>`, read each frame by `paintFlow` (via `resolveFlow`).

Today the host must hand-call `setFlowMetric` on every tick (poll a REST endpoint in a loop,
or wire a websocket by hand). This sub-project adds a **declarative binding** —
`editor.bindFlowSource(id, source)` — so a live feed drives an edge without the host running
its own tick loop.

This is sub-project ③ of three (① engine config — done; ② per-edge authoring UI — later; this).
It is a small, core-only addition; no React changes, no new visuals.

## Scope

- Feed the existing ephemeral `flowMetrics` map from a declarative source (pull or push).
- **Ephemeral** — sources are **not serialized, not undoable** (a `FlowSource` holds functions).
- Core-only (`@nodus-dev/core`). No renderer, model-visual, or React changes.
- Not in scope: repainting a **frozen/paused** edge on metric change (a ② visual concern);
  making `flowMetrics` reactive; validating that the id is a scaled edge (binding is permissive,
  like `setFlowMetric`).

## Decisions (locked during brainstorming)

- **Source model:** both **pull** (`poll` + `intervalMs`) and **push** (`subscribe`).
- **Poll cadence:** engine-owned `setInterval` per pull source (immediate first poll; overlapping
  in-flight polls skipped). Tests drive it with fake timers.
- **Error policy:** swallow, keep the edge's last metric, keep polling; optional per-source
  `onError(err)` hook for observability.

## 1. Data model

`FlowSource` in `packages/core/src/model.ts` (types-only; auto-exported via the barrel
`export * from './model.js'`):

```ts
/**
 * A declarative live feed for a data-driven edge's flow metric — bound via `editor.bindFlowSource`.
 * EPHEMERAL: never serialized or historied (it holds functions). Two shapes:
 *  - pull: `poll` every `intervalMs` (engine-owned timer); overlapping in-flight polls are skipped.
 *  - push: `subscribe(emit)` and return an unsubscribe; the source pushes values on its own cadence.
 * A poll/subscribe error is swallowed (last metric kept, feed keeps running) and reported to `onError`.
 */
export type FlowSource =
  | { poll: () => number | Promise<number>; intervalMs: number; onError?: (err: unknown) => void }
  | { subscribe: (emit: (value: number) => void) => (() => void); onError?: (err: unknown) => void };
```

## 2. API (editor)

Added near the `flowMetrics` region (`editor/index.ts`, ~line 1049):

```ts
bindFlowSource(id: Id, source: FlowSource): Dispose  // replaces any existing binding for id; returns an unbinder
unbindFlowSource(id: Id): void                       // stops + removes the source for id (idempotent)
clearFlowSources(): void                             // unbinds all
```

Internal storage: `private readonly flowSources = new Map<Id, () => void>()` — id → teardown
(clears the interval for pull, calls unsubscribe for push).

## 3. Behavior

`bindFlowSource(id, source)`:
1. `this.unbindFlowSource(id)` first — rebinding replaces (old teardown runs).
2. Define `emit = (value) => { if (Number.isFinite(value)) this.setFlowMetric(id, value); }` — a
   non-finite tick (NaN/Infinity/undefined) is ignored, never poisoning the metric.
3. **Pull** (`'poll' in source`): an `inFlight` guard; `tick()` = if `inFlight` return, else set
   `inFlight`, `emit(await source.poll())` in try, `source.onError?.(e)` in catch, clear `inFlight`
   in finally. Call `tick()` once immediately, then `setInterval(() => void tick(), intervalMs)`.
   teardown = `clearInterval(handle)`.
4. **Push** (else): `unsub = source.subscribe(emit)` in try (→ `onError`, no-op unsub on throw);
   teardown = call `unsub()` in try (→ `onError`).
5. Store `flowSources.set(id, teardown)`; return `() => this.unbindFlowSource(id)`.

`unbindFlowSource(id)`: run + delete the teardown if present (idempotent).
`clearFlowSources()`: run all teardowns, clear the map.

Consumption is unchanged: `emit` writes the ephemeral `flowMetrics` map; the animation loop reads
it each frame for flowing edges (the live-dashboard case). No explicit repaint is triggered.

## 4. Lifecycle / leak safety

Registered once in the constructor, pushed to the existing `disposers[]`:

- **Auto-unbind on edge removal:** `this.onChange(() => { for (const id of [...this.flowSources.keys()])
  if (!this.store.peek(id)) this.unbindFlowSource(id); })`. Runs on every store change; robust
  against delete **and** undo (a bound edge that no longer exists is unbound, so its interval /
  subscription stops). `flowSources` is small, so the per-change scan is cheap.
- **Dispose:** `this.disposers.push(() => this.clearFlowSources())`, so `editor.dispose()` tears
  down every source — no interval or subscription outlives the editor.

## 5. Testing

Headless, new `packages/core/src/__tests__/flow-sources.test.ts` (uses the `build()` edge fixture
pattern from the sibling flow tests):

**Push:**
- bind with `subscribe` capturing `emit`; `emit(5)` → `editor.flowMetric(id) === 5`.
- `emit(Number.NaN)` → metric unchanged (finite guard).
- the returned `Dispose` and `unbindFlowSource` both call the source's unsubscribe (spy).
- rebinding an id disposes the old source (old unsubscribe called).

**Pull (`vi.useFakeTimers()`):**
- bind `{ poll: () => 42, intervalMs: 1000 }`; after the immediate poll flushes → metric `42`.
- advance 1000ms → polls again; when `poll` returns `43` → metric `43`.
- **in-flight skip:** a `poll` returning a not-yet-resolved promise; advancing another interval
  before it resolves does not start a second poll (assert `poll` call count).
- **error:** `poll` rejects → `onError` called, metric keeps its last value, polling continues
  (next interval still polls).

**Lifecycle:**
- bind a pull source, `deleteRecords([edgeId])` → source unbound (poll count stops growing after
  the delete; `flowSources` no longer holds the id).
- `editor.dispose()` → all sources torn down (intervals cleared; no polls after dispose).

Async + fake timers via `await vi.advanceTimersByTimeAsync(ms)` (flushes the awaited poll).

## 6. Alternatives considered

- **Push-only or pull-only** — rejected; the brainstorm chose both (polling REST + subscription
  streams are both first-class live-data styles).
- **Piggyback polling on the render loop** — rejected; it would stop polling when flow is
  paused/disabled/off-screen, giving stale data on resume. Engine-owned timers decouple cadence.
- **Host-driven `pollFlowSources()`** — rejected; it re-introduces the hand-tick this sub-project
  removes.
- **Reactive `flowMetrics` (repaint on every emit)** — deferred; the animating loop already
  consumes metrics for flowing edges, and repaint-while-frozen is a ② visual concern.

## Out of scope (later)

- Per-edge authoring UI to bind sources (sub-project ②).
- Any persistence of sources.
- Repainting frozen/idle edges on metric change.

## Notes

- `StoreListener = (info: ChangeInfo) => void`; the auto-unbind handler ignores `info` and
  re-scans bound ids via `store.peek`.
- Repo default branch is `mainline`; work is on `flow-data-sources`.
