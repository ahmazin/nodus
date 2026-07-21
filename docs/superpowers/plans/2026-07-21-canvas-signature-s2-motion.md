# Canvas Signature — S2 Motion & Feel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the (now premium-looking) canvas *feel* premium: spring-eased node drag with a grab-lift, momentum/inertia pan, entrance fade+scale with a staggered cascade on load/import, animated auto-layout, a gently pulsing selection halo + marching-ant outline, and an optional subtle idle shimmer — all built on the K2 animation clock, all honoring reduced-motion.

**Architecture:** Every motion drives the **ephemeral presentation layer** (`id→{alpha,scale,dx,dy}`, already read by `paintItem`) or the camera atom — never the stored record. So undo, snapping, and serialization stay exact while visuals spring. Continuous animations (pulse, shimmer) ride the existing `armFlow` rAF throttle via new reduced-motion-aware gate predicates OR-ed into the host loop.

**Tech Stack:** TypeScript strict, Vitest (node), the K2 `AnimationClock`/`TweenSpec`/presentation map, `performance.now()`-fed `render(time)`, `playwright-core`/chrome-devtools for feel verification.

## Global Constraints

- Static gate `pnpm typecheck` after every task (no eslint/prettier). Tests under `environment: 'node'` (no jsdom) — cover the *logic* (presentation seeding, decay math, reduced-motion snap, gate predicates); *feel* is browser-verified at plan end.
- **No new dependencies.** Core has zero DOM/framework deps.
- **Nothing enters the document/undo/canonical.** Committed node positions (`setPositionsAbsolute`) and camera stay truthful; all motion is presentation/camera-only. Canonical tests stay green.
- **Reduced motion disables ALL of it:** tweens snap to final (K2), momentum does not fling, the pulse + shimmer freeze. Reuse `reducedMotionAtom`.
- **Committed drag positions stay exact** (grab-lift is presentation scale only; layout applies final positions to the store immediately then tweens the *visual* offset to zero).
- Route mutations through `store.apply`/editor helpers. No core `switch`-on-type.

## Key existing interfaces (from the seam audit)
- `editor.animate(spec: TweenSpec): () => void` — `TweenSpec = {from,to,durationMs,easing?,delayMs?,onTick(v),onDone?}`; bumps `animationEpochAtom`; snaps to final under reduced motion. `editor.isAnimating()`.
- `editor.setPresentation(id,{alpha?,scale?,dx?,dy?})` / `presentationFor(id)` / `clearPresentation(id)`. `paintItem` applies it about the aabb center.
- Easings exported from core: `linear`, `easeOutCubic`, `easeInOutCubic`.
- `editor.panByScreen(dx,dy)` → `setCamera` (cameraAtom). `editor.reducedMotionAtom`, `editor.selectedAtom`.
- Host rAF gate (`nodus-host.tsx:84`): `if (editor.isFlowAnimating() || editor.isAnimating()) armFlow();` — throttled by `flowConfig().maxFps`.
- Drag: `SelectTool.beginTranslate()` (grab; has `this.dragIds`, `this.origPos`), `onPointerUp` `state==='translating'` branch (release, after `editor.mark()`).
- `render(ctx,cssW,cssH,dpr,interactive,time)` passes `time` to `animClock.step` + `paintFlow` but NOT to `paintInteractive`.

---

## File Structure
- `packages/core/src/editor/index.ts` — MODIFY: `hasAnimatedSelection()`, `startPanMomentum()`, `animateEntrance()`, layout tween; thread `time` into `paintInteractive` + the pulse; `render` passes time to `paintInteractive`.
- `packages/react/src/nodus-host.tsx` — MODIFY: host gate OR-in the new predicates; pointer-velocity sampling for momentum.
- `packages/core/src/tools/index.ts` — MODIFY: grab-lift in `beginTranslate`, spring-back on release; entrance on Create tool.
- `packages/preset-infra/src/facade.ts` — MODIFY: entrance cascade after load.
- `packages/from-mermaid/src/index.ts` — MODIFY: entrance after import.
- Tests: `editor/animation-integration.test.ts` (extend), new `editor/motion.test.ts`, `tools` tests, plus a browser drive.

---

### Task 1: Animated selection — pulse halo + marching ants

