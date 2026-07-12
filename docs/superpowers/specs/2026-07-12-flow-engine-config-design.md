# Flow Engine Config — Design Spec

**Date:** 2026-07-12
**Status:** Approved (design), pending implementation plan
**Sub-project:** ① of the "configurable live flow" initiative

## Context

The engine already has a **flow** feature (`packages/core/src/flow.ts`, `model.ts`,
`renderer/paint.ts`, `editor/index.ts`): animated "packets" (dots) or marching dashes
along an edge, with an optional data-driven `FlowScale` mapping a live scalar metric to
visuals. It is **API-only** today — a host calls `editor.setFlow(...)` and
`editor.setFlowMetric(...)`; the React binding runs a gated rAF loop that ticks only while
`editor.hasFlow()` is true (idle = 0 paints).

The larger goal ("the live flow should be configurable") decomposes into three
independently-shippable sub-projects:

1. **Flow engine config (core + react)** — *this spec*. Global ephemeral runtime knobs.
2. **Per-edge flow authoring UI (react)** — context-menu/inspector to set `FlowSpec`/`FlowScale`.
3. **Live data source binding (core)** — declarative `bindFlowSource(id, source)` adapters.

This spec covers **only sub-project ①**. It is the foundation the other two lean on
(reduced-motion accessibility, global pause/speed, and the rAF-loop changes).

## Scope

Global, **ephemeral** runtime knobs for the flow animation, owned by the editor.

- Per-edge `FlowSpec`/`FlowScale` are **untouched** (still serialized + undoable, document data).
- This config is **not serialized, not undoable** — it is session/runtime state, like the camera.
- No end-user UI in this sub-project (that is ②). Config is set programmatically via
  `editor.setFlowConfig(...)`; the React binding wires OS reduced-motion + the fps cap.

## Decisions (locked during brainstorming)

- **Reduced motion:** honored by default → freeze to a static frame. Host can opt out
  (`respectReducedMotion: false`) to force animation.
- **Off vs pause:** two distinct controls. `enabled:false` hides *all* markers (edges look
  static); `paused:true` freezes markers *in place* (still drawn, no motion).
- **FPS cap:** optional, default uncapped. When set, throttles **only** the self-perpetuating
  flow ticks — interaction/drag repaints stay at full display refresh.
- **Scope:** per-edge data stays on the record; global runtime knobs live on the editor.

## 1. Data model

```ts
export interface FlowRuntimeConfig {
  /** false = draw NO flow markers (edges look static); loop idle. default true */
  enabled: boolean;
  /** true = freeze markers in place (still drawn, no motion); loop idle. default false */
  paused: boolean;
  /** global multiplier applied to every edge's flow speed. default 1 (clamped >= 0) */
  speedScale: number;
  /** honor OS prefers-reduced-motion by freezing to a static frame. default true */
  respectReducedMotion: boolean;
  /** optional cap (fps) on the self-perpetuating flow ticks. undefined = display refresh */
  maxFps?: number;
}

const FLOW_DEFAULTS: FlowRuntimeConfig = {
  enabled: true,
  paused: false,
  speedScale: 1,
  respectReducedMotion: true,
};
```

Plus one **ephemeral environment input** the headless core cannot detect itself:

```ts
editor.setReducedMotion(active: boolean): void   // host feeds OS state; headless default = false
```

`reducedMotion` (environment state) is kept **separate** from `respectReducedMotion`
(policy). Effective freeze from reduced motion = `respectReducedMotion && reducedMotionActive`.

`speedScale` is clamped to `>= 0` on write (a negative global multiplier is meaningless;
per-edge `reverse` controls direction).

## 2. Core mechanism — an internal flow clock

The editor owns a small **flow clock**: `{ clock: number; prevTime: number | null }`.
`paintFlow` advances `clock` by `dt × speedScale` **only while actively animating**. Packet
position becomes a function of `clock`, not of the raw host time.

This single mechanism delivers all four behaviors:

- **paused / reduced-motion / disabled** → stop advancing `clock` → markers hold position →
  **smooth resume** (raw `performance.now()` would otherwise jump forward by the paused duration).
- **speedScale** → advancing by `dt × speedScale` makes a mid-run change smooth; an
  absolute-time model would teleport packets on every change.
- `dt` is **adaptively clamped** — `maxDt = max(64, (maxFps ? 1000/maxFps : 1000/30) × 1.5)` ms,
  and `0` on the first frame — so the first frame after a long idle does not leap, *and* a low
  `maxFps` (e.g. 5) is not throttled below its true frame interval.

Invariant: with `speedScale == 1` and no pause, `clock == hostTime` — so existing tests
(driving `paintFlow` at times `0` then `100`) pass unchanged.

The clock is **live-path only**. The snapshot path (`paintRegion`) stays stateless: it renders
at the explicitly-passed `opts.time` and never mutates the live clock.

## 3. Behavior table

| Config                                   | `isFlowAnimating()`        | `paintFlow` draws        | clock            |
| ---------------------------------------- | -------------------------- | ------------------------ | ---------------- |
| default (enabled, not paused)            | true (if edges have flow)  | markers, animated        | advances ×scale  |
| `enabled:false`                          | false                      | **nothing**              | frozen           |
| `paused:true`                            | false                      | markers, frozen in place | frozen           |
| reduced-motion active + respect          | false                      | markers, frozen in place | frozen           |
| reduced-motion + `respectReducedMotion:false` | true (if edges flowing) | animated (host override) | advances         |

"Frozen" = markers drawn at the held `clock` value; no rAF re-arm.

## 4. API surface (editor)

