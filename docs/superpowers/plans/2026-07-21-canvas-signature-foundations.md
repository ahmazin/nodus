# Canvas Signature — Foundations (Keystones) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the two shared foundations that gate the whole canvas overhaul — **K1** a gradient + offset-drop-shadow paint primitive (DOM + Skia + SVG parity), and **K2** a generic animation clock with an ephemeral per-item presentation layer. This plan delivers the *substrate + unit-level correctness only*: the primitives paint correctly and the clock/tweens tick and snap correctly on the direct paint path. Final visual compositing (glassy nodes, motion feel, layer-cache interaction) is deliberately deferred to the subsystem plans (S1/S2) that consume these foundations.

**Architecture:** K1 extends the `Ctx2D` abstraction and `DrawApi` with new draw options that resolve natively on browser/Skia contexts and emit deterministic `<linearGradient>` defs on the SVG-export context. K2 adds a pure tween engine (`editor/animation.ts`) integrated into the editor exactly like the existing flow clock, writing an ephemeral `id → {alpha,scale,dx,dy}` map that `paintItem` reads. Nothing new enters the document, undo, or canonical serialization.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Vitest (`environment: 'node'`, no jsdom), the vendored signals engine (`atom`), Canvas-2D / Skia (`@napi-rs/canvas`) via the `Ctx2D` structural interface.

## Global Constraints

- Static gate is `pnpm typecheck` (`tsc --strict` + `noUncheckedIndexedAccess`) — run after every task; there is **no** eslint/prettier.
- Tests run under `environment: 'node'` — **no jsdom**. Pure logic only; no `document`/`window`.
- **No new dependencies.** Core has zero framework/DOM deps (`rbush` + vendored signals only).
- All new visual state is **theme-data or ephemeral** — never written to records. The document, undo history, and canonical serialization must be byte-for-byte unchanged (`canonical.test.ts` and the diff-CI stay green).
- Full `Ctx2D` parity: every new primitive must behave on DOM canvas, Skia, and `SVGContext`. SVG **omits** glow/shadow blur (documented) and **renders** gradients as defs.
- Route any store mutation through `store.apply` / editor helpers — but this plan adds **no** record mutations.
- Dev loop is source-first: `main`/`types` point at `src`; no `pnpm build` needed to run tests.
- Single test file: `pnpm exec vitest run <path>`; by name: `pnpm exec vitest run -t "<name>"`.

---

## File Structure

- `packages/core/src/renderer/context.ts` — MODIFY: add `CanvasGradientLike`, `createLinearGradient`, widen `fillStyle`/`strokeStyle`.
- `packages/core/src/renderer/svg-context.ts` — MODIFY: implement `createLinearGradient`, gradient defs, `url(#…)` refs, `<defs>` in `toSVG`.
- `packages/core/src/renderer/draw-api.ts` — MODIFY: add `GradientSpec`/`ShadowSpec` to `FillOpts`/`StrokeOpts`; `applyGradient`/`applyShadow` helpers; wire into fills + clean strokes.
- `packages/core/src/renderer/draw-api-material.test.ts` — CREATE: unit tests for gradient/shadow on `DrawApi` (recording ctx + SVGContext).
- `packages/core/src/renderer/svg-export.test.ts` — MODIFY: gradient determinism/canonical regression.
- `packages/core/src/editor/animation.ts` — CREATE: pure tween engine (`Tween`, easings, `AnimationClock`).
- `packages/core/src/editor/animation.test.ts` — CREATE: unit tests for the tween engine.
- `packages/core/src/editor/index.ts` — MODIFY: `animate()`, `isAnimating()`, presentation map, step in `render()`.
- `packages/core/src/editor/animation-integration.test.ts` — CREATE: editor-level tween + presentation + reduced-motion tests.
- `packages/core/src/renderer/paint.ts` — MODIFY: `paintItem` reads presentation (alpha/scale/offset).
- `packages/react/src/nodus-host.tsx` — MODIFY: continuous-paint gate `isFlowAnimating() || isAnimating()`.

---

# K1 — Paint-material primitive

### Task 1: SVGContext gradient support (drives the `Ctx2D` interface change)

**Files:**
- Modify: `packages/core/src/renderer/context.ts`
- Modify: `packages/core/src/renderer/svg-context.ts`
- Test: `packages/core/src/renderer/svg-export.test.ts` (append a new describe block)

**Interfaces:**
- Produces: `Ctx2D.createLinearGradient(x0,y0,x1,y1): CanvasGradientLike`; `interface CanvasGradientLike { addColorStop(offset: number, color: string): void }`; `fillStyle`/`strokeStyle` widened to `string | CanvasGradientLike`. `SVGContext.toSVG` prepends a `<defs>` block when any gradient was used. Gradient ids are `nd-grad-0`, `nd-grad-1`, … assigned in draw order (deterministic).

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/renderer/svg-export.test.ts`:

```ts
import { SVGContext } from './svg-context.js';

