# Canvas Signature — S1 Render Materials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the canvas read as premium: glassy gradient nodes with depth, source→target edge gradients, neon flow-on edge bloom, a depth-faded grid, an ambient radial-wash + vignette background, a glowing selection halo, and depth-of-field LOD — all at the **Balanced** intensity, **dark full / light calm**.

**Architecture:** Builds entirely on the K1 paint-material primitive (`gradient`/`shadow` on `DrawApi`). New *material* fields ride on the theme token system (data, layered by `resolveTokens`); the *edge gradient*, *ambient wash*, *grid fade*, and *selection halo* live where the needed context (endpoint colors, camera) is reachable — the editor's static/interactive paint passes. Ambient wash is editor chrome (live + `render()` snapshots only), never in diagram exports (`paintRegion`), so it needs no SVG parity.

**Tech Stack:** TypeScript strict + `noUncheckedIndexedAccess`, Vitest (`environment: 'node'`), Canvas-2D/Skia via `Ctx2D`, the `@nodus-dev/preset-infra` theme, `scripts/render-demo.ts` headless PNG harness.

## Global Constraints

- Static gate `pnpm typecheck` after every task (no eslint/prettier). Tests under `environment: 'node'` (no jsdom).
- **No new dependencies.** Core has zero DOM/framework deps.
- **Nothing new enters the document/undo/canonical serialization** — all new state is theme-data or paint-time-derived. Canonical tests must stay green.
- **Dark full / Light calm:** the dark theme gets the full aesthetic; the light theme keeps glass/gradients/depth but sets ambient washes + neon bloom to near-zero.
- **Balanced parameters** (from the spec): node gradient ±14% lightness, shadow 0/4px blur 16 @30%, rim-light 1px @18% white, flow-on edge +40% width + bloom blur 12–16, grid dots + accent majors + edge-fade, ambient accent+cool-blue washes + ~12% vignette, selection accent glow halo.
- Route mutations through `store.apply`/editor helpers — but this plan adds **no** record mutations. No core `switch`-on-type.
- Preserve existing fast paths: a node with no `glass` token draws exactly as today; an edge with no `strokeGradient` strokes exactly as today; identity presentation unchanged.

---

## File Structure

- `packages/core/src/renderer/color.ts` — CREATE: pure `shade`/`mix`/`parseHex`/`toHex` color helpers.
- `packages/core/src/renderer/color.test.ts` — CREATE.
- `packages/core/src/theme/index.ts` — MODIFY: add `glass?`, `shadow?`, `strokeGradient?` to `StateTokens`+`ResolvedTokens`+`resolveTokens`; extend `canvas.grid` (`major?`, `majorEvery?`) and add `canvas.ambient?`.
- `packages/core/src/renderer/stencil.ts` — MODIFY: glassy fill + rim-light + LOD in `drawStencil`.
- `packages/preset-infra/src/theme.ts` — MODIFY: set `glass`/`shadow`/grid-major/ambient per dark+light theme.
- `packages/core/src/renderer/context.ts` + `svg-context.ts` — MODIFY: add `createRadialGradient` (+ SVG `<radialGradient>` def stub).
- `packages/core/src/renderer/paint.ts` — MODIFY: `drawGrid` (majors+fade), a new `drawAmbient`, `paintItem` gains `override?`/`zoom?`, `DrawApi` gains `zoom`.
- `packages/core/src/renderer/draw-api.ts` — MODIFY: `DrawApi` ctor optional `zoom`.
- `packages/core/src/editor/index.ts` — MODIFY: call `drawAmbient` in `paintStaticInto`; compute edge `strokeGradient` + pass `override`/`zoom` to `paintItem`; neon flow glow pass; selection halo in `paintInteractive`.
- `packages/preset-infra/src/edge.ts` — MODIFY: honor `tokens.strokeGradient`.
- `scripts/render-demo.ts` — MODIFY: add material sample scenes (glassy/ambient/neon/halo).
- Tests: `stencil.test.ts`, `paint.test.ts`, theme tests, plus new `draw-api-material`/grid/ambient cases as noted per task.

---

### Task 1: Color helpers (`shade`/`mix`)