**Files:**
- Modify: `packages/core/src/editor/index.ts` (`paintInteractive` gets `time`; `render` passes it; `hasAnimatedSelection()`; pulse the halo + dash offset)
- Modify: `packages/react/src/nodus-host.tsx` (gate OR-in `hasAnimatedSelection()`)
- Test: `packages/core/src/editor/motion.test.ts` (create) — `hasAnimatedSelection()` truth table; and the halo pulse varies with time but is static under reduced motion.

**Interfaces:**
- Produces: `editor.hasAnimatedSelection(): boolean` = `selectedAtom.peek().size > 0 && !reducedMotionAtom.peek()`. `paintInteractive(ctx, cssW, cssH, dpr, time = 0)` — new 5th param; `render` passes `time`. Inside, when `!reducedMotion`, the selection halo's `shadowBlur` breathes (`12 + 4*Math.sin(time/500)`) and marching-ant dashed outlines set `ctx.lineDashOffset = -(time/50)` before their `strokeWorldBox`. Under reduced motion: today's static values.

- [ ] **Step 1: Write the failing test** — `packages/core/src/editor/motion.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Editor } from '../index.js';

function edWithNode(): { ed: Editor; id: string } {
  const ed = new Editor({ viewport: { w: 800, h: 600 } });
  const id = ed.createNode({ type: 'rect', x: 100, y: 100, w: 80, h: 40 });
  return { ed, id };
}

describe('hasAnimatedSelection', () => {
  it('is false with nothing selected, true with a selection, false under reduced motion', () => {
    const { ed, id } = edWithNode();
    expect(ed.hasAnimatedSelection()).toBe(false);
    ed.select([id]);
    expect(ed.hasAnimatedSelection()).toBe(true);
    ed.setReducedMotion(true);
    expect(ed.hasAnimatedSelection()).toBe(false);
  });
});
```

