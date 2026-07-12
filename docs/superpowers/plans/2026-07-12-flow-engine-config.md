# Flow Engine Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add global, ephemeral runtime knobs (enable/pause, speed multiplier, reduced-motion respect, optional FPS cap) to the flow animation, honored by the core renderer and the React host loop.

**Architecture:** A `FlowRuntimeConfig` atom on the `Editor` plus a separate `reducedMotion` atom (environment state fed by the host). The live `paintFlow` path advances an internal **flow clock** by `dt × speedScale` only while animating, so pause/reduced-motion freeze in place and speed changes stay smooth. The stateless snapshot path (`paintRegion`) honors `enabled`/`speedScale` only. The React binding gates its rAF loop on a new `isFlowAnimating()`, tracks the config atoms, wires OS `prefers-reduced-motion`, and throttles the self-perpetuating flow ticks to `maxFps`.

**Tech Stack:** TypeScript, the repo's own signals (`atom`/`effect`), Canvas 2D, React (thin binding), Vitest (headless, `mockCtx`), playwright browser-verify.

## Global Constraints

- **Config is ephemeral:** `FlowRuntimeConfig` and `reducedMotion` are **NOT serialized** and **NOT undoable** — plain atom writes, no `store.apply`/history.
- **`hasFlow()` semantics are unchanged** (`some edge has a flow spec`) — the MCP caller (`packages/mcp/src/session.ts:362`) depends on it. Add a new `isFlowAnimating()` for the loop gate.
- **`paintFlowMarkers` (in `renderer/paint.ts`) stays config-agnostic** — a pure renderer receiving an already-resolved spec + effective time. Do not add config there.
- **Live path is stateful (flow clock); snapshot path is stateless.** `paintRegion` never mutates the flow clock.
- **Defaults:** `{ enabled: true, paused: false, speedScale: 1, respectReducedMotion: true }`, `maxFps` undefined.
- **`speedScale` is clamped `>= 0`** on write.
- **Adaptive dt clamp:** `maxDt = max(64, (maxFps ? 1000/maxFps : 1000/30) * 1.5)` ms.
- TDD (failing test first), frequent commits.
- **Git note:** this repo is currently NOT a git repository. Run `git init` first if you want the `git commit` steps to work; otherwise treat each **Commit** step as a manual checkpoint (verify state, move on).

## File Structure

- `packages/core/src/model.ts` — add the `FlowRuntimeConfig` type (types-only file; auto re-exported by the `export * from './model.js'` barrel in `packages/core/src/index.ts`).
- `packages/core/src/editor/index.ts` — the config atoms, accessors, `isFlowAnimating`, the flow clock, the `paintFlow` rewrite, the `drawFlowEdges` helper, and the `paintRegion` snapshot update.
- `packages/core/src/__tests__/flow-config.test.ts` — new headless test file (mirrors `flow.test.ts`/`flow-data.test.ts` style).
- `packages/react/src/index.tsx` — the rAF-loop gate swap, config-atom tracking, reduced-motion wiring, and the `maxFps` throttle.

---

### Task 1: Config model, atoms, accessors, `isFlowAnimating` (core)

**Files:**
- Modify: `packages/core/src/model.ts` (add interface after `FlowSpec`, ~line 93)
- Modify: `packages/core/src/editor/index.ts` (add `FLOW_DEFAULTS` const, import, atoms + methods in the flow region, ~lines 1036–1055)
- Test: `packages/core/src/__tests__/flow-config.test.ts` (new)

**Interfaces:**
- Consumes: `atom`, `Atom` (already imported in editor from `../signals/index.js`); `EdgeRecord`; the existing `hasFlow()`.
- Produces (relied on by later tasks + React):
  - `interface FlowRuntimeConfig { enabled: boolean; paused: boolean; speedScale: number; respectReducedMotion: boolean; maxFps?: number }`
  - `editor.flowConfigAtom: Atom<FlowRuntimeConfig>`
  - `editor.reducedMotionAtom: Atom<boolean>`
  - `editor.flowConfig(): Readonly<FlowRuntimeConfig>`
  - `editor.setFlowConfig(patch: Partial<FlowRuntimeConfig>): void`
  - `editor.setReducedMotion(active: boolean): void`
  - `editor.isFlowAnimating(): boolean`
  - `editor.pauseFlow()`, `resumeFlow()`, `setFlowEnabled(b)`, `setFlowSpeedScale(n)`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/__tests__/flow-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Editor, type Id } from '../index.js';