**Files:**
- Create: `packages/core/src/renderer/color.ts`, `packages/core/src/renderer/color.test.ts`

**Interfaces:**
- Produces: `parseHex(c: string): [number,number,number] | null`; `toHex(rgb: [number,number,number]): string`; `mix(a: string, b: string, t: number): string` (t 0→a, 1→b); `shade(hex: string, amt: number): string` — `amt>0` lightens toward white, `amt<0` darkens toward black, by `|amt|` fraction; non-hex input returns the input unchanged.

- [ ] **Step 1: Write the failing test** — `packages/core/src/renderer/color.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseHex, toHex, mix, shade } from './color.js';

describe('color helpers', () => {
  it('parses and re-emits hex', () => {
    expect(parseHex('#10b981')).toEqual([16, 185, 129]);
    expect(parseHex('nope')).toBeNull();
    expect(toHex([16, 185, 129])).toBe('#10b981');
  });
  it('mix interpolates endpoints', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
  it('shade lightens toward white and darkens toward black', () => {
    expect(shade('#808080', 0)).toBe('#808080');
    expect(shade('#808080', 1)).toBe('#ffffff');   // full lighten
    expect(shade('#808080', -1)).toBe('#000000');  // full darken
    // +14% lighten of mid-grey is brighter than the input, darken is dimmer
    expect(parseHex(shade('#808080', 0.14))![0]).toBeGreaterThan(128);
    expect(parseHex(shade('#808080', -0.14))![0]).toBeLessThan(128);
  });
  it('returns non-hex input unchanged', () => {
    expect(shade('rgba(0,0,0,0.5)', 0.2)).toBe('rgba(0,0,0,0.5)');
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing): `pnpm exec vitest run packages/core/src/renderer/color.test.ts`

- [ ] **Step 3: Implement** — `packages/core/src/renderer/color.ts`:

```ts
/** Tiny dependency-free color helpers for material derivation (glass gradients, edge blends). Pure. */

const clamp255 = (n: number): number => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n));

export function parseHex(c: string): [number, number, number] | null {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(c.trim());
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : null;
}

export function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((n) => clamp255(n).toString(16).padStart(2, '0')).join('')}`;
}

/** Linear blend a→b in RGB; `t` clamped to [0,1]. Non-hex inputs return `a` unchanged. */
export function mix(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return toHex([ca[0] + (cb[0] - ca[0]) * u, ca[1] + (cb[1] - ca[1]) * u, ca[2] + (cb[2] - ca[2]) * u]);
}

/** `amt>0` lightens toward white, `amt<0` darkens toward black, by `|amt|` fraction. Non-hex → unchanged. */
export function shade(hex: string, amt: number): string {
  if (!parseHex(hex)) return hex;
  return amt >= 0 ? mix(hex, '#ffffff', amt) : mix(hex, '#000000', -amt);
}
```

- [ ] **Step 4: Run — expect PASS**: `pnpm exec vitest run packages/core/src/renderer/color.test.ts`
- [ ] **Step 5: Typecheck**: `pnpm typecheck`
- [ ] **Step 6: Report to controller** (no commit — the lead commits).

---

### Task 2: Material token fields

**Files:**
- Modify: `packages/core/src/theme/index.ts`
- Test: `packages/core/src/theme/*` (append to the existing theme/token test, or create `theme-material.test.ts`)

**Interfaces:**
- Consumes: `GradientSpec`, `ShadowSpec` from `draw-api.ts` (type-only import — erased, so no runtime cycle even though `draw-api` imports `ResolvedTokens` from theme).
- Produces: `StateTokens` and `ResolvedTokens` each gain optional `glass?: number` (0..1 gradient/rim intensity; undefined/0 = flat), `shadow?: ShadowSpec` (offset drop shadow for the node tile), `strokeGradient?: GradientSpec` (edge source→target). `resolveTokens` copies all three through (default undefined). `Theme['canvas']['grid']` gains `major?: string` + `majorEvery?: number`; `Theme['canvas']` gains `ambient?: AmbientSpec` where `interface AmbientSpec { washes: { color: string; cx: number; cy: number; r: number }[]; vignette?: number }` (cx/cy are 0..1 fractions of the viewport; r is a 0..1 fraction of the diagonal; vignette 0..1 darkness).