```ts
flowConfig(): Readonly<FlowRuntimeConfig>              // merged with defaults
setFlowConfig(patch: Partial<FlowRuntimeConfig>): void // merge -> write atom -> repaint (NOT undoable)
flowConfigAtom: Atom<FlowRuntimeConfig>                // React tracks it, like cameraAtom
setReducedMotion(active: boolean): void
isFlowAnimating(): boolean                             // NEW loop gate: enabled && !frozen && any edge flowing

// thin sugar over setFlowConfig:
pauseFlow(): void        // setFlowConfig({ paused: true })
resumeFlow(): void       // setFlowConfig({ paused: false })
setFlowEnabled(b: boolean): void
setFlowSpeedScale(n: number): void
```

`hasFlow()` is **unchanged** (`some edge has a flow spec`) — the MCP traffic-snapshot default
(`packages/mcp/src/session.ts:362`) and any doc-truth callers keep working. The rAF loop is
the only caller that migrates to `isFlowAnimating()`.

`setFlowConfig` writes `flowConfigAtom` (merge patch over current). It does **not** go through
the command/history system — ephemeral runtime state, no undo entry.

## 5. Renderer / editor changes

- **`paintFlow(ctx, dpr, time)`** (live path), in order:
  1. `dt = prevTime == null ? 0 : clamp(time - prevTime, 0, maxDt)` where
     `maxDt = max(64, (maxFps ? 1000/maxFps : 1000/30) × 1.5)`; then `prevTime = time` (always,
     so `dt` is measured from the last paint regardless of the branch taken below).
  2. `frozen = paused || (respectReducedMotion && reducedMotion)`.
  3. If `!enabled` → draw nothing, return (`clock` untouched).
  4. If `!frozen` → `clock += dt × speedScale`.
  5. Draw each visible flowing edge at `clock` via the shared helper.
- **`paintRegion` snapshot path** (`editor/index.ts` ~1104): stays **stateless** — honors
  `enabled` (skip when false) and applies `speedScale` statically to `opts.time`; **ignores**
  `paused`/reduced-motion (an explicit snapshot at time T). Never touches the live clock.
- Factor a private **`drawFlowEdges(ctx, time, opts?)`** helper so `paintFlow` and `paintRegion`
  share the per-edge resolve + `speedScale` fold without duplication.
- **`paintFlowMarkers`** (pure renderer, `renderer/paint.ts`): **unchanged** — stays
  config-agnostic, receives the already-resolved spec + effective time.

## 6. React changes (`@nodus/react`)

- Add `editor.flowConfigAtom.get()` (and the reduced-motion signal) to the tracked `effect()`
  so config changes trigger a repaint.
- rAF gate: `editor.hasFlow()` → **`editor.isFlowAnimating()`** (`index.tsx:58`).
- On mount: wire `matchMedia('(prefers-reduced-motion: reduce)')` → initial
  `editor.setReducedMotion(mq.matches)` + a `change` listener; remove listener on unmount.
  Headless/napi hosts simply never call `setReducedMotion` → default `false`.
- **maxFps throttle**: only the *self-perpetuating flow re-arm* is throttled — repaint for
  flow only when `now - lastFlowPaint >= 1000 / maxFps`; otherwise re-arm after the remaining
  wait. Signal-driven interaction repaints (drag/pan) are never throttled. No-op when
  `maxFps` is unset (current behavior).

## 7. Edge cases handled

- Long-idle `dt` leap → clamp.
- speedScale change mid-run → no teleport (clock integrates dt×scale).
- pause → resume → no jump-forward (frozen clock).
- config change while paused/dragging → repaints frozen markers along updated routes.
- snapshot path independent of live clock state.
- `enabled:false` while edges have flow → `isFlowAnimating()` false, 0 markers, loop idle.

## 8. Testing

**Core (headless, new `packages/core/src/__tests__/flow-config.test.ts`)** using the existing
`mockCtx()` (records `arc()` calls) + direct `ed.paintFlow(ctx, dpr, time)`:

- defaults: `flowConfig()` returns defaults; `isFlowAnimating()` tracks edges.
- `enabled:false` → 0 arcs; `isFlowAnimating()` false; `hasFlow()` still true.
- `paused:true` → arcs drawn, positions **identical** across advancing times; resume continues
  from the frozen phase (not from 0, not jumped forward).
- `speedScale:2` → ~double advance per unit time vs `1`; changing scale mid-run does not
  teleport (position continuous across the change).
- `respectReducedMotion` + `setReducedMotion(true)` → frozen; `setReducedMotion(false)` →
  animates; `respectReducedMotion:false` + reduced-motion true → animates (host override).
- dt clamp: a large time gap does not produce a large position jump.
- snapshot path (`paintRegion`/render with `opts.flow`): `enabled:false` suppresses; `speedScale`
  applies statically; unaffected by live clock.
- regression: existing `flow.test.ts` / `flow-data.test.ts` stay green.

**React**: `maxFps` throttle + matchMedia wiring verified via the playwright browser-verify
harness driving `editor.setFlowConfig(...)` from the console (no UI in this sub-project).

## 9. Alternatives considered

- **B — keep stateless absolute-time; config only gates drawing.** Simpler, but pause→resume
  jumps forward by the paused duration and speedScale changes teleport packets. Rejected: the
  chosen freeze-in-place pause requires a stoppable clock regardless.
- **C — no engine object; all knobs per-edge.** Rejected by the agreed per-edge + global-engine
  scope (no global pause / reduced-motion / speed without touching every edge).

## Out of scope (later sub-projects)

- Per-edge authoring UI (context menu / inspector) — sub-project ②.
- Live data source binding / subscriptions — sub-project ③.
- Persisting any of these knobs to the document.

## Notes

- Repo is **not** a git repository, so this design is written to disk but not committed.