describe('SVGContext gradients', () => {
  it('emits a deterministic linearGradient def and references it via url()', () => {
    const ctx = new SVGContext();
    const g = ctx.createLinearGradient(0, 0, 0, 100);
    g.addColorStop(0, '#112233');
    g.addColorStop(1, '#445566');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.rect(0, 0, 100, 100);
    ctx.fill();
    const out = ctx.toSVG(100, 100);
    expect(out).toContain('<defs>');
    expect(out).toContain('<linearGradient id="nd-grad-0" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100">');
    expect(out).toContain('<stop offset="0" stop-color="#112233"/>');
    expect(out).toContain('<stop offset="1" stop-color="#445566"/>');
    expect(out).toContain('fill="url(#nd-grad-0)"');
    // determinism: identical scene → identical markup
    const ctx2 = new SVGContext();
    const g2 = ctx2.createLinearGradient(0, 0, 0, 100);
    g2.addColorStop(0, '#112233');
    g2.addColorStop(1, '#445566');
    ctx2.fillStyle = g2;
    ctx2.beginPath();
    ctx2.rect(0, 0, 100, 100);
    ctx2.fill();
    expect(ctx2.toSVG(100, 100)).toBe(out);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/renderer/svg-export.test.ts -t "gradients"`
Expected: FAIL — `ctx.createLinearGradient is not a function` (and a type error under typecheck).

- [ ] **Step 3: Extend the `Ctx2D` interface**

In `packages/core/src/renderer/context.ts`, add before the `Ctx2D` interface:

```ts
/**
 * Structural subset of the DOM `CanvasGradient` — only `addColorStop`, which is all the renderer uses.
 * A real `CanvasGradient` (browser or `@napi-rs/canvas`) satisfies it; `SVGContext` returns its own
 * recorder that serializes to a `<linearGradient>` def.
 */
export interface CanvasGradientLike {
  addColorStop(offset: number, color: string): void;
}
```

Inside `interface Ctx2D`, add the factory method (near `setLineDash`):

```ts
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradientLike;
```

And widen the two style fields:

```ts
  fillStyle: string | CanvasGradientLike;
  strokeStyle: string | CanvasGradientLike;
```

- [ ] **Step 4: Implement gradients in `SVGContext`**

In `packages/core/src/renderer/svg-context.ts`:

1. Import the type: change the import to `import type { Ctx2D, CanvasGradientLike, DrawableImage } from './context.js';`
2. Add a gradient recorder class at module scope (after `parseFont`):

```ts
/** Records a linear gradient's geometry + stops; serialized to a `<linearGradient>` def by SVGContext. */
class SVGGradient implements CanvasGradientLike {
  readonly stops: { offset: number; color: string }[] = [];
  constructor(
    readonly x0: number,
    readonly y0: number,
    readonly x1: number,
    readonly y1: number,
  ) {}
  addColorStop(offset: number, color: string): void {
    this.stops.push({ offset, color });
  }
}
```

3. Change the `StyleState.fillStyle`/`strokeStyle` field types to `string | SVGGradient` and update the initial `style` object (they stay `'#000000'`). Also change the `fillStyle`/`strokeStyle` getters/setters to `string | SVGGradient`.
4. Add gradient bookkeeping fields to the class:

```ts
  private defs: string[] = [];
  private gradSeq = 0;
```

5. Implement the factory:

```ts
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): SVGGradient {
    return new SVGGradient(x0, y0, x1, y1);
  }
```

6. Add a helper that registers a gradient (once per paint op) and returns the CSS paint value:

```ts
  /** Resolve a fill/stroke style to an SVG paint value; registers a `<linearGradient>` def for gradients. */
  private paintValue(style: string | SVGGradient): string {
    if (typeof style === 'string') return escapeAttr(style);
    const id = `nd-grad-${this.gradSeq++}`;
    const stops = style.stops
      .map((s) => `<stop offset="${fmt(s.offset)}" stop-color="${escapeAttr(s.color)}"/>`)
      .join('');
    this.defs.push(
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
        `x1="${fmt(style.x0)}" y1="${fmt(style.y0)}" x2="${fmt(style.x1)}" y2="${fmt(style.y1)}">${stops}</linearGradient>`,
    );
    return `url(#${id})`;
  }
```

7. Replace every `escapeAttr(s.fillStyle)` with `this.paintValue(s.fillStyle)` and every `escapeAttr(s.strokeStyle)` with `this.paintValue(s.strokeStyle)` in `fillRect`, `strokeRect`, `fill`, `stroke`, and `text` (the stroked/filled branches).
8. Emit the defs in `toSVG`:

```ts
  toSVG(width: number, height: number): string {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const defs = this.defs.length ? `<defs>${this.defs.join('')}</defs>` : '';
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ` +
      `viewBox="0 0 ${w} ${h}">${defs}${this.body.join('')}</svg>`
    );
  }
```

Update the file-header limitation note (lines ~24–25) to state gradients now render as `<linearGradient>` defs.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/src/renderer/svg-export.test.ts -t "gradients"`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: clean (the widened `fillStyle`/`strokeStyle` union must be accepted everywhere `SVGContext` and the DrawApi assign them).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/renderer/context.ts packages/core/src/renderer/svg-context.ts packages/core/src/renderer/svg-export.test.ts
git commit -m "feat(core): Ctx2D gradient primitive + SVG linearGradient defs (K1)"
```

---

### Task 2: DrawApi gradient + offset-shadow on `fillRoundRect`

**Files:**
- Modify: `packages/core/src/renderer/draw-api.ts`
- Test: `packages/core/src/renderer/draw-api-material.test.ts` (create)

**Interfaces:**
- Consumes: `Ctx2D.createLinearGradient` (Task 1).
- Produces: `interface GradientSpec { stops: { at: number; color: string }[]; angle?: number }` and `interface ShadowSpec { color: string; blur: number; dx?: number; dy?: number }`, both exported. `FillOpts` gains `gradient?: GradientSpec` and `shadow?: ShadowSpec`. Angle is degrees: `0` = left→right, `90` (default) = top→bottom. Private `DrawApi` helpers: `private gradientFor(b: Box, g: GradientSpec): CanvasGradientLike` and `private applyShadow(s: ShadowSpec): void`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/renderer/draw-api-material.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DrawApi } from './draw-api.js';
import { SVGContext } from './svg-context.js';
import type { Ctx2D } from './context.js';
import type { ResolvedTokens } from '../theme/index.js';

const tokens = { roughness: 0, fontSize: 12, fontScale: 1, fontFamily: 'sans', text: '#fff' } as unknown as ResolvedTokens;

/** A Ctx2D that records createLinearGradient calls, addColorStop calls, and shadow property writes. */
function recordingCtx(): { ctx: Ctx2D; grads: { coords: number[]; stops: [number, string][] }[]; shadow: Record<string, unknown> } {
  const grads: { coords: number[]; stops: [number, string][] }[] = [];
  const shadow: Record<string, unknown> = {};
  const ctx = new Proxy(
    {
      createLinearGradient(x0: number, y0: number, x1: number, y1: number) {
        const g = { coords: [x0, y0, x1, y1], stops: [] as [number, string][] };
        grads.push(g);
        return { addColorStop: (o: number, c: string) => g.stops.push([o, c]) };
      },
    } as Record<string, unknown>,
    {
      get(t, p) {
        if (p in t) return (t as Record<string, unknown>)[p as string];
        return (..._a: unknown[]) => undefined; // no-op for every other Ctx2D method
      },
      set(_t, p, v) {
        if (typeof p === 'string' && p.startsWith('shadow')) shadow[p] = v;
        return true;
      },
    },
  ) as unknown as Ctx2D;
  return { ctx, grads, shadow };
}

describe('DrawApi materials', () => {
  it('builds a top→bottom gradient across the box and adds stops in order', () => {
    const { ctx, grads } = recordingCtx();
    new DrawApi(ctx, tokens).fillRoundRect({ x: 10, y: 20, w: 40, h: 80 }, 6, '#000', {
      gradient: { stops: [{ at: 0, color: '#aaa' }, { at: 1, color: '#333' }] },
    });
    expect(grads).toHaveLength(1);
    // default angle 90° → vertical line down the box center (cx=30): (30,20)→(30,100)
    expect(grads[0]!.coords).toEqual([30, 20, 30, 100]);
    expect(grads[0]!.stops).toEqual([[0, '#aaa'], [1, '#333']]);
  });

  it('applies an offset drop shadow distinct from glow', () => {
    const { ctx, shadow } = recordingCtx();
    new DrawApi(ctx, tokens).fillRoundRect({ x: 0, y: 0, w: 10, h: 10 }, 2, '#000', {
      shadow: { color: '#0008', blur: 16, dx: 0, dy: 4 },
    });
    expect(shadow.shadowColor).toBe('#0008');
    expect(shadow.shadowBlur).toBe(16);
    expect(shadow.shadowOffsetX).toBe(0);
    expect(shadow.shadowOffsetY).toBe(4);
  });

  it('renders a gradient fill through the SVG context', () => {
    const ctx = new SVGContext();
    new DrawApi(ctx as unknown as Ctx2D, tokens).fillRoundRect({ x: 0, y: 0, w: 10, h: 10 }, 2, '#000', {
      gradient: { stops: [{ at: 0, color: '#fff' }, { at: 1, color: '#000' }] },
    });
    expect(ctx.toSVG(10, 10)).toContain('<linearGradient');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/renderer/draw-api-material.test.ts`
Expected: FAIL — `gradient`/`shadow` not in `FillOpts` (type error) and no gradient recorded.

- [ ] **Step 3: Add the option types**

In `packages/core/src/renderer/draw-api.ts`, add after the imports:

```ts
export interface GradientSpec {
  /** Ordered color stops; `at` in [0,1]. */
  stops: { at: number; color: string }[];
  /** Direction in degrees: 0 = left→right, 90 (default) = top→bottom. */
  angle?: number;
}
export interface ShadowSpec {
  color: string;
  blur: number;
  dx?: number;
  dy?: number;
}
```

Extend `FillOpts`:

```ts
export interface FillOpts {
  glow?: string | null;
  glowBlur?: number;
  opacity?: number;
  gradient?: GradientSpec;
  shadow?: ShadowSpec;
}
```

- [ ] **Step 4: Add the helpers and wire `fillRoundRect`**

Add these private methods to `DrawApi` (after `roundRectPath`):

```ts
  /** Build a linear gradient spanning `b` along `spec.angle` (deg; 90 = top→bottom). */
  private gradientFor(b: Box, spec: GradientSpec): CanvasGradientLike {
    const rad = ((spec.angle ?? 90) * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    // half-extent of the axis-aligned box projected onto the direction (box support function)
    const proj = Math.abs(dx) * (b.w / 2) + Math.abs(dy) * (b.h / 2);
    const g = this.ctx.createLinearGradient(cx - dx * proj, cy - dy * proj, cx + dx * proj, cy + dy * proj);
    for (const s of spec.stops) g.addColorStop(s.at, s.color);
    return g;
  }

  /** Offset drop shadow (distinct from the symmetric `glow`). */
  private applyShadow(s: ShadowSpec): void {
    const { ctx } = this;
    ctx.shadowColor = s.color;
    ctx.shadowBlur = s.blur;
    ctx.shadowOffsetX = s.dx ?? 0;
    ctx.shadowOffsetY = s.dy ?? 0;
  }
```

Add the import for the type at the top:

```ts
import type { Ctx2D, CanvasGradientLike, DrawableImage } from './context.js';
```

Rewrite `fillRoundRect`:

```ts
  fillRoundRect(b: Box, radius: number, color: string, opts: FillOpts = {}): this {
    const { ctx } = this;
    ctx.save();
    if (opts.opacity !== undefined) ctx.globalAlpha *= opts.opacity;
    if (opts.shadow) this.applyShadow(opts.shadow);
    else if (opts.glow) {
      ctx.shadowColor = opts.glow;
      ctx.shadowBlur = opts.glowBlur ?? 14;
    }
    ctx.fillStyle = opts.gradient ? this.gradientFor(b, opts.gradient) : color;
    this.roundRectPath(b, radius);
    ctx.fill();
    ctx.restore();
    return this;
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/src/renderer/draw-api-material.test.ts`
Expected: PASS (all three).

- [ ] **Step 6: Typecheck + full renderer suite (no regressions)**

Run: `pnpm typecheck && pnpm exec vitest run packages/core/src/renderer`
Expected: clean typecheck; all existing renderer tests still pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/renderer/draw-api.ts packages/core/src/renderer/draw-api-material.test.ts
git commit -m "feat(core): DrawApi gradient fill + offset drop shadow (K1)"
```

---

### Task 3: Extend gradient/shadow to the remaining fills and clean strokes

**Files:**
- Modify: `packages/core/src/renderer/draw-api.ts`
- Test: `packages/core/src/renderer/draw-api-material.test.ts` (append)

**Interfaces:**
- Produces: `StrokeOpts` gains `gradient?: GradientSpec` and `shadow?: ShadowSpec`. Gradient/shadow now honored by `fillEllipse`, `fillPolygon`, `strokeRoundRect`, `strokeEllipse`, `strokePolyline`. **Sketchy** strokes (roughness > 0) fall back to the gradient's **first stop color** (documented limitation). A private `private bboxOf(points: Vec2[]): Box` supports polygon/polyline gradients.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/renderer/draw-api-material.test.ts`:

```ts
describe('DrawApi materials — strokes & polygons', () => {
  it('gradient-strokes a clean polyline across its bounding box', () => {
    const { ctx, grads } = recordingCtx();
    new DrawApi(ctx, tokens).strokePolyline(
      [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      '#000',
      { gradient: { stops: [{ at: 0, color: '#f00' }, { at: 1, color: '#00f' }], angle: 0 } },
    );
    expect(grads).toHaveLength(1);
    // angle 0° (L→R) across bbox width 100, height 0 → (0,0)→(100,0)
    expect(grads[0]!.coords).toEqual([0, 0, 100, 0]);
  });

  it('falls back to the first stop color for a sketchy stroke', () => {
    const rough = { ...tokens, roughness: 2 } as unknown as ResolvedTokens;
    const ctx = new SVGContext();
    new DrawApi(ctx as unknown as Ctx2D, rough).strokeRoundRect({ x: 0, y: 0, w: 20, h: 20 }, 4, '#000', {
      gradient: { stops: [{ at: 0, color: '#abcdef' }, { at: 1, color: '#000000' }] },
    });
    const out = ctx.toSVG(20, 20);
    expect(out).toContain('stroke="#abcdef"');
    expect(out).not.toContain('<linearGradient');
  });

  it('gradient-fills an ellipse and a polygon', () => {
    const { ctx, grads } = recordingCtx();
    const api = new DrawApi(ctx, tokens);
    api.fillEllipse({ x: 0, y: 0, w: 40, h: 40 }, '#000', { gradient: { stops: [{ at: 0, color: '#fff' }, { at: 1, color: '#000' }] } });
    api.fillPolygon([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }], '#000', { gradient: { stops: [{ at: 0, color: '#fff' }, { at: 1, color: '#000' }] } });
    expect(grads).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/renderer/draw-api-material.test.ts -t "strokes & polygons"`
Expected: FAIL — `gradient` not in `StrokeOpts`; ellipse/polygon ignore gradient.

- [ ] **Step 3: Extend `StrokeOpts` and add `bboxOf`**

Extend `StrokeOpts` in `draw-api.ts`:

```ts
export interface StrokeOpts {
  width?: number;
  dash?: number[];
  glow?: string | null;
  glowBlur?: number;
  opacity?: number;
  cap?: 'butt' | 'round' | 'square';
  join?: 'round' | 'bevel' | 'miter';
  gradient?: GradientSpec;
  shadow?: ShadowSpec;
}
```

Add a bbox helper (after `gradientFor`):

```ts
  private bboxOf(points: Vec2[]): Box {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
```

- [ ] **Step 4: Wire the remaining primitives**

In `fillEllipse` and `fillPolygon`, mirror `fillRoundRect`'s pattern: replace the `if (opts.glow) {…}` block with the `opts.shadow ? applyShadow : glow` block, and set `ctx.fillStyle = opts.gradient ? this.gradientFor(<bbox>, opts.gradient) : color;` — the bbox is `b` for the ellipse and `this.bboxOf(points)` for the polygon.

For the clean-path branches of `strokeRoundRect`, `strokeEllipse`, `strokePolyline` (the code *after* the `if (rough > 0) return this.sketchStroke(...)` guard), likewise apply `opts.shadow`/`glow` and set `ctx.strokeStyle = opts.gradient ? this.gradientFor(<bbox>, opts.gradient) : color;` (bbox: `b` for roundrect/ellipse, `this.bboxOf(points)` for polyline).

For the **sketchy** branch, resolve the fallback color before dispatching. Change each sketchy guard from:

```ts
    if (rough > 0) return this.sketchStroke(this.rectCorners(b), true, color, opts, rough);
```
to:
```ts
    if (rough > 0) return this.sketchStroke(this.rectCorners(b), true, opts.gradient?.stops[0]?.color ?? color, opts, rough);
```
(and the analogous one-line change in `strokeEllipse` and `strokePolyline`).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/src/renderer/draw-api-material.test.ts`
Expected: PASS (all six across both describe blocks).

- [ ] **Step 6: Typecheck + renderer suite**

Run: `pnpm typecheck && pnpm exec vitest run packages/core/src/renderer`
Expected: clean; existing sketchy/paint tests unaffected.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/renderer/draw-api.ts packages/core/src/renderer/draw-api-material.test.ts
git commit -m "feat(core): gradient/shadow on all fills + clean strokes; sketchy first-stop fallback (K1)"
```

---

### Task 4: Canonical/serialization invariant guard

**Files:**
- Test: `packages/core/src/renderer/svg-export.test.ts` (append)

**Interfaces:**
- Consumes: everything from Tasks 1–3. Proves the invariant "gradients are deterministic; no document serialization changed."

- [ ] **Step 1: Write the test (determinism across a two-gradient scene)**

Append to `packages/core/src/renderer/svg-export.test.ts`:

```ts
describe('SVGContext gradient determinism', () => {
  it('assigns ids in draw order and is byte-identical across runs', () => {
    const build = (): string => {
      const ctx = new SVGContext();
      for (let i = 0; i < 2; i++) {
        const g = ctx.createLinearGradient(0, i * 10, 0, i * 10 + 10);
        g.addColorStop(0, '#111111');
        g.addColorStop(1, '#222222');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.rect(0, i * 10, 10, 10);
        ctx.fill();
      }
      return ctx.toSVG(10, 20);
    };
    const a = build();
    expect(a).toContain('id="nd-grad-0"');
    expect(a).toContain('id="nd-grad-1"');
    expect(a).toContain('fill="url(#nd-grad-0)"');
    expect(a).toContain('fill="url(#nd-grad-1)"');
    expect(build()).toBe(a); // deterministic
  });
});
```

- [ ] **Step 2: Run it (should pass immediately — guard, not new behavior)**

Run: `pnpm exec vitest run packages/core/src/renderer/svg-export.test.ts`
Expected: PASS.

- [ ] **Step 3: Prove the document/canonical path is untouched**

Run: `pnpm exec vitest run -t "canonical" && pnpm exec vitest run packages/core`
Expected: PASS — no serialization test changed (K1 adds only theme/paint capability, never touches records or `*.nodus.json`).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/renderer/svg-export.test.ts
git commit -m "test(core): gradient determinism guard; canonical serialization unchanged (K1)"
```

---

# K2 — Animation clock + presentation layer

### Task 5: Pure tween engine (`editor/animation.ts`)

**Files:**
- Create: `packages/core/src/editor/animation.ts`
- Test: `packages/core/src/editor/animation.test.ts`

**Interfaces:**
- Produces:
  - `type Easing = (t: number) => number;` with exports `linear`, `easeOutCubic`, `easeInOutCubic`.
  - `interface TweenSpec { from: number; to: number; durationMs: number; easing?: Easing; delayMs?: number; onTick: (value: number) => void; onDone?: () => void; }`
  - `class AnimationClock` with:
    - `add(spec: TweenSpec): () => void` — returns a cancel fn.
    - `step(now: number, reducedMotion: boolean): void` — advances all active tweens to `now`; under `reducedMotion` each tween jumps straight to `to`, fires `onTick(to)` + `onDone`, and is removed.
    - `isActive(): boolean` — true while any tween is unfinished.
  - The clock is time-fed (never calls `performance.now()`); the first `step` seeds each tween's start time so `durationMs` is honored regardless of the absolute clock origin.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/editor/animation.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { AnimationClock, easeOutCubic, linear } from './animation.js';

describe('AnimationClock', () => {
  it('interpolates linearly between from and to over the duration', () => {
    const clock = new AnimationClock();
    const seen: number[] = [];
    clock.add({ from: 0, to: 100, durationMs: 100, easing: linear, onTick: (v) => seen.push(v) });
    clock.step(1000, false); // seeds start at t=1000 → value 0
    clock.step(1050, false); // half → 50
    clock.step(1100, false); // done → 100
    expect(seen[0]).toBeCloseTo(0);
    expect(seen[1]).toBeCloseTo(50);
    expect(seen[2]).toBeCloseTo(100);
    expect(clock.isActive()).toBe(false);
  });

  it('fires onDone exactly once and goes inactive', () => {
    const clock = new AnimationClock();
    const done = vi.fn();
    clock.add({ from: 0, to: 1, durationMs: 50, onTick: () => {}, onDone: done });
    clock.step(0, false);
    clock.step(50, false);
    clock.step(60, false);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('honors delayMs before starting', () => {
    const clock = new AnimationClock();
    const seen: number[] = [];
    clock.add({ from: 0, to: 10, durationMs: 100, delayMs: 100, easing: linear, onTick: (v) => seen.push(v) });
    clock.step(0, false);   // within delay → value pinned at from
    clock.step(50, false);  // still delayed
    clock.step(150, false); // 50ms into the tween → 5
    expect(seen[0]).toBeCloseTo(0);
    expect(seen[1]).toBeCloseTo(0);
    expect(seen[2]).toBeCloseTo(5);
  });

  it('snaps to final value immediately under reduced motion', () => {
    const clock = new AnimationClock();
    const seen: number[] = [];
    const done = vi.fn();
    clock.add({ from: 0, to: 100, durationMs: 1000, onTick: (v) => seen.push(v), onDone: done });
    clock.step(0, true);
    expect(seen).toEqual([100]);
    expect(done).toHaveBeenCalledTimes(1);
    expect(clock.isActive()).toBe(false);
  });

  it('cancel() stops ticks and deactivates', () => {
    const clock = new AnimationClock();
    const onTick = vi.fn();
    const cancel = clock.add({ from: 0, to: 1, durationMs: 100, onTick });
    clock.step(0, false);
    cancel();
    clock.step(50, false);
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(clock.isActive()).toBe(false);
  });

  it('easeOutCubic starts fast and decelerates (monotonic, 0→1)', () => {
    expect(easeOutCubic(0)).toBeCloseTo(0);
    expect(easeOutCubic(1)).toBeCloseTo(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5); // decelerating → past halfway at t=0.5
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/editor/animation.test.ts`
Expected: FAIL — module `./animation.js` not found.

- [ ] **Step 3: Implement the engine**

Create `packages/core/src/editor/animation.ts`:

```ts
/**
 * A tiny, dependency-free tween engine — the generic animation substrate the editor uses to sustain
 * rAF the way flow does. It is *time-fed* (never reads `performance.now()`), so it stays headless and
 * deterministic: the host passes the paint timestamp into `step`. Under reduced motion every tween
 * snaps to its final value immediately (correct a11y, no ticking).
 */

export type Easing = (t: number) => number;

export const linear: Easing = (t) => t;
export const easeOutCubic: Easing = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic: Easing = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export interface TweenSpec {
  from: number;
  to: number;
  durationMs: number;
  easing?: Easing;
  delayMs?: number;
  onTick: (value: number) => void;
  onDone?: () => void;
}

interface Tween extends TweenSpec {
  start: number | null; // seeded on first step
  done: boolean;
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

export class AnimationClock {
  private tweens = new Set<Tween>();

  /** Register a tween; returns a cancel fn that removes it without firing `onDone`. */
  add(spec: TweenSpec): () => void {
    const tw: Tween = { ...spec, start: null, done: false };
    this.tweens.add(tw);
    return () => {
      this.tweens.delete(tw);
    };
  }

  /** Advance every active tween to `now`. Under `reducedMotion`, snap all to their final value. */
  step(now: number, reducedMotion: boolean): void {
    for (const tw of this.tweens) {
      if (tw.done) continue;
      if (reducedMotion) {
        tw.onTick(tw.to);
        tw.onDone?.();
        tw.done = true;
        continue;
      }
      if (tw.start == null) tw.start = now + (tw.delayMs ?? 0);
      const elapsed = now - tw.start;
      if (elapsed < 0) {
        tw.onTick(tw.from); // still within delay
        continue;
      }
      const raw = tw.durationMs <= 0 ? 1 : clamp01(elapsed / tw.durationMs);
      const eased = (tw.easing ?? easeOutCubic)(raw);
      tw.onTick(tw.from + (tw.to - tw.from) * eased);
      if (raw >= 1) {
        tw.onDone?.();
        tw.done = true;
      }
    }
    for (const tw of this.tweens) if (tw.done) this.tweens.delete(tw);
  }

  isActive(): boolean {
    for (const tw of this.tweens) if (!tw.done) return true;
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/src/editor/animation.test.ts`
Expected: PASS (all six).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add packages/core/src/editor/animation.ts packages/core/src/editor/animation.test.ts
git commit -m "feat(core): pure tween engine (AnimationClock) with reduced-motion snap (K2)"
```

---

### Task 6: Editor integration — `animate()`, `isAnimating()`, presentation map

**Files:**
- Modify: `packages/core/src/editor/index.ts`
- Test: `packages/core/src/editor/animation-integration.test.ts` (create)

**Interfaces:**
- Consumes: `AnimationClock`, `TweenSpec` (Task 5).
- Produces on `Editor`:
  - `interface Presentation { alpha: number; scale: number; dx: number; dy: number; }`
  - `animate(spec: TweenSpec): () => void` — delegates to the clock.
  - `presentationFor(id: string): Presentation | undefined` — the ephemeral per-item modifier (undefined = identity).
  - `setPresentation(id, patch: Partial<Presentation>): void` and `clearPresentation(id): void` — helpers a tween's `onTick` calls (ephemeral, never a store change).
  - `isAnimating(): boolean` — `this.animClock.isActive()`.
  - `render()` calls `this.animClock.step(time, this.reducedMotionAtom.peek())` **before** `paintStatic`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/editor/animation-integration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Editor, linear } from '../index.js';

// NOTE: adjust the import for `linear` if the barrel doesn't re-export it; else import from '../editor/animation.js'.

function editor(): Editor {
  return new Editor();
}

describe('editor animation integration', () => {
  it('animate() drives a presentation value and reports isAnimating()', () => {
    const ed = editor();
    ed.animate({
      from: 0,
      to: 1,
      durationMs: 100,
      easing: linear,
      onTick: (v) => ed.setPresentation('n1', { alpha: v }),
      onDone: () => ed.clearPresentation('n1'),
    });
    expect(ed.isAnimating()).toBe(true);
    ed.animClockStep(1000); // test-only helper, see step 3
    ed.animClockStep(1050);
    expect(ed.presentationFor('n1')?.alpha).toBeCloseTo(0.5);
    ed.animClockStep(1100);
    expect(ed.isAnimating()).toBe(false);
    expect(ed.presentationFor('n1')).toBeUndefined(); // cleared onDone
  });

  it('reduced motion snaps presentation and never sustains animation', () => {
    const ed = editor();
    ed.setReducedMotion(true);
    ed.animate({ from: 0, to: 1, durationMs: 1000, onTick: (v) => ed.setPresentation('n1', { alpha: v }) });
    ed.animClockStep(0);
    expect(ed.presentationFor('n1')?.alpha).toBe(1);
    expect(ed.isAnimating()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/editor/animation-integration.test.ts`
Expected: FAIL — `animate`/`presentationFor`/`animClockStep` undefined.

- [ ] **Step 3: Implement on `Editor`**

In `packages/core/src/editor/index.ts`:

1. Import near the other editor imports:

```ts
import { AnimationClock, type TweenSpec } from './animation.js';
```

2. Add the interface next to other exported editor types (top of file or near model re-exports):

```ts
export interface Presentation {
  alpha: number;
  scale: number;
  dx: number;
  dy: number;
}
```

3. Add fields near `flowClock` (~line 1847):

```ts
  private animClock = new AnimationClock();
  private presentation = new Map<string, Presentation>();
```

4. Add methods next to the flow methods (after `setReducedMotion`, ~line 1864):

```ts
  /** Register a tween on the shared animation clock. Returns a cancel fn. Ephemeral — no undo entry. */
  animate(spec: TweenSpec): () => void {
    return this.animClock.add(spec);
  }
  /** True while any tween is unfinished — the second rAF gate (OR-ed with `isFlowAnimating()`). */
  isAnimating(): boolean {
    return this.animClock.isActive();
  }
  /** Ephemeral per-item paint modifier (alpha/scale/offset). `undefined` = identity. Never serialized. */
  presentationFor(id: string): Presentation | undefined {
    return this.presentation.get(id);
  }
  /** Merge a presentation patch for `id` (defaults: alpha 1, scale 1, dx/dy 0). Ephemeral. */
  setPresentation(id: string, patch: Partial<Presentation>): void {
    const cur = this.presentation.get(id) ?? { alpha: 1, scale: 1, dx: 0, dy: 0 };
    this.presentation.set(id, { ...cur, ...patch });
  }
  clearPresentation(id: string): void {
    this.presentation.delete(id);
  }
  /** Test-only: advance the animation clock with the current reduced-motion state. */
  animClockStep(now: number): void {
    this.animClock.step(now, this.reducedMotionAtom.peek());
  }
```

5. In `render()` (~line 1904), advance the animation clock first:

```ts
  render(ctx: Ctx2D, cssW: number, cssH: number, dpr = 1, interactive = false, time = 0): void {
    this.setViewport(cssW, cssH);
    this.animClock.step(time, this.reducedMotionAtom.peek());
    this.paintStatic(ctx, cssW, cssH, dpr);
    this.paintFlow(ctx, dpr, time);
    this.paintOverlays(ctx, cssW, cssH, dpr);
    if (interactive) this.paintInteractive(ctx, cssW, cssH, dpr);
  }
```

6. If the test's `linear` import from the barrel fails typecheck, re-export from the core index barrel: add `export { linear, easeOutCubic, easeInOutCubic } from './editor/animation.js';` (or wherever the editor barrel lives). Verify with typecheck.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/src/editor/animation-integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + core suite**

Run: `pnpm typecheck && pnpm exec vitest run packages/core`
Expected: clean; no existing editor test regressed.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/editor/index.ts packages/core/src/editor/animation-integration.test.ts
git commit -m "feat(core): editor animate()/isAnimating() + ephemeral presentation map (K2)"
```

---

### Task 7: `paintItem` reads the presentation modifier

**Files:**
- Modify: `packages/core/src/renderer/paint.ts`
- Modify: `packages/core/src/editor/index.ts` (pass presentation into the static paint path)
- Test: `packages/core/src/renderer/paint.test.ts` (append)

**Interfaces:**
- Consumes: `Presentation` (Task 6).
- Produces: `paintItem` gains an optional final parameter `present?: Presentation`. When supplied and non-identity, it multiplies `globalAlpha` by `present.alpha` and applies `translate(dx,dy)` + a `scale` about the item's center **before** drawing. Identity/undefined = today's exact behavior (fast path). The editor's static paint loop passes `this.presentationFor(item.id)`.

- [ ] **Step 1: Write the failing test**

`paint.test.ts` already defines a stub-ctx factory (returns `{ ctx, calls, alpha }` where `alpha` is a getter over a real save/restore stack) and constructs node `RenderItem`s + a single-type `NodeRegistry` for its existing `paintItem` cases. **Reuse those exact in-file helpers** — do not invent new names. Import the renderer-local presentation type (NOT the editor's, which would recreate the import cycle Task 7 avoids):

```ts
import { paintItem, type ItemPresentation } from './paint.js';

it('multiplies globalAlpha by the presentation alpha', () => {
  // `stub` / `item` / `nodeReg` / `edgeReg` / `theme` here are the SAME factories the existing
  // paintItem tests in this file already use — mirror one of those cases exactly.
  const stub = makeStub();                 // ← the file's existing stub-ctx factory
  const item = nodeItem('n1');             // ← the file's existing node-RenderItem factory
  const present: ItemPresentation = { alpha: 0.5, scale: 1, dx: 0, dy: 0 };

  // Have the stub's draw NodeUtil record the alpha it sees at draw time (the existing stub already
  // maintains globalAlpha through save/restore — read `stub.alpha` inside a draw, or capture it via a
  // one-off NodeUtil.draw that pushes `api.ctx.globalAlpha`). With tokens.opacity = 1 the drawn alpha
  // must equal 0.5; without `present` it would be 1.
  const drawn: number[] = [];
  const reg = registryWithDraw((api) => drawn.push(api.ctx.globalAlpha)); // ← mirror file's registry factory
  paintItem(stub.ctx, item, reg, edgeReg, theme, present);
  expect(drawn[0]).toBeCloseTo(0.5);
});
```

If the file's existing helpers are named differently, use the file's actual names — the only fixed requirements are: import `ItemPresentation` from `./paint.js`, and assert that with `present.alpha = 0.5` the alpha observed inside the item's `draw` is `0.5` (versus `1` when `present` is omitted).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/renderer/paint.test.ts -t "presentation alpha"`
Expected: FAIL — `paintItem` takes no `present` arg.

- [ ] **Step 3: Implement in `paint.ts`**

Change the `paintItem` signature and body (the `import type` for `Presentation` would create a cycle; instead inline the shape locally):

```ts
/** Optional per-item ephemeral paint modifier (see Editor.presentationFor). Kept structural to avoid a
 *  renderer→editor import cycle. */
export interface ItemPresentation { alpha: number; scale: number; dx: number; dy: number; }

export function paintItem(
  ctx: Ctx2D,
  item: RenderItem,
  nodes: NodeRegistry,
  edges: EdgeRegistry,
  theme: Theme,
  present?: ItemPresentation,
): void {
  const rec = item.record;
  let tokens: ResolvedTokens;
  try {
    tokens = resolveTokensCached(theme, rec);
  } catch (err) {
    paintErrorHandler(err, rec);
    return;
  }
  const api = new DrawApi(ctx, tokens, hashId(rec.id));
  ctx.save();
  try {
    ctx.globalAlpha *= tokens.opacity;
    if (present && (present.alpha !== 1 || present.scale !== 1 || present.dx !== 0 || present.dy !== 0)) {
      ctx.globalAlpha *= present.alpha;
      const cx = item.aabb.x + item.aabb.w / 2;
      const cy = item.aabb.y + item.aabb.h / 2;
      ctx.translate(cx + present.dx, cy + present.dy);
      ctx.scale(present.scale, present.scale);
      ctx.translate(-cx, -cy);
    }
    if (item.kind === 'node') {
      paintNode(ctx, api, rec as NodeRecord, nodes.get(rec.type), tokens);
    } else if (item.route) {
      edges.get(rec.type)?.draw(api, rec as EdgeRecord, tokens, item.route);
    }
  } catch (err) {
    paintErrorHandler(err, rec);
    drawErrorPlaceholder(ctx, item.aabb);
  } finally {
    ctx.restore();
  }
}
```

Change `Editor`'s static paint loop to pass presentation. Find `paintItem(ctx, item, this.nodes, this.edges, theme)` inside `paintStatic` and change it to `paintItem(ctx, item, this.nodes, this.edges, theme, this.presentationFor(item.id))`. (Leave the `paintRegion`/PNG loop as-is — exports have no live animation.) Make `Editor.Presentation` structurally match `ItemPresentation`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/src/renderer/paint.test.ts`
Expected: PASS (new case + all existing paint cases).

- [ ] **Step 5: Typecheck + core suite**

Run: `pnpm typecheck && pnpm exec vitest run packages/core`
Expected: clean; the layer-cache tests still pass (identity presentation = unchanged output).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/renderer/paint.ts packages/core/src/editor/index.ts packages/core/src/renderer/paint.test.ts
git commit -m "feat(core): paintItem honors ephemeral presentation (alpha/scale/offset) (K2)"
```

---

### Task 8: Host continuous-paint gate

**Files:**
- Modify: `packages/react/src/nodus-host.tsx`

**Interfaces:**
- Consumes: `editor.isAnimating()` (Task 6).
- Produces: the rAF loop keeps ticking while `isFlowAnimating() || isAnimating()`; the flow-throttle path is reused so tweens honor `maxFps` and reduced-motion identically.

- [ ] **Step 1: Make the change**

In `packages/react/src/nodus-host.tsx`, in the `paint` closure, change:

```ts
      if (editor.isFlowAnimating()) armFlow(); // keep ticking while flowing (throttled to maxFps)
```
to:
```ts
      if (editor.isFlowAnimating() || editor.isAnimating()) armFlow(); // keep ticking while flow OR a tween is live
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Browser smoke (manual/driven) — deferred assertion**

There is no jsdom; this is verified in-browser by the subsystem plans that add a visible tween (entrance/drag). For now, confirm no regression by driving the app:

Run: `pnpm dev` (in a separate shell) then the canonical browser check `node scripts/browser-verify.mjs`
Expected: create/drag/undo/rename/auto-layout pass with zero console errors (existing behavior; the gate is a no-op until a tween is registered).

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/nodus-host.tsx
git commit -m "feat(react): sustain rAF while a tween is animating (K2)"
```

---

## Final verification (whole plan)

- [ ] `pnpm typecheck` — clean across all packages.
- [ ] `pnpm test` — whole suite green (new: `draw-api-material`, `animation`, `animation-integration`, gradient/paint additions).
- [ ] `pnpm exec vitest run -t "canonical"` — serialization unchanged (invariant #1).
- [ ] `node scripts/browser-verify.mjs` against `pnpm dev` — zero console errors (gate no-op until S1/S2).

## Self-review notes (author)

- **Spec coverage:** K1 (gradient + offset shadow, DOM/Skia/SVG parity) → Tasks 1–4. K2 (clock, tweens, reduced-motion snap, presentation layer, host gate) → Tasks 5–8. The `paintItem` presentation hook (Task 7) is the minimal end-to-end that makes K2 demonstrable; full motion features are S2.
- **Deferred by design (not gaps):** layer-cache compositing of animated items, and all *visual* material/motion features, belong to S1/S2 which consume these foundations. Stated in the Goal.
- **Type consistency:** `GradientSpec`/`ShadowSpec` (draw-api) and `Presentation`/`ItemPresentation`/`TweenSpec`/`AnimationClock` (editor) names are used identically across tasks. `ItemPresentation` (renderer) is the structural twin of `Presentation` (editor), kept separate only to avoid a renderer→editor import cycle.
- **Invariant guard:** Task 4 explicitly runs the canonical suite; no task writes to a record or `*.nodus.json`.