- [ ] **Step 1: Write the failing test** — create `packages/core/src/theme/material-tokens.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveTokens, type Theme } from './index.js';

function themeWith(slice: Partial<Theme['states']['solid']>): Theme {
  // minimal theme; reuse defaults where possible
  const base = {
    palette: { accent: '#10b981' },
    typography: { fontFamily: 'sans', size: 12, lineHeight: 1.3 },
    radii: { node: 6 },
    canvas: { fill: '#000', grid: { color: '#111', size: 24 } },
    states: { solid: { fill: '#123456', stroke: '#abcdef', strokeWidth: 1.5, text: '#fff', ...slice } },
    overlays: {},
    focus: {},
  } as unknown as Theme;
  return base;
}

describe('material tokens', () => {
  it('resolveTokens carries glass/shadow/strokeGradient through', () => {
    const t = resolveTokens(
      themeWith({ glass: 0.16, shadow: { color: '#0006', blur: 16, dy: 4 } }),
      { state: 'solid' },
    );
    expect(t.glass).toBe(0.16);
    expect(t.shadow).toEqual({ color: '#0006', blur: 16, dy: 4 });
  });
  it('defaults material fields to undefined when unset', () => {
    const t = resolveTokens(themeWith({}), { state: 'solid' });
    expect(t.glass).toBeUndefined();
    expect(t.shadow).toBeUndefined();
    expect(t.strokeGradient).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`glass` not a token field): `pnpm exec vitest run packages/core/src/theme/material-tokens.test.ts`

- [ ] **Step 3: Implement** — in `packages/core/src/theme/index.ts`:
  1. Add the type-only import at the top: `import type { GradientSpec, ShadowSpec } from '../renderer/draw-api.js';`
  2. Add to `interface StateTokens`: `glass?: number; shadow?: ShadowSpec; strokeGradient?: GradientSpec;`
  3. Add the SAME three to `interface ResolvedTokens`.
  4. Add `interface AmbientSpec { washes: { color: string; cx: number; cy: number; r: number }[]; vignette?: number }` and `export` it; extend `canvas` to `{ fill: string; grid?: { color: string; size: number; major?: string; majorEvery?: number }; ambient?: AmbientSpec }`.
  5. In `resolveTokens`'s returned object, copy `glass: merged.glass, shadow: merged.shadow, strokeGradient: merged.strokeGradient` (they flow through `mergeTokens` automatically since it copies every defined key — verify by reading `mergeTokens`).

- [ ] **Step 4: Run — expect PASS**: same command.
- [ ] **Step 5: Typecheck + full theme tests**: `pnpm typecheck && pnpm exec vitest run packages/core/src/theme`
- [ ] **Step 6: Report to controller.**

---

### Task 3: Glassy nodes (drawStencil gradient + rim-light + shadow)

**Files:**
- Modify: `packages/core/src/renderer/stencil.ts`
- Modify: `packages/preset-infra/src/theme.ts` (set `glass`/`shadow` on both themes)
- Test: `packages/core/src/__tests__/stencil.test.ts` (append) — assert glass path calls `fillRoundRect` with a gradient+shadow; flat path unchanged.

**Interfaces:**
- Consumes: `shade` (Task 1), `tokens.glass`/`tokens.shadow` (Task 2), K1 `gradient`/`shadow` fill opts.
- Produces: when `tokens.glass && tokens.glass > 0`, the tile fills with a vertical gradient `[shade(fill, glass), shade(fill, -glass)]` + `tokens.shadow` (offset drop shadow), the accent glow moves to the stroke (`glow: tokens.glow, glowBlur: 8`), and a 1px inner top rim-light strokes at `white @ glass*1.1` opacity. When `glass` is falsy → today's exact flat behavior (fast path).

- [ ] **Step 1: Write the failing test** — append to `packages/core/src/__tests__/stencil.test.ts` (reuse the file's existing recording-ctx/DrawApi harness — read it first; mirror an existing drawStencil case). Assert that with `tokens.glass = 0.16` and a `tokens.shadow`, the tile `fillRoundRect` receives a `gradient` (two stops) and a `shadow`, and that a rim-light stroke is emitted; and that with `glass` unset, no gradient is used (flat fill, today's behavior). Use whatever assertion style the file already uses (recording ctx capturing `createLinearGradient`/`shadowOffset`, or a spy on DrawApi). Fixed requirement: glass on → gradient+shadow present; glass off → no gradient.

- [ ] **Step 2: Run — expect FAIL**.

- [ ] **Step 3: Implement** — in `packages/core/src/renderer/stencil.ts`, add `import { shade } from './color.js';` and replace the tile fill/stroke block:

```ts
  const glass = tokens.glass ?? 0;
  if (glass > 0) {
    api.fillRoundRect(tileBox, tokens.radius, tokens.fill, {
      gradient: { stops: [{ at: 0, color: shade(tokens.fill, glass) }, { at: 1, color: shade(tokens.fill, -glass) }] },
      ...(tokens.shadow ? { shadow: tokens.shadow } : {}),
    });
    // category glow rides the stroke (offset shadow + symmetric glow can't share one fill call)
    api.strokeRoundRect(tileBox, tokens.radius, tokens.stroke, {
      width: tokens.strokeWidth,
      dash: tokens.dash,
      glow: tokens.glow ?? undefined,
      glowBlur: 8,
    });
    // 1px inner top rim-light
    const r = tokens.radius;
    api.strokePolyline(
      [{ x: tileBox.x + r, y: tileBox.y + 1 }, { x: tileBox.x + tileBox.w - r, y: tileBox.y + 1 }],
      `rgba(255,255,255,${Math.min(0.4, glass * 1.1).toFixed(3)})`,
      { width: 1 },
    );
  } else {
    api.fillRoundRect(tileBox, tokens.radius, tokens.fill, { glow: tokens.glow ?? undefined, glowBlur: 14 });
    api.strokeRoundRect(tileBox, tokens.radius, tokens.stroke, { width: tokens.strokeWidth, dash: tokens.dash });
  }