/** Build an editor with one flowing edge; returns the editor and edge id. */
function build(): { ed: Editor; e: Id } {
  const ed = new Editor();
  const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
  const b = ed.createNode({ type: 'rect', x: 400, y: 0, w: 100, h: 100 });
  const e = ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b })!;
  ed.setFlow([e], { style: 'dots', count: 3, speed: 70 });
  return { ed, e };
}

describe('flow runtime config', () => {
  it('exposes defaults', () => {
    const { ed } = build();
    expect(ed.flowConfig()).toEqual({
      enabled: true, paused: false, speedScale: 1, respectReducedMotion: true,
    });
  });

  it('setFlowConfig merges patches and clamps speedScale to >= 0', () => {
    const { ed } = build();
    ed.setFlowConfig({ paused: true });
    expect(ed.flowConfig().paused).toBe(true);
    expect(ed.flowConfig().enabled).toBe(true); // untouched by the patch
    ed.setFlowConfig({ speedScale: -5 });
    expect(ed.flowConfig().speedScale).toBe(0);
    ed.setFlowConfig({ maxFps: 30 });
    expect(ed.flowConfig().maxFps).toBe(30);
  });

  it('sugar methods delegate to setFlowConfig', () => {
    const { ed } = build();
    ed.pauseFlow(); expect(ed.flowConfig().paused).toBe(true);
    ed.resumeFlow(); expect(ed.flowConfig().paused).toBe(false);
    ed.setFlowEnabled(false); expect(ed.flowConfig().enabled).toBe(false);
    ed.setFlowSpeedScale(2); expect(ed.flowConfig().speedScale).toBe(2);
  });

  it('isFlowAnimating gates on enabled, paused, and reduced-motion; hasFlow is unchanged', () => {
    const { ed } = build();
    expect(ed.hasFlow()).toBe(true);
    expect(ed.isFlowAnimating()).toBe(true);

    ed.setFlowEnabled(false);
    expect(ed.isFlowAnimating()).toBe(false);
    expect(ed.hasFlow()).toBe(true); // doc truth unchanged

    ed.setFlowEnabled(true); ed.pauseFlow();
    expect(ed.isFlowAnimating()).toBe(false);

    ed.resumeFlow(); ed.setReducedMotion(true);
    expect(ed.isFlowAnimating()).toBe(false); // respected by default

    ed.setFlowConfig({ respectReducedMotion: false });
    expect(ed.isFlowAnimating()).toBe(true); // host override
  });

  it('isFlowAnimating is false when no edge is flowing', () => {
    const ed = new Editor();
    expect(ed.isFlowAnimating()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/__tests__/flow-config.test.ts`
Expected: FAIL — `ed.flowConfig is not a function` (methods not defined yet).

- [ ] **Step 3: Add the `FlowRuntimeConfig` type to the model**

In `packages/core/src/model.ts`, immediately after the `FlowSpec` interface (which ends near line 93), add:

```ts
/**
 * Global, EPHEMERAL runtime knobs for the flow animation — owned by the editor, NOT serialized and
 * NOT undoable (session/runtime state, like the camera). Per-edge `FlowSpec`/`FlowScale` are separate.
 */
export interface FlowRuntimeConfig {
  /** false = draw NO flow markers (edges look static); loop idle. */
  enabled: boolean;
  /** true = freeze markers in place (still drawn, no motion); loop idle. */
  paused: boolean;
  /** Global multiplier applied to every edge's flow speed (clamped >= 0). */
  speedScale: number;
  /** Honor OS prefers-reduced-motion by freezing to a static frame. */
  respectReducedMotion: boolean;
  /** Optional cap (fps) on the self-perpetuating flow ticks; undefined = display refresh. */
  maxFps?: number;
}
```

- [ ] **Step 4: Wire the config into the editor**

In `packages/core/src/editor/index.ts`, add `FlowRuntimeConfig` to the existing type import from `../model.js` (the import block around line 18 that already imports `FlowSpec`):

```ts
  type FlowRuntimeConfig,
```

Add a module-level default just below the imports (top of the file, after the last `import`):

```ts
const FLOW_DEFAULTS: FlowRuntimeConfig = {
  enabled: true,
  paused: false,
  speedScale: 1,
  respectReducedMotion: true,
};
```

In the flow region of the `Editor` class (right after `clearFlowMetrics()`, ~line 1054), add the atoms, clock fields, accessors, and `isFlowAnimating`:

```ts
  /** Global ephemeral flow runtime config (enable/pause/speed/reduced-motion/fps). NOT serialized. */
  readonly flowConfigAtom: Atom<FlowRuntimeConfig> = atom<FlowRuntimeConfig>({ ...FLOW_DEFAULTS });
  /** Current OS reduced-motion state — the headless core can't detect it, so the host feeds it in. */
  readonly reducedMotionAtom: Atom<boolean> = atom(false);
  /** Integrated flow time (ms), advanced by paintFlow only while animating. */
  private flowClock = 0;
  private flowPrevTime: number | null = null;

  flowConfig(): Readonly<FlowRuntimeConfig> {
    return this.flowConfigAtom.peek();
  }
  /** Merge a partial config (clamps speedScale >= 0). Ephemeral: no undo entry. */
  setFlowConfig(patch: Partial<FlowRuntimeConfig>): void {
    const next: FlowRuntimeConfig = { ...this.flowConfigAtom.peek(), ...patch };
    if (patch.speedScale != null) next.speedScale = Math.max(0, patch.speedScale);
    this.flowConfigAtom.set(next);
  }
  pauseFlow(): void { this.setFlowConfig({ paused: true }); }
  resumeFlow(): void { this.setFlowConfig({ paused: false }); }
  setFlowEnabled(enabled: boolean): void { this.setFlowConfig({ enabled }); }
  setFlowSpeedScale(speedScale: number): void { this.setFlowConfig({ speedScale }); }
  /** Host feeds the OS prefers-reduced-motion state; headless default is false. */
  setReducedMotion(active: boolean): void { this.reducedMotionAtom.set(active); }

  /** True if flow should be actively animating right now — the rAF gate. Respects enabled/paused/
   *  reduced-motion. (`hasFlow()` stays doc-truth: "any edge has a flow spec".) */
  isFlowAnimating(): boolean {
    const c = this.flowConfigAtom.peek();
    if (!c.enabled || c.paused) return false;
    if (c.respectReducedMotion && this.reducedMotionAtom.peek()) return false;
    return this.hasFlow();
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/src/__tests__/flow-config.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/model.ts packages/core/src/editor/index.ts packages/core/src/__tests__/flow-config.test.ts
git commit -m "feat(core): flow runtime config atom, accessors, isFlowAnimating"
```

---

### Task 2: Flow clock + `paintFlow` honors config + `drawFlowEdges` helper (core)

**Files:**
- Modify: `packages/core/src/editor/index.ts` (rewrite `paintFlow` ~lines 1058–1066; add private `drawFlowEdges`)
- Test: `packages/core/src/__tests__/flow-config.test.ts` (append)

**Interfaces:**
- Consumes: `flowConfigAtom`, `reducedMotionAtom`, `flowClock`, `flowPrevTime` (Task 1); `RenderItem` (already imported from `../scene-index/index.js`); `Theme` (already imported); `paintFlowMarkers`, `resolveFlow`, `this.flowMetrics`, `this.sceneIndex.visible`, `this.worldViewport`, `this.setWorldTransform`.
- Produces: `private drawFlowEdges(ctx: Ctx2D, items: Iterable<RenderItem>, theme: Theme, time: number): void` (reused by Task 3); new `paintFlow` behavior.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/__tests__/flow-config.test.ts`. First extend the imports at the top of the file to include `Ctx2D`:

```ts
import { Editor, type Ctx2D, type Id } from '../index.js';
```

Then add this recording context helper and the tests:

```ts
/** A recording Ctx2D capturing packet-dot arc() calls (mirrors flow.test.ts). */
function mockCtx(): Ctx2D & { arcs: { x: number; y: number }[] } {
  const arcs: { x: number; y: number }[] = [];
  const noop = (): void => {};
  return {
    arcs,
    save: noop, restore: noop, setTransform: noop, beginPath: noop, fill: noop, stroke: noop,
    moveTo: noop, lineTo: noop, setLineDash: noop, closePath: noop,
    arc: (x: number, y: number) => arcs.push({ x, y }),
    fillStyle: '', strokeStyle: '', lineWidth: 0, lineDashOffset: 0, shadowColor: '', shadowBlur: 0,
  } as unknown as Ctx2D & { arcs: { x: number; y: number }[] };
}

describe('flow config affects paintFlow rendering', () => {
  it('enabled:false draws nothing', () => {
    const { ed } = build();
    ed.setFlowEnabled(false);
    const c = mockCtx();
    ed.paintFlow(c, 1, 0);
    ed.paintFlow(c, 1, 100);
    expect(c.arcs).toHaveLength(0);
  });

  it('paused freezes markers in place across advancing time', () => {
    const { ed } = build();
    // establish a non-zero clock position, then pause
    ed.paintFlow(mockCtx(), 1, 0);
    ed.paintFlow(mockCtx(), 1, 50);
    ed.pauseFlow();
    const a = mockCtx(); ed.paintFlow(a, 1, 100);
    const b = mockCtx(); ed.paintFlow(b, 1, 900);
    expect(a.arcs.length).toBeGreaterThan(0);
    expect(b.arcs).toEqual(a.arcs); // identical — frozen despite 800ms passing
  });

  it('paused then resumed continues from the frozen phase (no jump-forward)', () => {
    const { ed } = build();
    ed.paintFlow(mockCtx(), 1, 0);
    ed.paintFlow(mockCtx(), 1, 50);
    const beforePause = mockCtx(); ed.paintFlow(beforePause, 1, 50);
    ed.pauseFlow();
    ed.paintFlow(mockCtx(), 1, 5000); // long pause, no motion
    ed.resumeFlow();
    const afterResume = mockCtx(); ed.paintFlow(afterResume, 1, 5000);
    // resumes from where it froze (dt=0 this frame), not jumped forward by ~5s
    expect(afterResume.arcs).toEqual(beforePause.arcs);
  });

  it('speedScale advances the animation faster', () => {
    const mk = (scale: number) => {
      const { ed } = build();
      ed.setFlowSpeedScale(scale);
      ed.paintFlow(mockCtx(), 1, 0); // prime prevTime at t=0
      const c = mockCtx();
      ed.paintFlow(c, 1, 40); // 40ms < adaptive clamp, integrated fully
      return c.arcs[0]!.x;
    };
    // packets move along +x; larger scale => further along after the same 40ms
    expect(mk(3)).not.toBeCloseTo(mk(1), 1);
  });

  it('respects reduced-motion by freezing, and honors the host override', () => {
    const { ed } = build();
    ed.paintFlow(mockCtx(), 1, 0);
    ed.setReducedMotion(true);
    const a = mockCtx(); ed.paintFlow(a, 1, 100);
    const b = mockCtx(); ed.paintFlow(b, 1, 800);
    expect(a.arcs.length).toBeGreaterThan(0);
    expect(b.arcs).toEqual(a.arcs); // frozen

    ed.setFlowConfig({ respectReducedMotion: false });
    const c = mockCtx(); ed.paintFlow(c, 1, 1200);
    expect(c.arcs).not.toEqual(a.arcs); // animates again (override)
  });

  it('clamps a large dt gap so it does not leap', () => {
    const { ed } = build();
    ed.paintFlow(mockCtx(), 1, 0);
    const small = mockCtx(); ed.paintFlow(small, 1, 40); // 40ms
    const { ed: ed2 } = build();
    ed2.paintFlow(mockCtx(), 1, 0);
    const huge = mockCtx(); ed2.paintFlow(huge, 1, 10000); // 10s, must clamp to 64ms
    // clamped advance is small; a 10s unclamped advance would be far larger
    expect(Math.abs(huge.arcs[0]!.x)).toBeLessThan(Math.abs(small.arcs[0]!.x) * 3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/core/src/__tests__/flow-config.test.ts`
Expected: FAIL — the new `describe` block fails (paintFlow ignores config; `enabled:false` still draws, paused still moves).

- [ ] **Step 3: Rewrite `paintFlow` and add `drawFlowEdges`**

In `packages/core/src/editor/index.ts`, replace the current `paintFlow` method (lines ~1056–1066) with:

```ts
  /** Draw the animated flow markers for every visible flowing edge. `time` is a ms clock (the host
   *  passes performance.now()). Advances the internal flow clock only while animating, so pause /
   *  reduced-motion freeze in place and speedScale changes stay smooth. No-op draw when disabled. */
  paintFlow(ctx: Ctx2D, dpr: number, time: number): void {
    const c = this.flowConfigAtom.peek();
    const frameMs = c.maxFps && c.maxFps > 0 ? 1000 / c.maxFps : 1000 / 30;
    const maxDt = Math.max(64, frameMs * 1.5);
    const dt = this.flowPrevTime == null ? 0 : Math.max(0, Math.min(time - this.flowPrevTime, maxDt));
    this.flowPrevTime = time;
    if (!c.enabled) return; // draw nothing
    const frozen = c.paused || (c.respectReducedMotion && this.reducedMotionAtom.peek());
    if (!frozen) this.flowClock += dt * c.speedScale;
    const theme = this.themeAtom.peek();
    this.setWorldTransform(ctx, dpr);
    this.drawFlowEdges(ctx, this.sceneIndex.visible(this.worldViewport()), theme, this.flowClock);
  }

  /** Shared per-edge flow draw: resolve each edge's spec against its live metric and paint markers at
   *  `time`. Caller has already set the world transform and computed the effective (scaled) time. */
  private drawFlowEdges(ctx: Ctx2D, items: Iterable<RenderItem>, theme: Theme, time: number): void {
    for (const item of items) {
      if (item.kind !== 'edge') continue;
      const flow = (item.record as EdgeRecord).flow;
      if (flow) paintFlowMarkers(ctx, item, theme, time, resolveFlow(flow, this.flowMetrics.get(item.id)));
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/core/src/__tests__/flow-config.test.ts`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Verify existing flow tests still pass**

Run: `pnpm exec vitest run packages/core/src/__tests__/flow.test.ts packages/core/src/__tests__/flow-data.test.ts`
Expected: PASS (no regression — with `speedScale:1` and no pause, `flowClock == time`).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/editor/index.ts packages/core/src/__tests__/flow-config.test.ts
git commit -m "feat(core): flow clock + paintFlow honors runtime config"
```

---

### Task 3: Snapshot path (`paintRegion`) honors config (core)

**Files:**
- Modify: `packages/core/src/editor/index.ts` (`paintRegion` flow block, lines ~1104–1111)
- Test: `packages/core/src/__tests__/flow-config.test.ts` (append)

**Interfaces:**
- Consumes: `drawFlowEdges` (Task 2), `flowConfigAtom` (Task 1), `this.sceneIndex.paintOrder()`.
- Produces: `paintRegion` honors `enabled` (skip) and applies `speedScale` statically; independent of the live clock.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/__tests__/flow-config.test.ts`:

```ts
describe('flow config affects the snapshot path (paintRegion)', () => {
  const region = { x: -50, y: -50, w: 600, h: 200 };

  it('enabled:false suppresses flow in snapshots', () => {
    const { ed } = build();
    ed.setFlowEnabled(false);
    const c = mockCtx();
    ed.paintRegion(c, region, 1, { flow: true, time: 100 });
    expect(c.arcs).toHaveLength(0);
  });

  it('draws flow when enabled, and speedScale shifts the static phase', () => {
    const { ed } = build();
    const c1 = mockCtx();
    ed.paintRegion(c1, region, 1, { flow: true, time: 100 });
    expect(c1.arcs.length).toBeGreaterThan(0);

    ed.setFlowSpeedScale(2);
    const c2 = mockCtx();
    ed.paintRegion(c2, region, 1, { flow: true, time: 100 });
    // effective time doubles => different packet positions
    expect(c2.arcs).not.toEqual(c1.arcs);
  });

  it('snapshot does not disturb the live flow clock', () => {
    const { ed } = build();
    ed.paintFlow(mockCtx(), 1, 0);
    const live1 = mockCtx(); ed.paintFlow(live1, 1, 40);
    ed.paintRegion(mockCtx(), region, 1, { flow: true, time: 999999 }); // stateless
    const live2 = mockCtx(); ed.paintFlow(live2, 1, 80);
    const live3ref = (() => { const { ed: e2 } = build(); e2.paintFlow(mockCtx(),1,0); e2.paintFlow(mockCtx(),1,40); const m = mockCtx(); e2.paintFlow(m,1,80); return m; })();
    expect(live2.arcs).toEqual(live3ref.arcs); // live clock advanced purely by paintFlow calls
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/__tests__/flow-config.test.ts`
Expected: FAIL — snapshot ignores `enabled`/`speedScale` (draws even when disabled).

- [ ] **Step 3: Update the `paintRegion` flow block**

In `packages/core/src/editor/index.ts`, replace the `if (opts.flow) { ... }` block (lines ~1104–1111) with:

```ts
    // optional flow snapshot at `time` (stateless: honors enabled + speedScale; ignores pause/reduced-motion)
    if (opts.flow) {
      const c = this.flowConfigAtom.peek();
      if (c.enabled) {
        this.drawFlowEdges(ctx, this.sceneIndex.paintOrder(), theme, (opts.time ?? 0) * c.speedScale);
      }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/src/__tests__/flow-config.test.ts`
Expected: PASS (all Task 1–3 tests).

- [ ] **Step 5: Full core test + typecheck**

Run: `pnpm exec vitest run packages/core && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/editor/index.ts packages/core/src/__tests__/flow-config.test.ts
git commit -m "feat(core): snapshot path honors flow enabled + speedScale"
```

---

### Task 4: React host loop honors flow config (react)

**Files:**
- Modify: `packages/react/src/index.tsx` (rAF loop ~lines 51–89; effect ~lines 74–89; cleanup return ~lines 194–206)

**Interfaces:**
- Consumes: `editor.isFlowAnimating()`, `editor.flowConfig()`, `editor.flowConfigAtom`, `editor.reducedMotionAtom`, `editor.setReducedMotion()` (Task 1).
- Produces: host loop that gates on `isFlowAnimating`, repaints on config/reduced-motion changes, feeds OS reduced-motion, and throttles flow ticks to `maxFps`. No new exports.

- [ ] **Step 1: Replace the rAF paint/schedule block**

In `packages/react/src/index.tsx`, replace the block that starts with `let raf = 0;` and ends at the `schedule` definition (lines ~51–62) with:

```ts
    let raf = 0;
    let flowTimer = 0;
    let lastFlowPaint = 0;
    const dpr = (): number => Math.max(1, Math.min(3, Math.floor(window.devicePixelRatio || 1)));

    const paint = (): void => {
      raf = 0;
      const rect = host.getBoundingClientRect();
      const now = performance.now();
      editor.render(ctx, rect.width, rect.height, dpr(), true, now);
      lastFlowPaint = now;
      if (editor.isFlowAnimating()) armFlow(); // keep ticking while flowing (throttled to maxFps)
    };
    const armFlow = (): void => {
      const cap = editor.flowConfig().maxFps;
      if (!cap || cap <= 0) { schedule(); return; }
      const wait = Math.max(0, 1000 / cap - (performance.now() - lastFlowPaint));
      clearTimeout(flowTimer);
      flowTimer = setTimeout(schedule, wait) as unknown as number;
    };
    const schedule = (): void => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
```

- [ ] **Step 2: Track the config atoms in the repaint effect**

In the `effect(() => { ... })` block (the one reading `editor.sceneIndex.version.get()` etc., ~lines 75–89), add two reads just before the closing `schedule();`:

```ts
      editor.flowConfigAtom.get();
      editor.reducedMotionAtom.get();
      schedule();
```

- [ ] **Step 3: Wire OS reduced-motion, right after the effect's `const stopReaction = effect(...)`**

Add immediately after the `effect(...)` assignment (before `const ro = new ResizeObserver(resize);`, ~line 90):

```ts
    // honor OS prefers-reduced-motion; the headless core can't detect it, so feed it in
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    editor.setReducedMotion(mq.matches);
    const onReducedMotion = (): void => editor.setReducedMotion(mq.matches);
    mq.addEventListener('change', onReducedMotion);
```

- [ ] **Step 4: Clean up the listener and timer**

In the `useLayoutEffect` cleanup `return () => { ... }` (starts ~line 194), add after `cancelAnimationFrame(raf);`:

```ts
      clearTimeout(flowTimer);
      mq.removeEventListener('change', onReducedMotion);
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Build the affected packages**

Run: `pnpm build`
Expected: all packages build (React binding compiles against the new core API).

- [ ] **Step 7: Browser smoke verification**

Start the example and drive it from the DevTools console (the example exposes `window.__editor`):

Run: `pnpm dev` (serves `nodus-example-browser`), open the shown URL.

In the DevTools console:

```js
const ed = window.__editor;
ed.setFlow(ed.store.edges().map(e => e.id), { style: 'dots', count: 4 });   // packets animate
ed.setFlowConfig({ enabled: false });                                        // markers vanish, edges static
ed.setFlowConfig({ enabled: true, paused: true });                           // markers reappear, frozen in place
ed.setFlowConfig({ paused: false, speedScale: 4 });                          // noticeably faster
ed.setFlowConfig({ speedScale: 1, maxFps: 4 });                              // visibly choppy (~4 fps)
ed.setFlowConfig({ maxFps: undefined });                                     // smooth again
```

Then in DevTools → Rendering → "Emulate CSS media feature prefers-reduced-motion" → `reduce`: packets should **freeze**. Set it back to "no-preference": packets resume.

Expected: every step behaves as described; when `enabled:false` or frozen, CPU/rAF goes idle (no continuous repaint).

- [ ] **Step 8: Commit**

```bash
git add packages/react/src/index.tsx
git commit -m "feat(react): host loop honors flow config (gate, reduced-motion, maxFps throttle)"
```

---

## Self-Review

**Spec coverage:**
- FlowRuntimeConfig data model + defaults → Task 1 (model.ts + FLOW_DEFAULTS). ✓
- `setReducedMotion` ephemeral input → Task 1. ✓
- Flow-clock mechanism (dt clamp, integrate ×speedScale while animating) → Task 2. ✓ (adaptive clamp refines the spec's flat 64ms — see note below).
- Behavior table (enabled/paused/reduced-motion/override) → Tasks 1 (isFlowAnimating) + 2 (paintFlow draw). ✓
- API surface (flowConfig/setFlowConfig/isFlowAnimating/sugar) → Task 1. ✓
- `hasFlow()` unchanged; MCP caller safe → Global Constraints + Task 1 test asserts it. ✓
- `paintFlowMarkers` stays config-agnostic → untouched; verified by Global Constraints. ✓
- Live path stateful, snapshot path stateless → Tasks 2 + 3, with an explicit "snapshot doesn't disturb the live clock" test. ✓
- React: gate→isFlowAnimating, track atoms, matchMedia wiring, maxFps throttle → Task 4. ✓
- Testing strategy (mockCtx headless + browser smoke) → Tasks 1–4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. ✓

**Type consistency:** `FlowRuntimeConfig`, `flowConfigAtom`, `reducedMotionAtom`, `flowConfig()`, `setFlowConfig()`, `isFlowAnimating()`, `drawFlowEdges(ctx, items, theme, time)`, `setReducedMotion()` are named identically across model.ts, editor, tests, and React. ✓

**Deviation from spec (intentional, documented here):** the spec's flat "≤64ms" dt clamp is replaced by the **adaptive** `maxDt = max(64, (maxFps ? 1000/maxFps : 33) * 1.5)` so a low `maxFps` doesn't slow the animation. The spec's §2/§5 will be annotated to match. Also the spec named the snapshot method `paintFrame`; the actual method is **`paintRegion`** — this plan uses the correct name.