(For the pulse-varies-with-time assertion, drive `render` with a recording ctx at two `time` values and assert the halo stroke's `shadowBlur` differs when a node is selected and `!reducedMotion`, and is identical under reduced motion. Reuse the recording-ctx pattern from `selection-halo.test.ts`.)

- [ ] **Step 2: Run — expect FAIL** (`hasAnimatedSelection` undefined): `pnpm exec vitest run packages/core/src/editor/motion.test.ts`

- [ ] **Step 3: Implement** — in `editor/index.ts`:
  - Add `hasAnimatedSelection(): boolean { return this.selectedAtom.peek().size > 0 && !this.reducedMotionAtom.peek(); }` next to `isAnimating()`.
  - Change `paintInteractive(ctx, _cssW, _cssH, dpr)` → `paintInteractive(ctx, _cssW, _cssH, dpr, time = 0)`. In `render`, change the interactive call to `this.paintInteractive(ctx, cssW, cssH, dpr, time)`.
  - In the halo block, compute `const pulse = this.reducedMotionAtom.peek() ? 12 : 12 + 4 * Math.sin(time / 500);` and use `ctx.shadowBlur = pulse`.
  - For the multi-select dashed box and the single-select dashed lock/marquee, set `if (!this.reducedMotionAtom.peek()) ctx.lineDashOffset = -(time / 50);` before the dashed `strokeWorldBox` and reset `ctx.lineDashOffset = 0` after (wrap so it doesn't leak). (`strokeWorldBox` inherits the current `lineDashOffset`.)
  - In `nodus-host.tsx:84`, change the gate to `if (editor.isFlowAnimating() || editor.isAnimating() || editor.hasAnimatedSelection()) armFlow();`. (The reaction already subscribes to `selectedAtom` + `reducedMotionAtom`, so the loop starts/stops correctly.)

- [ ] **Step 4: Run — expect PASS** + `pnpm exec vitest run packages/core`.
- [ ] **Step 5: Typecheck. Report to controller.**

---

### Task 2: Spring drag + grab-lift

**Files:**
- Modify: `packages/core/src/tools/index.ts` (`SelectTool`: grab-lift in `beginTranslate`, spring-back on release/exit)
- Test: `packages/core/src/tools/*` (a focused test driving a drag and asserting presentation scale is set on grab and cleared after release), or `editor/motion.test.ts`.

**Interfaces:**
- Consumes: `editor.animate`, `setPresentation`, `clearPresentation`.
- Produces: on `beginTranslate()`, each dragged id animates `scale 1→1.03` over ~120ms (grab-lift held during drag). On release (`onPointerUp` `translating` branch) and on `onExit` while translating, each dragged id animates `scale →1` over ~180ms then `clearPresentation(id)`. Committed positions unchanged. A `LIFT = 1.03` constant. Store the cancel fns so a re-grab cancels a pending spring-back.

- [ ] **Step 1: Write the failing test** — drive a drag through the SelectTool (pointerDown on a node → move > threshold → up) and assert: after the move (mid-drag) `editor.presentationFor(id)?.scale` is > 1 (lifted); after release + advancing the clock past the spring, `presentationFor(id)` is undefined (cleared). Reuse how existing tool tests simulate pointer events + advance the clock (`editor.animClockStep` or `render` with time). If no tool-pointer harness exists, test the editor-level effect by calling the same `animate`/presentation the tool uses.

- [ ] **Step 2: Run — expect FAIL**.

- [ ] **Step 3: Implement** — in `SelectTool`:
  - Add a field `private liftCancels = new Map<Id, () => void>();`.
  - In `beginTranslate()`, after `this.dragIds = ids;`, for each id: cancel any existing lift, then `this.liftCancels.set(id, this.editor.animate({ from: this.editor.presentationFor(id)?.scale ?? 1, to: LIFT, durationMs: 120, easing: easeOutCubic, onTick: (v) => this.editor.setPresentation(id, { scale: v }) }));`.
  - Add a `private releaseLift()` that, for each id in `this.dragIds`, cancels the grab tween and animates `scale → 1` over 180ms, `onDone: () => this.editor.clearPresentation(id)`; clear `liftCancels`. Call it in the `onPointerUp` `translating` branch (after `editor.mark()`) and in `onExit` when translating.
  - Import `easeOutCubic`, `LIFT`.

- [ ] **Step 4: Run — expect PASS** + `pnpm exec vitest run packages/core`.
- [ ] **Step 5: Typecheck. Report to controller.**

---

### Task 3: Momentum / inertia pan

**Files:**
- Modify: `packages/core/src/editor/index.ts` (`startPanMomentum`)
- Modify: `packages/react/src/nodus-host.tsx` (sample release velocity, call it)
- Test: `packages/core/src/editor/motion.test.ts` (append) — the decay pans the camera by ~the total fling distance over its ticks; reduced motion → no pan.

**Interfaces:**
- Produces: `editor.startPanMomentum(vx: number, vy: number): void` — screen px/ms velocity. If `reducedMotionAtom` is set OR `hypot(vx,vy)` below a threshold, no-op. Otherwise compute total fling `D = (vx,vy) * DECAY_MS` (e.g. 320ms time constant) and `animate` a scalar `progress 0→1` easeOutCubic over `DECAY_MS`, per tick `panByScreen(Dx*(p-lastP), Dy*(p-lastP))` (incremental residual), so the camera glides `D` and decelerates. Host: sample velocity from the last pan move's `delta/dt` (timestamped), and call `startPanMomentum` in `onPointerUp`'s `panning` branch.

- [ ] **Step 1: Write the failing test** — `startPanMomentum(1, 0)` (1 px/ms rightward): step the clock across the decay and assert the camera's `x` moved by approximately `-D` (panByScreen(dx) shifts camera by `-dx/z`… assert the total screen pan ≈ `vx*DECAY_MS` by summing camera deltas or checking final camera). With `setReducedMotion(true)`, `startPanMomentum(1,0)` leaves the camera unchanged. Use `editor.animClockStep(now)` to advance.

- [ ] **Step 2: Run — expect FAIL** (`startPanMomentum` undefined).

- [ ] **Step 3: Implement** — `startPanMomentum` in `editor/index.ts` (const `DECAY_MS = 320`, `MIN_V = 0.05`):
```ts
startPanMomentum(vx: number, vy: number): void {
  if (this.reducedMotionAtom.peek()) return;
  if (Math.hypot(vx, vy) < MIN_V) return;
  const Dx = vx * DECAY_MS;
  const Dy = vy * DECAY_MS;
  let last = 0;
  this.animate({
    from: 0, to: 1, durationMs: DECAY_MS, easing: easeOutCubic,
    onTick: (p) => { this.panByScreen(Dx * (p - last), Dy * (p - last)); last = p; },
  });
}
```
  Host (`nodus-host.tsx`): add `let panVel = { x: 0, y: 0 }; let lastPanT = 0;`. In the `onPointerMove` `panning` branch, after `panByScreen`, compute `const now = performance.now(); const dt = Math.max(1, now - lastPanT); panVel = { x: (e.clientX - lastPan.x)/dt, y: (e.clientY - lastPan.y)/dt }; lastPanT = now;` (before updating `lastPan`). In `onPointerUp` `panning` branch, call `editor.startPanMomentum(panVel.x, panVel.y);`.

- [ ] **Step 4: Run — expect PASS** + `pnpm exec vitest run packages/core`.
- [ ] **Step 5: Typecheck. Report to controller.**

---

### Task 4: Entrance animation + staggered cascade

**Files:**
- Modify: `packages/core/src/editor/index.ts` (`animateEntrance`)
- Modify: `packages/core/src/tools/index.ts` (Create tool calls it)
- Modify: `packages/preset-infra/src/facade.ts` (cascade after load)
- Modify: `packages/from-mermaid/src/index.ts` (after import)
- Test: `packages/core/src/editor/motion.test.ts` (append)

**Interfaces:**
- Produces: `editor.animateEntrance(ids: Id[], opts?: { stagger?: number }): void` — for each id at index `i`: `setPresentation(id, { alpha: 0, scale: 0.92 })` immediately, then `animate({ from: 0, to: 1, durationMs: 260, delayMs: i * (opts?.stagger ?? 0), easing: easeOutCubic, onTick: (v) => setPresentation(id, { alpha: v, scale: 0.92 + 0.08*v }), onDone: () => clearPresentation(id) })`. Under reduced motion the tween snaps → nodes appear at full immediately. Called from: Create tool (single id, no stagger), `importMermaid` (node record ids, stagger ~30), facade load (all loaded node ids, stagger ~40). NOT from paste/duplicate/undo/redo.

- [ ] **Step 1: Write the failing test** — `editor.animateEntrance([id], {})`: immediately `presentationFor(id)?.alpha` is 0; after stepping the clock past 260ms, `presentationFor(id)` is undefined (cleared, faded in). With two ids + `stagger: 100`, at t just after start the second id is still at alpha 0 (delayed). With `setReducedMotion(true)`, entrance clears immediately on first step.

- [ ] **Step 2: Run — expect FAIL**.

- [ ] **Step 3: Implement** — `animateEntrance` in `editor/index.ts`; then call sites:
  - Create tool (`tools/index.ts` ~572, after `createNodeAt`): `this.editor.animateEntrance([id]);`.
  - `importMermaid` (`from-mermaid/src/index.ts`, after `layout`/`zoomToFit`): `editor.animateEntrance(parsed.records.filter(r => r.typeName === 'node').map(r => r.id), { stagger: 30 });`.
  - facade (`preset-infra/src/facade.ts`, right after `editor.loadSnapshot(...)`): `editor.animateEntrance(editor.store.nodes().map((n) => n.id), { stagger: 40 });`.
  - Note the mount-timing caveat: presentation alpha 0 holds until the host mounts + ticks; under reduced motion it snaps visible. Acceptable; flagged for browser verify.

- [ ] **Step 4: Run — expect PASS** + `pnpm exec vitest run packages/core packages/preset-infra packages/from-mermaid`.
- [ ] **Step 5: Typecheck. Report to controller.**

---

### Task 5: Layout tween

**Files:**
- Modify: `packages/core/src/editor/index.ts` (`layout()`)
- Test: `packages/core/src/editor/motion.test.ts` (append) or an existing layout test.

**Interfaces:**
- Produces: `layout()` applies the final positions to the store in one change (truthful, unchanged), THEN for each moved node seeds `setPresentation(id, { dx: old.x - pos.x, dy: old.y - pos.y })` and `animate({ from: 1, to: 0, durationMs: 400, easing: easeInOutCubic, onTick: (t) => setPresentation(id, { dx: (old.x-pos.x)*t, dy: (old.y-pos.y)*t }), onDone: () => clearPresentation(id) })`. So committed positions are final immediately (undo/serialization truthful) while nodes visually glide from old→new. Reduced motion → dx/dy snap to 0 (nodes at final at once).

- [ ] **Step 1: Write the failing test** — register a trivial layout engine (or reuse an existing test's) that moves a node; after `await editor.layout(...)`: the store record is at the NEW position immediately, AND `presentationFor(id)?.dx` is non-zero (seeded to old−new); after stepping the clock past 400ms, `presentationFor(id)` is undefined (glided to 0). With reduced motion, presentation clears on first step (no glide).

- [ ] **Step 2: Run — expect FAIL**.

- [ ] **Step 3: Implement** — in `layout()`, capture `const olds = new Map(nodes.map(n => [n.id, {x:n.x, y:n.y}]));` before building `changes`; apply `changes` as today; then for each change with a moved node, seed the presentation + `animate` the dx/dy→0 as above. Import `easeInOutCubic`.

- [ ] **Step 4: Run — expect PASS** + `pnpm exec vitest run packages/core`.
- [ ] **Step 5: Typecheck. Report to controller.**

---

### Task 6: Idle shimmer (opt-in, subtle)

**Files:**
- Modify: `packages/core/src/editor/index.ts` (`idleShimmerAtom` + `setIdleShimmer` + `isShimmering()` + a subtle shimmer draw in `render`)
- Modify: `packages/react/src/nodus-host.tsx` (gate OR-in `isShimmering()`)
- Modify: `packages/preset-infra/src/facade.ts` OR the example app — enable it for the demo (core defaults OFF, so the engine never imposes an always-on loop)
- Test: `packages/core/src/editor/motion.test.ts` (append) — `isShimmering()` truth table (enabled + !reducedMotion), and default OFF.

**Interfaces:**
- Produces: `editor.idleShimmerAtom` (default `false`), `setIdleShimmer(on: boolean)`, `isShimmering(): boolean` = `idleShimmerAtom.peek() && !reducedMotionAtom.peek()`. When shimmering, `render` draws a *very subtle* time-driven overlay (e.g. a faint full-canvas alpha breathing or a slow scanline) in a non-cached pass (after `paintStatic`, before `paintInteractive`), amplitude tiny (≤3% alpha). Host gate OR-in `isShimmering()` so it rides the `maxFps` throttle. **Core default OFF** — the example app / preset enables it (dark only) so the engine imposes no always-on loop by default.

- [ ] **Step 1: Write the failing test** — `isShimmering()` is false by default; true after `setIdleShimmer(true)`; false under reduced motion; and the shimmer overlay draw is a no-op when off (recording ctx shows no extra fills when `idleShimmer` is false).

- [ ] **Step 2: Run — expect FAIL**.

- [ ] **Step 3: Implement** — the atom/setter/predicate + a minimal, guarded shimmer draw in `render` (skip entirely when `!isShimmering()`); host gate OR-in. Enable it in the example app for the demo (dark). Keep the amplitude tiny.

- [ ] **Step 4: Run — expect PASS** + `pnpm exec vitest run packages/core`.
- [ ] **Step 5: Typecheck. Report to controller.**

---

## Final verification (whole plan)

- [ ] `pnpm typecheck` clean; `pnpm test` whole suite green.
- [ ] `pnpm exec vitest run -t "canonical"` — serialization unchanged.
- [ ] **Browser drive (lead):** `node scripts/browser-verify.mjs` against `pnpm dev`, plus a chrome-devtools/playwright session confirming, with **zero console errors**: grab-lift on drag + spring-back; momentum glide on pan release; entrance cascade on load; layout tween on auto-layout; pulsing halo + marching ants while selected; and that toggling OS reduced-motion freezes all of it (tweens snap, no momentum, no pulse/shimmer). This is the acceptance gate for S2 (feel isn't headless-testable).

## Self-review notes (author)
- **Spec coverage:** spring drag + grab-lift → T2; momentum → T3; entrance + cascade → T4; layout tween → T5; pulse halo + marching ants → T1; idle shimmer → T6. Parallax already ships (S1, camera-linked) — S2 does not re-do it.
- **Invariants:** committed positions/camera stay truthful (T2 scale-only, T5 applies final then tweens visual offset, T3 pans the camera which is view state not document); reduced-motion disables everything (K2 snap + the gate predicates + explicit guards in T3/T6); nothing enters document/undo/canonical.
- **Continuous-loop discipline:** the two always-tick cases (selection pulse T1, idle shimmer T6) are both reduced-motion-gated predicates OR-ed into the *existing* `armFlow`/`maxFps` throttle — no second frame driver. Idle shimmer defaults OFF in core so the engine never imposes an always-on loop; the demo opts in.
- **Entrance mount-timing:** facade-load entrance seeds alpha 0 that resolves on first host paint; under reduced motion it snaps visible. Flagged for browser verify.