```

  Then in `packages/preset-infra/src/theme.ts`: on `darkInfraTheme`, set the glassy material on the `solid`/`accent` state (whichever carries `fill`) — e.g. add `glass: 0.16, shadow: { color: 'rgba(0,0,0,0.30)', blur: 16, dy: 4 }`. On `infraLightTheme`, set a calmer `glass: 0.08, shadow: { color: 'rgba(20,30,40,0.16)', blur: 12, dy: 3 }`. (Light keeps depth; bloom/washes come later, kept near-zero there.)

- [ ] **Step 4: Run — expect PASS** + `pnpm exec vitest run packages/core` (no stencil/paint regressions).
- [ ] **Step 5: Snapshot** — `pnpm verify:render` then confirm `examples/output/*.png` regenerated without error (do NOT assert pixel values; this is a visual snapshot for the lead/user). Report that the render ran clean.
- [ ] **Step 6: Typecheck. Report to controller** (note: `verify:render` rewrites tracked PNGs — the lead decides whether to commit them).

---

### Task 4: `createRadialGradient` primitive (for ambient wash)

**Files:**
- Modify: `packages/core/src/renderer/context.ts`, `svg-context.ts`
- Test: `packages/core/src/renderer/svg-export.test.ts` (append)

**Interfaces:**
- Produces: `Ctx2D.createRadialGradient(x0,y0,r0,x1,y1,r1): CanvasGradientLike`. DOM/Skia native pass-through. `SVGContext` emits a `<radialGradient>` def (deterministic id `nd-rgrad-N`, draw order) referenced by `url(#…)` — same mechanism as the linear defs. (Used only by the editor-chrome ambient wash, which never reaches SVG export, but implemented for full interface parity.)

- [ ] **Step 1: Write the failing test** — append to `svg-export.test.ts`: create an `SVGContext`, `createRadialGradient(50,50,0,50,50,80)`, add two stops, fill a rect, assert output contains `<radialGradient id="nd-rgrad-0"` with `cx/cy/r/fx/fy` attrs and the `url(#nd-rgrad-0)` ref, and byte-identical across two runs.

- [ ] **Step 2: Run — expect FAIL**.

- [ ] **Step 3: Implement** — mirror the K1 linear gradient exactly:
  - `context.ts`: add `createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): CanvasGradientLike;` to `Ctx2D`.
  - `svg-context.ts`: add a `SVGRadialGradient` recorder (fields `x0,y0,r0,x1,y1,r1` + stops), implement `createRadialGradient` returning it, and in `paintValue` handle it → emit `<radialGradient id="nd-rgrad-N" gradientUnits="userSpaceOnUse" cx=fmt(x1) cy=fmt(y1) r=fmt(r1) fx=fmt(x0) fy=fmt(y0)>…stops…</radialGradient>` with a separate `nd-rgrad-` counter. Keep the existing linear path unchanged. (Reuse the `SVGGradient`/`paintValue`/`defs` structure — extend `paintValue` to accept either gradient type.)

- [ ] **Step 4: Run — expect PASS** + `pnpm exec vitest run packages/core/src/renderer`.
- [ ] **Step 5: Typecheck. Report to controller.**

---

### Task 5: Ambient background (radial washes + vignette + parallax)

**Files:**
- Modify: `packages/core/src/renderer/paint.ts` (new `drawAmbient`), `packages/core/src/editor/index.ts` (call it in `paintStaticInto`)
- Modify: `packages/preset-infra/src/theme.ts` (set `canvas.ambient` on dark; leave light unset/near-zero)
- Test: `packages/core/src/renderer/paint.test.ts` (append) — `drawAmbient` no-ops when `theme.canvas.ambient` is undefined; paints washes + vignette when set.

**Interfaces:**
- Consumes: `Ctx2D.createRadialGradient` (Task 4), `AmbientSpec` (Task 2), the camera.
- Produces: `export function drawAmbient(ctx: Ctx2D, theme: Theme, cam: Camera, deviceW: number, deviceH: number): void` — device-px space (identity transform, like `fillBackground`). No-op if `theme.canvas.ambient` is undefined. For each wash, paints a radial gradient from `wash.color` (center) to transparent (edge) centered at `(wash.cx*deviceW + parallaxX, wash.cy*deviceH + parallaxY)` with radius `wash.r * diagonal`, where `parallax = -cam * PARALLAX_K` (small, e.g. 0.04). Then an inner vignette: a radial gradient from transparent center to `rgba(0,0,0,vignette)` at the corners. Called in `paintStaticInto` immediately AFTER `fillBackground` and BEFORE the `setTransform(dpr…)`/`drawGrid`.

- [ ] **Step 1: Write the failing test** — append to `paint.test.ts`: with `theme.canvas.ambient` undefined, `drawAmbient` makes zero `createRadialGradient`/`fillRect` calls (use a recording ctx); with one wash + `vignette: 0.12`, it creates ≥2 radial gradients and fills. Reuse the file's recording-ctx pattern.

- [ ] **Step 2: Run — expect FAIL** (function missing).

- [ ] **Step 3: Implement** `drawAmbient` in `paint.ts` (device px; guard non-finite cam like `drawGrid` does), and in `editor/index.ts` `paintStaticInto`, add `drawAmbient(ctx, theme, cam, cssW * dpr, cssH * dpr);` right after `fillBackground(...)`. Also add the same call into `paintRegion` ONLY behind an opts flag if desired — default OFF (exports stay clean); simplest is to NOT touch `paintRegion` (ambient is live-canvas chrome). Then set `canvas.ambient` on `darkInfraTheme` (e.g. two washes: accent `rgba(16,185,129,0.10)` upper-left, cool-blue `rgba(59,130,246,0.10)` lower-right; `vignette: 0.12`); leave `infraLightTheme.canvas.ambient` unset (calm).

- [ ] **Step 4: Run — expect PASS** + `pnpm exec vitest run packages/core`.
- [ ] **Step 5: Snapshot** `pnpm verify:render` (clean run; PNGs regenerate). Report.
- [ ] **Step 6: Typecheck. Report to controller.**

---

### Task 6: Depth-faded grid (accent majors + radial edge-fade)

**Files:**
- Modify: `packages/core/src/renderer/paint.ts` (`drawGrid`)
- Modify: `packages/preset-infra/src/theme.ts` (grid `major`/`majorEvery` on both themes)
- Test: `packages/core/src/renderer/paint.test.ts` (append)

**Interfaces:**
- Consumes: extended `canvas.grid` (`major?`, `majorEvery?`) from Task 2, camera + viewport (already in `drawGrid`).
- Produces: `drawGrid` additionally strokes major gridlines every `majorEvery` cells (default 5) in `grid.major` color when set, and fades every dot/line's alpha by normalized screen distance from the viewport center (center ~full, edges → ~0). Preserves the existing dot rendering + the `step < 6` skip and non-finite-cam guard.

- [ ] **Step 1: Write the failing test** — append to `paint.test.ts`: with a `grid.major` color + `majorEvery: 5`, `drawGrid` strokes at least one major line (recording ctx captures `stroke`/`moveTo`/`lineTo` for majors distinct from the dot `fillRect`s); and the per-dot alpha varies (a dot near center has higher `globalAlpha` than one near the edge — capture `globalAlpha` at `fillRect` time). Keep it a real assertion (center alpha > edge alpha).

- [ ] **Step 2: Run — expect FAIL**.

- [ ] **Step 3: Implement** — in `drawGrid`: compute viewport center `(cssW/2, cssH/2)` and `maxDist = hypot(cssW,cssH)/2`; for each dot set `ctx.globalAlpha = baseAlpha * fade` where `fade = clamp(1 - dist/maxDist, 0, 1)` (optionally eased). When `grid.major` is set, in a second pass stroke vertical+horizontal lines at world coords where `(index % majorEvery) === 0`, in `grid.major`, faded the same way (thin, ~1px). Wrap in `save()/restore()` and restore `globalAlpha`. Then set `major`/`majorEvery` on both themes' `canvas.grid` (dark: faint accent-tinted major e.g. `rgba(16,185,129,0.06)`; light: `rgba(7,10,9,0.05)`).

- [ ] **Step 4: Run — expect PASS** + `pnpm exec vitest run packages/core/src/renderer`.
- [ ] **Step 5: Typecheck. Report to controller.**

---

### Task 7: Edge gradients (source→target)

**Files:**
- Modify: `packages/core/src/renderer/paint.ts` (`paintItem` gains `override?: Partial<ResolvedTokens>`)
- Modify: `packages/core/src/editor/index.ts` (`paintStaticInto` computes per-edge `strokeGradient`)
- Modify: `packages/preset-infra/src/edge.ts` (honor `tokens.strokeGradient`)
- Test: `packages/core/src/renderer/paint.test.ts` (append) + `packages/preset-infra/src/*edge*test` if present

**Interfaces:**
- Consumes: `strokeGradient` token field (Task 2), `this.sceneIndex.getItem(nodeId)` + `resolveTokensCached`.
- Produces: `paintItem(ctx, item, nodes, edges, theme, present?, override?)` — `override` is shallow-merged over the resolved tokens (`{ ...tokens, ...override }`) before `draw`. Editor's `paintStaticInto`: for each edge item, resolve source color = `resolveTokensCached(theme, srcNode.record).stroke` and target color likewise, compute the route-direction angle (degrees from `route[0]`→`route[last]`), and pass `override = { strokeGradient: { stops: [{at:0,color:src},{at:1,color:tgt}], angle } }`. `edge.ts` `draw`: if `tokens.strokeGradient`, stroke the polyline with `{ ...opts, gradient: tokens.strokeGradient }` instead of flat `tokens.stroke`; the arrowhead stays `tokens.stroke` (target color). When endpoints can't be resolved, pass no override (flat — today's behavior).

- [ ] **Step 1: Write the failing test** — append to `paint.test.ts`: `paintItem` with an `override` merges it into the tokens the util sees (assert the edge util receives `strokeGradient` in its tokens — use a stub edge registry whose `draw` records `tokens.strokeGradient`). Assert that WITHOUT override, `strokeGradient` is undefined. Also add an `edge.ts` unit (or extend an existing preset-infra edge test) asserting that with `tokens.strokeGradient` set, `strokePolyline` is called with a `gradient` opt.

- [ ] **Step 2: Run — expect FAIL**.

- [ ] **Step 3: Implement** — (a) `paint.ts`: add `override?: Partial<ResolvedTokens>` param; after `resolveTokensCached`, `if (override) tokens = { ...tokens, ...override };` (before building the DrawApi/draw). (b) `editor/index.ts` `paintStaticInto`: build a helper that, for an edge item, looks up endpoint colors via `this.sceneIndex.getItem(rec.from.nodeId)`/`rec.to.nodeId` → `resolveTokensCached(theme, node.record).stroke`, computes the angle, and returns the override; pass it as the 7th arg (nodes/non-edges pass `undefined`). (c) `edge.ts`: honor `tokens.strokeGradient`.

- [ ] **Step 4: Run — expect PASS** + `pnpm exec vitest run packages/core` (+ preset-infra if edge tests live there).
- [ ] **Step 5: Snapshot** `pnpm verify:render` clean. Typecheck. Report to controller.

---

### Task 8: Neon flow-on edge glow

**Files:**
- Modify: `packages/core/src/editor/index.ts` (flow paint path)
- Test: `packages/core/src/__tests__/flow.test.ts` (append) or a focused editor render test

**Interfaces:**
- Consumes: `flowConfig().enabled`, `record.flow`, `item.route`, the flow color (`resolveFlow(...).color ?? tokens.stroke`).
- Produces: when flow is enabled, each flowing edge gets a wide, translucent, glowing accent underlay stroked along its route (width `≈ strokeWidth * 1.4`, `glow: color`, `glowBlur: 14`, low alpha) drawn in the flow pass BEFORE the packet markers — the "neon bloom" on the edge. Gated by `flowConfig().enabled` (not motion) so it shows even when paused/reduced-motion. No document/cache impact (flow pass is not layer-cached).

- [ ] **Step 1: Write the failing test** — append to `flow.test.ts`: with a flowing edge and flow enabled, the flow draw pass strokes a wide glowing line (recording ctx: a `stroke` with `shadowBlur > 0` and a width greater than the base edge). With flow disabled, no such glow. Reuse the flow test harness.

- [ ] **Step 2: Run — expect FAIL**.

- [ ] **Step 3: Implement** — in `drawFlowEdges` (or a new `drawFlowEdgeGlow` called just before `paintFlowMarkers` per edge), when enabled, stroke `item.route` with the flow color at `glowBlur ~14`, `globalAlpha ~0.5`, `lineWidth ~= base*1.4`. Keep `paintFlowMarkers` unchanged. Ensure the glow pass runs under the same world transform already set by `paintFlow`.

- [ ] **Step 4: Run — expect PASS** + `pnpm exec vitest run packages/core`.
- [ ] **Step 5: Typecheck. Report to controller.**

---

### Task 9: Selection halo (static glow ring)

**Files:**
- Modify: `packages/core/src/editor/index.ts` (`paintInteractive`)
- Test: a focused editor interactive-paint test (append where selection painting is tested, or `paint.test.ts`-style)

**Interfaces:**
- Consumes: `strokeWorldBox`, `accent = theme.palette.accent`, `px(n)`, the selected node's padded `box`.
- Produces: for each selected NODE, a glowing accent halo ring is stroked on `box` UNDER the existing crisp accent stroke — `ctx.save(); ctx.shadowColor = accent; ctx.shadowBlur = px(12); strokeWorldBox(ctx, box, accent, px(2)); ctx.restore();` — then the existing `strokeWorldBox(ctx, box, accent, px(1.5), …)` draws on top. Static (the animated pulse is deferred to S2). Handles/rotate/lock unchanged.

- [ ] **Step 1: Write the failing test** — a test that selects a node, drives `paintInteractive` (or `render(..., interactive=true)`) with a recording ctx, and asserts a stroke with `shadowBlur > 0` in the accent color is emitted for the selection (the halo), distinct from the crisp `px(1.5)` stroke. If driving `paintInteractive` directly is awkward, use the editor + a recording ctx via `render`.

- [ ] **Step 2: Run — expect FAIL**.
- [ ] **Step 3: Implement** the halo block in `paintInteractive` (node branch only), immediately before the existing `strokeWorldBox(ctx, box, accent, px(1.5), …)`.
- [ ] **Step 4: Run — expect PASS** + `pnpm exec vitest run packages/core`.
- [ ] **Step 5: Snapshot** `pnpm verify:render` (step 2 of render-demo already selects a node — the halo appears). Typecheck. Report to controller.

---

### Task 10: Depth-of-field LOD

**Files:**
- Modify: `packages/core/src/renderer/draw-api.ts` (`DrawApi` ctor optional `zoom`)
- Modify: `packages/core/src/renderer/paint.ts` (`paintItem` gains `zoom?`, passes to DrawApi)
- Modify: `packages/core/src/editor/index.ts` (`paintStaticInto` passes `cam.z`)
- Modify: `packages/core/src/renderer/stencil.ts` (`drawStencil` drops glyph+label below threshold)
- Test: `packages/core/src/__tests__/stencil.test.ts` (append)

**Interfaces:**
- Consumes: `cam.z`.
- Produces: `new DrawApi(ctx, tokens, seed, zoom = 1)` exposing `readonly zoom: number`. `paintItem(ctx, item, nodes, edges, theme, present?, override?, zoom?)` — passes `zoom ?? 1` to the DrawApi ctor. `paintStaticInto` passes `cam.z` (8th arg). `drawStencil`: when `api.zoom < LOD_THRESHOLD` (0.5), skip the glyph (and its chip) and the sub-label — draw the tile + stroke only (declutter at low zoom). At/above threshold → today's full detail.

- [ ] **Step 1: Write the failing test** — append to `stencil.test.ts`: at `zoom = 0.4` the glyph (`api.icon`) and label (`api.label`) are NOT drawn (recording/spy shows no icon/label calls); at `zoom = 1` both are drawn. Reuse the file's DrawApi construction, passing the new zoom arg.

- [ ] **Step 2: Run — expect FAIL**.
- [ ] **Step 3: Implement** — DrawApi ctor `readonly zoom: number = 1`; `paintItem` 8th param → DrawApi ctor; editor passes `cam.z`; `drawStencil` gates the glyph+label block on `api.zoom >= 0.5` (define `const LOD_THRESHOLD = 0.5;`). Keep the paintRegion call site passing no zoom (defaults 1 — exports full detail).
- [ ] **Step 4: Run — expect PASS** + `pnpm exec vitest run packages/core`.
- [ ] **Step 5: Typecheck. Report to controller.**

---

## Final verification (whole plan)

- [ ] `pnpm typecheck` clean.
- [ ] `pnpm test` — whole suite green (new: color, material-tokens, stencil glass/LOD, radial-gradient, ambient, grid, edge-gradient, flow-glow, halo).
- [ ] `pnpm exec vitest run -t "canonical"` — serialization unchanged.
- [ ] `pnpm verify:render` — regenerates `examples/output/*.png`; the lead + user visually confirm the glassy/ambient/neon/halo look at Balanced intensity (dark) and calm (light). This is the acceptance gate for the aesthetic.
- [ ] Browser drive (lead): `node scripts/browser-verify.mjs` against `pnpm dev` — zero console errors; nodes render glassy, selection shows a halo.

## Self-review notes (author)

- **Spec coverage:** glassy nodes → T1/T2/T3; edge gradients → T7; neon flow edge → T8; depth grid → T6; ambient glow+vignette → T4/T5; selection halo (static) → T9; LOD → T10. (Animated halo pulse, parallax-easing, entrance/motion → S2, not here.)
- **paintItem signature evolution:** `present?` (K2), then `override?` (T7), then `zoom?` (T10) — appended optional params, each backward-compatible; the `paintRegion`/PNG-export call site passes none (exports keep full detail, no ambient, no edge-gradient — clean diagram output).
- **No document/canonical impact:** every field is theme-data or paint-derived; `strokeGradient`/edge colors/ambient are computed at paint, never serialized. T3/T5/T7 run the canonical/full suite.
- **Type cycle avoided:** theme imports `GradientSpec`/`ShadowSpec` from draw-api as `import type` (erased) — no runtime cycle despite draw-api importing `ResolvedTokens`.
- **Fast paths preserved:** `glass` falsy → flat node (T3 else-branch); no `strokeGradient` → flat edge (T7); `zoom >= 0.5` → full detail (T10); `ambient` unset → no wash (T5). Light theme exercises all the "calm" paths.
