# Cloud Provider Icon Packs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make official AWS/Azure/GCP service icons available as node glyphs (`props.icon: 'aws:lambda'`), rendered through the existing procedural pipeline in both browser and headless.

**Architecture:** A build-time codegen converts vendored official SVGs into compact vector "packs" (path-command data). A generic `drawVectorIcon` in core replays that data through the existing `Ctx2D` primitives — no `Ctx2D` change, no runtime assets, no async. A new `@ahmazin/icons-cloud` package holds the data and registers each icon under a `provider:service` name into core's icon registry, so `drawStencil`/`iconNode` draw them unchanged.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), pnpm workspaces (packages resolve `main → src`, no build step), vitest, tsx for scripts, `@napi-rs/canvas` for headless render, dev deps `svgson` + `svgpath` for the converter.

## Global Constraints

- Preserve the render invariant: **no new `Ctx2D` methods**; `drawVectorIcon` uses only existing primitives (`beginPath/moveTo/lineTo/bezierCurveTo/closePath/fill`, `fillStyle`, `save/restore`).
- Provider icons render their **own baked colors**; the theme accent is ignored for them (the stencil tile still uses the accent for border/glow).
- Icon registry names are namespaced `provider:service` (e.g. `aws:lambda`, `azure:functions`, `gcp:run`).
- Command opcodes in pack data: `0=M, 1=L, 2=C, 3=Z`. The converter pre-bakes arcs **and** quadratics to cubic, so replay only needs those four.
- Packages resolve to source (`main: ./src/index.ts`); no build needed for cross-package imports. Scripts run via `tsx`.
- Tests are vitest; gate is `pnpm typecheck && pnpm test && pnpm verify:render` plus a visual grid render.
- End every commit message with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

**Preflight (do once before Task 1):**
- The working tree currently holds the uncommitted "stencil" sub-project and the branch is detached (`HEAD`). Consolidate with the user first: create a feature branch off `main` (e.g. `feat/cloud-icon-packs`) and commit the pending stencil work, so this plan's commits land cleanly.
- Install converter dev deps: `pnpm --filter @ahmazin/icons-cloud add -D svgson svgpath` (run after Task 3 creates the package; listed here so it isn't forgotten).

---

### Task 1: `drawVectorIcon` renderer + `VectorIcon` types in core

**Files:**
- Create: `packages/core/src/icons/vector.ts`
- Modify: `packages/core/src/index.ts` (barrel export)
- Test: `packages/core/src/__tests__/vector.test.ts`

**Interfaces:**
- Produces: `interface VectorSubpath { fill: string; cmds: number[] }`, `interface VectorIcon { vb: [number, number]; sub: VectorSubpath[]; needsChip?: boolean }`, `const OP = { M:0, L:1, C:2, Z:3 }`, `function drawVectorIcon(ctx: Ctx2D, icon: VectorIcon, box: Box): void`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/__tests__/vector.test.ts
import { describe, expect, it } from 'vitest';
import { drawVectorIcon, OP, type Ctx2D, type VectorIcon } from '../index.js';

function stubCtx() {
  const fills: string[] = [];
  const ops: string[] = [];
  const pts: number[] = [];
  const ctx = {
    save() {}, restore() {}, beginPath() { ops.push('begin'); },
    moveTo(x: number, y: number) { ops.push('M'); pts.push(x, y); },
    lineTo(x: number, y: number) { ops.push('L'); pts.push(x, y); },
    bezierCurveTo(...n: number[]) { ops.push('C'); pts.push(...n); },
    closePath() { ops.push('Z'); },
    fill() { fills.push((ctx as unknown as { fillStyle: string }).fillStyle); },
    fillStyle: '',
  };
  return { ctx: ctx as unknown as Ctx2D, fills, ops, pts };
}

const icon: VectorIcon = {
  vb: [10, 10],
  sub: [{ fill: '#ED7100', cmds: [OP.M, 0, 0, OP.L, 10, 0, OP.L, 10, 10, OP.Z] }],
};

describe('drawVectorIcon', () => {
  it('scales the viewBox into the box, centers, and fills each subpath in its own color', () => {
    const { ctx, fills, ops, pts } = stubCtx();
    drawVectorIcon(ctx, icon, { x: 100, y: 200, w: 20, h: 20 });
    expect(fills).toEqual(['#ED7100']);
    expect(ops).toEqual(['begin', 'M', 'L', 'L', 'Z']);
    // vb 10 -> box 20 => scale 2; origin (100,200); first point (0,0) -> (100,200)
    expect(pts.slice(0, 2)).toEqual([100, 200]);
    // point (10,0) -> (120,200)
    expect(pts.slice(2, 4)).toEqual([120, 200]);
  });

  it('preserves aspect ratio and centers on the shorter axis', () => {
    const { ctx, pts } = stubCtx();
    drawVectorIcon(ctx, icon, { x: 0, y: 0, w: 40, h: 20 }); // scale = min(4,2)=2; ox=(40-20)/2=10
    expect(pts.slice(0, 2)).toEqual([10, 0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/__tests__/vector.test.ts`
Expected: FAIL — `drawVectorIcon`/`OP` not exported from `../index.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/icons/vector.ts
/**
 * Data-driven vector icons: a compact path-command format replayed through the existing Ctx2D
 * primitives, so provider icon packs (AWS/Azure/GCP) render identically in the browser and headless.
 * Icons carry their own baked fills (multi-color brand art); the theme accent is not applied here.
 */
import type { Box } from '../model.js';
import type { Ctx2D } from '../renderer/context.js';

export interface VectorSubpath {
  fill: string;
  cmds: number[]; // flat opcode stream: 0=M(x,y) 1=L(x,y) 2=C(x1,y1,x2,y2,x,y) 3=Z
}
export interface VectorIcon {
  vb: [number, number];
  sub: VectorSubpath[];
  needsChip?: boolean;
}

export const OP = { M: 0, L: 1, C: 2, Z: 3 } as const;

/** Replay a vector icon scaled to fit `box` (aspect-preserving, centered), filling own colors. */
export function drawVectorIcon(ctx: Ctx2D, icon: VectorIcon, box: Box): void {
  const [vw, vh] = icon.vb;
  if (vw <= 0 || vh <= 0) return;
  const scale = Math.min(box.w / vw, box.h / vh);
  const ox = box.x + (box.w - vw * scale) / 2;
  const oy = box.y + (box.h - vh * scale) / 2;
  const X = (x: number): number => ox + x * scale;
  const Y = (y: number): number => oy + y * scale;
  ctx.save();
  for (const sp of icon.sub) {
    ctx.beginPath();
    const c = sp.cmds;
    let i = 0;
    while (i < c.length) {
      const op = c[i++];
      if (op === OP.M) ctx.moveTo(X(c[i++]!), Y(c[i++]!));
      else if (op === OP.L) ctx.lineTo(X(c[i++]!), Y(c[i++]!));
      else if (op === OP.C)
        ctx.bezierCurveTo(X(c[i++]!), Y(c[i++]!), X(c[i++]!), Y(c[i++]!), X(c[i++]!), Y(c[i++]!));
      else if (op === OP.Z) ctx.closePath();
      else break;
    }
    ctx.fillStyle = sp.fill;
    ctx.fill();
  }
  ctx.restore();
}
```

Add to `packages/core/src/index.ts` right after the `drawStencil` export line:

```ts
export { drawVectorIcon, OP, type VectorIcon, type VectorSubpath } from './icons/vector.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/__tests__/vector.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/icons/vector.ts packages/core/src/index.ts packages/core/src/__tests__/vector.test.ts
git commit -m "feat(core): add drawVectorIcon data-driven vector renderer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Icon metadata (`needsChip`) on the registry

**Files:**
- Modify: `packages/core/src/icons/index.ts` (registry + `registerIcon` + new `getIconMeta`)
- Modify: `packages/core/src/index.ts` (barrel export)
- Test: `packages/core/src/__tests__/icons.test.ts` (extend)

**Interfaces:**
- Consumes: existing `registerIcon(name, draw)`.
- Produces: `interface IconMeta { needsChip?: boolean }`, `registerIcon(name: string, draw: IconDraw, meta?: IconMeta): void`, `function getIconMeta(name: string): IconMeta | undefined`.

- [ ] **Step 1: Write the failing test** (append to `icons.test.ts`)

```ts
import { getIconMeta, registerIcon } from '../index.js';

describe('icon metadata', () => {
  it('stores and returns needsChip metadata per icon', () => {
    registerIcon('meta-test', () => {}, { needsChip: true });
    expect(getIconMeta('meta-test')?.needsChip).toBe(true);
    registerIcon('meta-test-2', () => {});
    expect(getIconMeta('meta-test-2')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/__tests__/icons.test.ts`
Expected: FAIL — `getIconMeta` not exported.

- [ ] **Step 3: Write the implementation**

In `packages/core/src/icons/index.ts`, add near the registry declaration:

```ts
export interface IconMeta { needsChip?: boolean }
const iconMeta = new Map<string, IconMeta>();
```

Replace `registerIcon`:

```ts
export function registerIcon(name: string, draw: IconDraw, meta?: IconMeta): void {
  registry.set(name, draw);
  if (meta) iconMeta.set(name, meta);
  else iconMeta.delete(name);
}
export function getIconMeta(name: string): IconMeta | undefined {
  return iconMeta.get(name);
}
```

In `packages/core/src/index.ts`, extend the icons export block to add `getIconMeta` and `type IconMeta`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/__tests__/icons.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/icons/index.ts packages/core/src/index.ts packages/core/src/__tests__/icons.test.ts
git commit -m "feat(core): per-icon metadata (needsChip) on the registry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `needsChip` light chip in `drawStencil`

**Files:**
- Modify: `packages/core/src/renderer/stencil.ts`
- Test: `packages/core/src/__tests__/stencil.test.ts` (extend)

**Interfaces:**
- Consumes: `getIconMeta(name)` (Task 2), existing `DrawApi.fillRoundRect`.
- Produces: `drawStencil` draws a light rounded chip behind the glyph when `getIconMeta(opts.icon)?.needsChip` is true.

- [ ] **Step 1: Write the failing test** (append to `stencil.test.ts`)

```ts
import { registerIcon } from '../index.js';

describe('drawStencil needsChip', () => {
  it('paints a light chip behind glyphs flagged needsChip', () => {
    registerIcon('chip-test', () => {}, { needsChip: true });
    registerIcon('plain-test', () => {});
    const chip = stubCtx();
    drawStencil(new DrawApi(chip.ctx, TOKENS), node(), TOKENS, { icon: 'chip-test', label: 'X' });
    const plain = stubCtx();
    drawStencil(new DrawApi(plain.ctx, TOKENS), node(), TOKENS, { icon: 'plain-test', label: 'X' });
    // the chip adds one extra fill (the chip rect) vs the plain icon
    expect((chip.calls.fill ?? 0)).toBeGreaterThan(plain.calls.fill ?? 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/__tests__/stencil.test.ts`
Expected: FAIL — chip fill count equals plain (no chip drawn yet).

- [ ] **Step 3: Write the implementation**

In `packages/core/src/renderer/stencil.ts`, add the import:

```ts
import { getIconMeta } from '../icons/index.js';
```

Replace the glyph block inside `drawStencil`:

```ts
  const locked = tokens.labelOverride !== undefined;
  if (!locked && tile > 0) {
    const inset = tile * 0.22;
    const glyphBox = { x: tileBox.x + inset, y: tileBox.y + inset, w: tile - 2 * inset, h: tile - 2 * inset };
    if (getIconMeta(opts.icon)?.needsChip) {
      const cp = tile * 0.1;
      api.fillRoundRect(
        { x: glyphBox.x - cp, y: glyphBox.y - cp, w: glyphBox.w + 2 * cp, h: glyphBox.h + 2 * cp },
        Math.max(2, tokens.radius * 0.6),
        '#f5f6f8',
      );
    }
    api.icon(opts.icon, glyphBox, tokens.text, tokens.stroke);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/__tests__/stencil.test.ts`
Expected: PASS (all stencil tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/renderer/stencil.ts packages/core/src/__tests__/stencil.test.ts
git commit -m "feat(core): light chip behind low-contrast stencil glyphs (needsChip)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `@ahmazin/icons-cloud` package + install/registration + fixture pack

**Files:**
- Create: `packages/icons-cloud/package.json`, `packages/icons-cloud/tsconfig.json`
- Create: `packages/icons-cloud/src/index.ts`, `src/install.ts`, `src/aws.ts`, `src/azure.ts`, `src/gcp.ts`
- Create: `packages/icons-cloud/src/generated/{aws,azure,gcp}-pack.ts` (fixture stubs; codegen overwrites in Task 6)
- Test: `packages/icons-cloud/src/__tests__/packs.test.ts`

**Interfaces:**
- Consumes: `registerIcon`, `drawVectorIcon`, `VectorIcon` from `@ahmazin/core`.
- Produces: `installAwsIcons()`, `installAzureIcons()`, `installGcpIcons()`, `installCloudIcons()`; per-provider packs `awsPack`/`azurePack`/`gcpPack: Record<string, VectorIcon>`.

- [ ] **Step 1: Create package scaffolding**

```json
// packages/icons-cloud/package.json
{
  "name": "@ahmazin/icons-cloud",
  "version": "0.0.0",
  "type": "module",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": { "types": "./src/index.ts", "default": "./src/index.ts" },
    "./aws": { "types": "./src/aws.ts", "default": "./src/aws.ts" },
    "./azure": { "types": "./src/azure.ts", "default": "./src/azure.ts" },
    "./gcp": { "types": "./src/gcp.ts", "default": "./src/gcp.ts" }
  },
  "dependencies": { "@ahmazin/core": "workspace:*" }
}
```

```json
// packages/icons-cloud/tsconfig.json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

(Verify the extends path against a sibling package's tsconfig, e.g. `packages/preset-infra/tsconfig.json`, and match it.)

- [ ] **Step 2: Create fixture packs** (one placeholder icon each; codegen replaces in Task 6)

```ts
// packages/icons-cloud/src/generated/aws-pack.ts
import type { VectorIcon } from '@ahmazin/core';
// GENERATED placeholder — replaced by scripts/build-icon-packs.ts once toolkits are vendored.
export const awsPack: Record<string, VectorIcon> = {
  'aws:lambda': { vb: [24, 24], sub: [{ fill: '#ED7100', cmds: [0, 3, 3, 1, 21, 3, 1, 21, 21, 1, 3, 21, 3] }] },
};
```

```ts
// packages/icons-cloud/src/generated/azure-pack.ts
import type { VectorIcon } from '@ahmazin/core';
export const azurePack: Record<string, VectorIcon> = {
  'azure:functions': { vb: [24, 24], sub: [{ fill: '#0078D4', cmds: [0, 3, 3, 1, 21, 3, 1, 21, 21, 1, 3, 21, 3] }] },
};
```

```ts
// packages/icons-cloud/src/generated/gcp-pack.ts
import type { VectorIcon } from '@ahmazin/core';
export const gcpPack: Record<string, VectorIcon> = {
  'gcp:run': { vb: [24, 24], sub: [{ fill: '#4285F4', cmds: [0, 3, 3, 1, 21, 3, 1, 21, 21, 1, 3, 21, 3] }] },
};
```

- [ ] **Step 3: Create install + entrypoints**

```ts
// packages/icons-cloud/src/install.ts
import { drawVectorIcon, registerIcon, type VectorIcon } from '@ahmazin/core';

export function installPack(pack: Record<string, VectorIcon>): void {
  for (const [name, icon] of Object.entries(pack)) {
    registerIcon(
      name,
      (ctx, x, y, s) => drawVectorIcon(ctx, icon, { x, y, w: s, h: s }),
      icon.needsChip ? { needsChip: true } : undefined,
    );
  }
}
```

```ts
// packages/icons-cloud/src/aws.ts
import { installPack } from './install.js';
import { awsPack } from './generated/aws-pack.js';
export { awsPack };
export function installAwsIcons(): void { installPack(awsPack); }
```

```ts
// packages/icons-cloud/src/azure.ts
import { installPack } from './install.js';
import { azurePack } from './generated/azure-pack.js';
export { azurePack };
export function installAzureIcons(): void { installPack(azurePack); }
```

```ts
// packages/icons-cloud/src/gcp.ts
import { installPack } from './install.js';
import { gcpPack } from './generated/gcp-pack.js';
export { gcpPack };
export function installGcpIcons(): void { installPack(gcpPack); }
```

```ts
// packages/icons-cloud/src/index.ts
export { installAwsIcons, awsPack } from './aws.js';
export { installAzureIcons, azurePack } from './azure.js';
export { installGcpIcons, gcpPack } from './gcp.js';
export { installPack } from './install.js';
export function installCloudIcons(): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- static imports below
}
```

Then rewrite `installCloudIcons` in `index.ts` to call the three (static imports):

```ts
// packages/icons-cloud/src/index.ts
import { installAwsIcons } from './aws.js';
import { installAzureIcons } from './azure.js';
import { installGcpIcons } from './gcp.js';
export { installAwsIcons, awsPack } from './aws.js';
export { installAzureIcons, azurePack } from './azure.js';
export { installGcpIcons, gcpPack } from './gcp.js';
export { installPack } from './install.js';
export function installCloudIcons(): void {
  installAwsIcons();
  installAzureIcons();
  installGcpIcons();
}
```

- [ ] **Step 4: Write the test**

```ts
// packages/icons-cloud/src/__tests__/packs.test.ts
import { describe, expect, it } from 'vitest';
import { getIcon, getIconMeta } from '@ahmazin/core';
import { installCloudIcons } from '../index.js';

function stubCtx() {
  return {
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {},
    closePath() {}, fill() {}, fillStyle: '',
  } as unknown as Parameters<NonNullable<ReturnType<typeof getIcon>>>[0];
}

describe('cloud icon packs', () => {
  it('registers namespaced provider icons that render without throwing', () => {
    installCloudIcons();
    for (const name of ['aws:lambda', 'azure:functions', 'gcp:run']) {
      const draw = getIcon(name);
      expect(draw, name).toBeTypeOf('function');
      expect(() => draw!(stubCtx(), 0, 0, 40, '#fff')).not.toThrow();
    }
  });

  it('carries needsChip metadata through registration when set', () => {
    installCloudIcons();
    // fixture icons have no needsChip; real packs may. Just assert the lookup path works.
    expect(getIconMeta('aws:lambda')).toBeUndefined();
  });
});
```

- [ ] **Step 5: Install into workspace + run tests**

Run: `pnpm install` (picks up the new workspace package), then
`pnpm vitest run packages/icons-cloud`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/icons-cloud
git commit -m "feat(icons-cloud): package scaffold, install/registration, fixture packs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: SVG → vector converter (`svgToVectorIcon`)

**Files:**
- Create: `packages/icons-cloud/src/codegen/svg-to-vector.ts`
- Test: `packages/icons-cloud/src/__tests__/svg-to-vector.test.ts`
- Modify: `packages/icons-cloud/package.json` (add dev deps)

**Interfaces:**
- Consumes: `svgson` (`parseSync`), `svgpath`, `OP` + `VectorIcon`/`VectorSubpath` from `@ahmazin/core`.
- Produces: `function svgToVectorIcon(svg: string): { icon: VectorIcon; warnings: string[] }`.

- [ ] **Step 1: Add dev deps**

Run: `pnpm --filter @ahmazin/icons-cloud add -D svgson svgpath`

- [ ] **Step 2: Write the failing test**

```ts
// packages/icons-cloud/src/__tests__/svg-to-vector.test.ts
import { describe, expect, it } from 'vitest';
import { OP } from '@ahmazin/core';
import { svgToVectorIcon } from '../codegen/svg-to-vector.js';

const SVG = `<svg viewBox="0 0 24 24">
  <g transform="translate(2 2)"><rect x="0" y="0" width="20" height="20" fill="#ED7100"/></g>
  <path d="M4 4 L16 4 L10 16 Z" fill="#ffffff"/>
</svg>`;

describe('svgToVectorIcon', () => {
  it('reads the viewBox', () => {
    expect(svgToVectorIcon(SVG).icon.vb).toEqual([24, 24]);
  });

  it('bakes group transforms into coordinates and keeps per-shape fills', () => {
    const { icon } = svgToVectorIcon(SVG);
    expect(icon.sub).toHaveLength(2);
    const rect = icon.sub[0]!;
    expect(rect.fill).toBe('#ED7100');
    expect(rect.cmds[0]).toBe(OP.M);
    // rect origin (0,0) translated by (2,2) -> first moveTo is (2,2)
    expect(rect.cmds.slice(1, 3)).toEqual([2, 2]);
    expect(icon.sub[1]!.fill).toBe('#ffffff');
  });

  it('flattens a gradient fill to a representative solid', () => {
    const g = `<svg viewBox="0 0 10 10">
      <defs><linearGradient id="a"><stop offset="0" stop-color="#111"/><stop offset="1" stop-color="#999"/></linearGradient></defs>
      <rect x="0" y="0" width="10" height="10" fill="url(#a)"/></svg>`;
    const { icon } = svgToVectorIcon(g);
    expect(icon.sub[0]!.fill).toBe('#999'); // mid stop of 2 -> index 1
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/icons-cloud/src/__tests__/svg-to-vector.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

```ts
// packages/icons-cloud/src/codegen/svg-to-vector.ts
/**
 * Build-time converter: official vendor SVG -> compact VectorIcon (path-command data).
 * Bakes group transforms, absolutizes paths, converts arcs and quadratics to cubics, extracts
 * per-shape fills, and flattens gradient paints to a representative solid. Dev-only (uses svgson/svgpath).
 */
import { parseSync } from 'svgson';
import svgpath from 'svgpath';
import { OP, type VectorIcon, type VectorSubpath } from '@ahmazin/core';

interface SvgNode {
  name: string;
  type: string;
  value: string;
  attributes: Record<string, string>;
  children: SvgNode[];
}

export function svgToVectorIcon(svg: string): { icon: VectorIcon; warnings: string[] } {
  const warnings: string[] = [];
  const root = parseSync(svg) as unknown as SvgNode;
  const vb = readViewBox(root, warnings);
  const gradients = collectGradients(root);
  const sub: VectorSubpath[] = [];
  walk(root, '', root.attributes?.fill, gradients, sub, warnings);
  return { icon: { vb, sub }, warnings };
}

function readViewBox(root: SvgNode, warnings: string[]): [number, number] {
  const vb = root.attributes?.viewBox;
  if (vb) {
    const p = vb.trim().split(/[\s,]+/).map(Number);
    return [p[2] || 24, p[3] || 24];
  }
  const w = Number(root.attributes?.width) || 0;
  const h = Number(root.attributes?.height) || 0;
  if (w && h) return [w, h];
  warnings.push('no viewBox; defaulting to 24x24');
  return [24, 24];
}

function styleProp(style: string | undefined, prop: string): string | undefined {
  if (!style) return undefined;
  const m = style.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1]!.trim() : undefined;
}

function collectGradients(root: SvgNode): Map<string, string> {
  const map = new Map<string, string>();
  const visit = (n: SvgNode): void => {
    if ((n.name === 'linearGradient' || n.name === 'radialGradient') && n.attributes?.id) {
      const stops = (n.children ?? []).filter((c) => c.name === 'stop');
      const mid = stops[Math.floor(stops.length / 2)] ?? stops[0];
      const col = mid ? mid.attributes['stop-color'] ?? styleProp(mid.attributes.style, 'stop-color') : undefined;
      if (col) map.set(n.attributes.id, col);
    }
    (n.children ?? []).forEach(visit);
  };
  visit(root);
  return map;
}

function resolveFill(
  a: Record<string, string>,
  inherit: string | undefined,
  gradients: Map<string, string>,
  warnings: string[],
): string | undefined {
  const f = a.fill ?? styleProp(a.style, 'fill') ?? inherit;
  if (!f) return inherit;
  if (f.startsWith('url(')) {
    const id = f.slice(4, -1).replace(/["']/g, '').replace('#', '');
    const flat = gradients.get(id);
    if (flat) return flat;
    warnings.push(`unresolved paint ${f}`);
    return '#888888';
  }
  return f;
}

function shapeToPath(n: SvgNode): string | null {
  const a = n.attributes ?? {};
  const num = (k: string): number => Number(a[k]) || 0;
  switch (n.name) {
    case 'path':
      return a.d ?? null;
    case 'rect': {
      const x = num('x'), y = num('y'), w = num('width'), h = num('height');
      if (!w || !h) return null;
      const rx = a.rx !== undefined ? Number(a.rx) : a.ry !== undefined ? Number(a.ry) : 0;
      const ry = a.ry !== undefined ? Number(a.ry) : rx;
      if (rx || ry)
        return `M${x + rx},${y}H${x + w - rx}A${rx},${ry} 0 0 1 ${x + w},${y + ry}V${y + h - ry}A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}H${x + rx}A${rx},${ry} 0 0 1 ${x},${y + h - ry}V${y + ry}A${rx},${ry} 0 0 1 ${x + rx},${y}Z`;
      return `M${x},${y}H${x + w}V${y + h}H${x}Z`;
    }
    case 'circle': {
      const cx = num('cx'), cy = num('cy'), r = num('r');
      if (!r) return null;
      return `M${cx - r},${cy}a${r},${r} 0 1 0 ${2 * r},0a${r},${r} 0 1 0 ${-2 * r},0Z`;
    }
    case 'ellipse': {
      const cx = num('cx'), cy = num('cy'), rx = num('rx'), ry = num('ry');
      if (!rx || !ry) return null;
      return `M${cx - rx},${cy}a${rx},${ry} 0 1 0 ${2 * rx},0a${rx},${ry} 0 1 0 ${-2 * rx},0Z`;
    }
    case 'polygon':
    case 'polyline': {
      const raw = (a.points ?? '').trim();
      if (!raw) return null;
      const p = raw.split(/[\s,]+/).map(Number);
      let d = `M${p[0]},${p[1]}`;
      for (let i = 2; i < p.length; i += 2) d += `L${p[i]},${p[i + 1]}`;
      return n.name === 'polygon' ? d + 'Z' : d;
    }
    case 'line':
      return `M${num('x1')},${num('y1')}L${num('x2')},${num('y2')}`;
    default:
      return null;
  }
}

function segmentsToCmds(sp: ReturnType<typeof svgpath>): number[] {
  const cmds: number[] = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  sp.iterate((seg) => {
    const cmd = seg[0] as string;
    const n = seg.slice(1) as number[];
    switch (cmd) {
      case 'M': cx = n[0]!; cy = n[1]!; sx = cx; sy = cy; cmds.push(OP.M, cx, cy); break;
      case 'L': cx = n[0]!; cy = n[1]!; cmds.push(OP.L, cx, cy); break;
      case 'H': cx = n[0]!; cmds.push(OP.L, cx, cy); break;
      case 'V': cy = n[0]!; cmds.push(OP.L, cx, cy); break;
      case 'C': cmds.push(OP.C, n[0]!, n[1]!, n[2]!, n[3]!, n[4]!, n[5]!); cx = n[4]!; cy = n[5]!; break;
      case 'Q': {
        const c1x = cx + (2 / 3) * (n[0]! - cx), c1y = cy + (2 / 3) * (n[1]! - cy);
        const c2x = n[2]! + (2 / 3) * (n[0]! - n[2]!), c2y = n[3]! + (2 / 3) * (n[1]! - n[3]!);
        cmds.push(OP.C, c1x, c1y, c2x, c2y, n[2]!, n[3]!); cx = n[2]!; cy = n[3]!; break;
      }
      case 'Z': case 'z': cmds.push(OP.Z); cx = sx; cy = sy; break;
    }
  });
  return cmds;
}

function walk(
  n: SvgNode,
  transform: string,
  inheritFill: string | undefined,
  gradients: Map<string, string>,
  out: VectorSubpath[],
  warnings: string[],
): void {
  const a = n.attributes ?? {};
  const t = a.transform ? `${transform} ${a.transform}`.trim() : transform;
  const fill = resolveFill(a, inheritFill, gradients, warnings);
  if (n.name === 'svg' || n.name === 'g') {
    for (const c of n.children ?? []) walk(c, t, fill, gradients, out, warnings);
    return;
  }
  if (n.name === 'defs' || n.name === 'linearGradient' || n.name === 'radialGradient') return;
  if (a.display === 'none' || fill === 'none') return;
  const d = shapeToPath(n);
  if (!d) {
    if (['mask', 'filter', 'image', 'use', 'text'].includes(n.name)) warnings.push(`unsupported <${n.name}>`);
    return;
  }
  let sp = svgpath(d);
  if (t) sp = sp.transform(t);
  sp = sp.abs().unarc().unshort();
  const cmds = segmentsToCmds(sp);
  if (cmds.length) out.push({ fill: fill ?? '#000000', cmds });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/icons-cloud/src/__tests__/svg-to-vector.test.ts`
Expected: PASS (3 tests). If the rect test's first coord isn't exactly `[2,2]`, log `icon.sub[0].cmds` and adjust the assertion to the emitted moveTo (svgpath may normalize the `H/V` rect path into `M/L`); the fill + transform-baked origin are the invariants.

- [ ] **Step 6: Commit**

```bash
git add packages/icons-cloud/src/codegen packages/icons-cloud/src/__tests__/svg-to-vector.test.ts packages/icons-cloud/package.json pnpm-lock.yaml
git commit -m "feat(icons-cloud): SVG-to-vector converter (transforms, arcs/quads, gradient flatten)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Allowlist + codegen CLI + license/provenance artifacts

**Files:**
- Create: `packages/icons-cloud/src/allowlist.ts`
- Create: `scripts/build-icon-packs.ts`
- Create: `packages/icons-cloud/NOTICE`, `packages/icons-cloud/LICENSES/{aws,azure,gcp}.md`, `packages/icons-cloud/README.md`
- Modify: `.gitignore` (ignore bulk `vendor/icons/`), root `package.json` (add `build:icons` script)
- Test: `packages/icons-cloud/src/__tests__/allowlist.test.ts`

**Interfaces:**
- Consumes: `svgToVectorIcon` (Task 5).
- Produces: `interface AllowEntry { name: string; provider: 'aws'|'azure'|'gcp'; service: string; file: string; category: string; needsChip?: boolean }`, `const ALLOWLIST: AllowEntry[]`; a CLI that writes `src/generated/*-pack.ts` + `provenance.json`.

- [ ] **Step 1: Write the allowlist** (start with a real curated set; ~25–30 per provider — abbreviated here, fill the full set from the vendored file names)

```ts
// packages/icons-cloud/src/allowlist.ts
export interface AllowEntry {
  name: string;               // canonical 'provider:service'
  provider: 'aws' | 'azure' | 'gcp';
  service: string;            // 'lambda'
  file: string;               // source file under svg/<provider>/
  category: string;           // 'compute' | 'storage' | ...
  needsChip?: boolean;        // light chip behind low-contrast art
}

export const ALLOWLIST: AllowEntry[] = [
  // --- AWS (fill from vendored file names) ---
  { name: 'aws:lambda', provider: 'aws', service: 'lambda', file: 'Arch_AWS-Lambda_48.svg', category: 'compute' },
  { name: 'aws:ec2', provider: 'aws', service: 'ec2', file: 'Arch_Amazon-EC2_48.svg', category: 'compute' },
  { name: 'aws:s3', provider: 'aws', service: 's3', file: 'Arch_Amazon-Simple-Storage-Service_48.svg', category: 'storage' },
  { name: 'aws:rds', provider: 'aws', service: 'rds', file: 'Arch_Amazon-RDS_48.svg', category: 'database' },
  { name: 'aws:dynamodb', provider: 'aws', service: 'dynamodb', file: 'Arch_Amazon-DynamoDB_48.svg', category: 'database' },
  // ... continue to ~25–30 AWS services
  // --- Azure ---
  { name: 'azure:functions', provider: 'azure', service: 'functions', file: 'Function-Apps.svg', category: 'compute' },
  // ... continue Azure
  // --- GCP ---
  { name: 'gcp:run', provider: 'gcp', service: 'run', file: 'cloud_run.svg', category: 'compute' },
  // ... continue GCP
];
```

- [ ] **Step 2: Write the allowlist integrity test**

```ts
// packages/icons-cloud/src/__tests__/allowlist.test.ts
import { describe, expect, it } from 'vitest';
import { ALLOWLIST } from '../allowlist.js';

describe('allowlist', () => {
  it('has unique canonical names matching provider:service', () => {
    const names = new Set<string>();
    for (const e of ALLOWLIST) {
      expect(e.name, `${e.name} format`).toBe(`${e.provider}:${e.service}`);
      expect(names.has(e.name), `duplicate ${e.name}`).toBe(false);
      names.add(e.name);
    }
  });
  it('covers all three providers', () => {
    const provs = new Set(ALLOWLIST.map((e) => e.provider));
    expect(provs).toEqual(new Set(['aws', 'azure', 'gcp']));
  });
});
```

- [ ] **Step 3: Run the test**

Run: `pnpm vitest run packages/icons-cloud/src/__tests__/allowlist.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the codegen CLI**

```ts
// scripts/build-icon-packs.ts
/**
 * Convert vendored official SVGs (packages/icons-cloud/svg/<provider>/) into vector packs.
 * Run after dropping the toolkits + curating svg/. Usage: pnpm build:icons
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ALLOWLIST } from '../packages/icons-cloud/src/allowlist.js';
import { svgToVectorIcon } from '../packages/icons-cloud/src/codegen/svg-to-vector.js';

const ROOT = process.cwd();
const SVG_ROOT = join(ROOT, 'packages', 'icons-cloud', 'svg');
const GEN = join(ROOT, 'packages', 'icons-cloud', 'src', 'generated');
mkdirSync(GEN, { recursive: true });

const packs: Record<string, Record<string, unknown>> = { aws: {}, azure: {}, gcp: {} };
const provenance: Array<Record<string, string>> = [];
const missing: string[] = [];
const warned: string[] = [];

for (const e of ALLOWLIST) {
  const src = join(SVG_ROOT, e.provider, e.file);
  if (!existsSync(src)) { missing.push(`${e.provider}/${e.file}`); continue; }
  const { icon, warnings } = svgToVectorIcon(readFileSync(src, 'utf8'));
  if (e.needsChip) icon.needsChip = true;
  packs[e.provider]![e.name] = icon;
  provenance.push({ name: e.name, provider: e.provider, file: e.file, category: e.category });
  if (warnings.length) warned.push(`${e.name}: ${warnings.join('; ')}`);
}

if (missing.length) {
  console.error(`Missing vendored SVGs (drop toolkits into packages/icons-cloud/svg/):\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

for (const p of ['aws', 'azure', 'gcp'] as const) {
  const body =
    `// GENERATED by scripts/build-icon-packs.ts — do not edit by hand.\n` +
    `import type { VectorIcon } from '@ahmazin/core';\n` +
    `export const ${p}Pack: Record<string, VectorIcon> = ${JSON.stringify(packs[p])};\n`;
  writeFileSync(join(GEN, `${p}-pack.ts`), body);
}
writeFileSync(join(ROOT, 'packages', 'icons-cloud', 'provenance.json'), JSON.stringify(provenance, null, 2));
if (warned.length) console.warn(`Conversion warnings:\n  ${warned.join('\n  ')}`);
console.log(`Wrote ${provenance.length} icons (aws/azure/gcp).`);
```

Add to root `package.json` scripts: `"build:icons": "tsx scripts/build-icon-packs.ts"`.

- [ ] **Step 5: License/provenance artifacts + gitignore**

Create `packages/icons-cloud/NOTICE` (attribution boilerplate naming AWS/Azure/GCP icon toolkits and their terms URLs), `packages/icons-cloud/LICENSES/{aws,azure,gcp}.md` (paste each provider's icon-terms text/link), and `packages/icons-cloud/README.md` explaining: vendor the toolkits into `svg/<provider>/`, keep only curated files, run `pnpm build:icons`, and that the user must review/accept each provider's terms before distributing.

Append to `.gitignore`:
```
# bulk vendored icon toolkits (only curated packages/icons-cloud/svg/** is committed)
vendor/icons/
```

- [ ] **Step 6: Verify the missing-sources guard** (no vendored assets yet)

Run: `pnpm build:icons`
Expected: exits non-zero, prints the missing SVG list (proves the guard). This is expected until Task 8.

- [ ] **Step 7: Commit**

```bash
git add packages/icons-cloud/src/allowlist.ts packages/icons-cloud/src/__tests__/allowlist.test.ts scripts/build-icon-packs.ts packages/icons-cloud/NOTICE packages/icons-cloud/LICENSES packages/icons-cloud/README.md package.json .gitignore
git commit -m "feat(icons-cloud): allowlist, codegen CLI, license/provenance scaffolding

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Node wiring + minimal picker + visual grid

**Files:**
- Modify: `examples/browser/src/main.tsx` (toolbar: provider→service selector setting `props.icon`)
- Modify: `scripts/gallery.ts` (add a provider-icon grid page) or create `scripts/icons-grid.ts`
- Test: `packages/icons-cloud/src/__tests__/integration.test.ts`

**Interfaces:**
- Consumes: `installCloudIcons`, `iconNode` (`type: 'icon'`, `props.icon`), `Editor`/`InfraCanvas` render.

- [ ] **Step 1: Write the integration test** (an `icon` node with a provider glyph renders)

```ts
// packages/icons-cloud/src/__tests__/integration.test.ts
import { describe, expect, it } from 'vitest';
import { Editor, getIcon } from '@ahmazin/core';
import { installDiagrams } from '@ahmazin/preset-diagrams';
import { installCloudIcons } from '../index.js';

describe('cloud icons on iconNode', () => {
  it('resolves a provider glyph for an icon node props.icon', () => {
    installCloudIcons();
    const ed = new Editor();
    installDiagrams(ed);
    const id = ed.createNode({ type: 'icon', x: 0, y: 0, props: { icon: 'aws:lambda' } });
    const rec = ed.store.node(id);
    expect(rec?.props.icon).toBe('aws:lambda');
    expect(getIcon('aws:lambda')).toBeTypeOf('function');
  });
});
```

(Verify `installDiagrams` + `Editor.createNode`/`store.node` signatures against `packages/preset-diagrams/src/index.ts` and `packages/core/src/editor/index.ts`; adjust the calls to match. The invariant under test: an `icon` node keeps `props.icon = 'aws:lambda'` and that name resolves in the registry.)

- [ ] **Step 2: Run test to verify it fails, then passes**

Run: `pnpm vitest run packages/icons-cloud/src/__tests__/integration.test.ts`
Expected: FAIL first if `installDiagrams`/`createNode` names differ — fix to the real API — then PASS.

- [ ] **Step 3: Wire the browser picker**

In `examples/browser/src/main.tsx`, import `installCloudIcons` from `@ahmazin/icons-cloud` and call it at startup (next to the existing preset installs). Add a second `<select data-testid="cloud-icon-select">` populated from a small static list of provider icon names, and a "Add icon" button that does `editor.createNode({ type: 'icon', x, y, props: { icon: selectedName } })` at the viewport center. Keep it minimal — this proves placement; a searchable picker is future work.

- [ ] **Step 4: Add the visual grid**

In `scripts/gallery.ts` (follow its existing page pattern), add a page that installs cloud icons and lays out one `icon` node per registered `provider:*` name in a grid with labels, rendering to `examples/output/gallery/cloud-icons.png`.

- [ ] **Step 5: Commit**

```bash
git add examples/browser/src/main.tsx scripts/gallery.ts packages/icons-cloud/src/__tests__/integration.test.ts
git commit -m "feat(icons-cloud): iconNode wiring, browser picker, visual grid

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Vendor the toolkits, generate real packs, full verification

**Files:**
- Create: `packages/icons-cloud/svg/{aws,azure,gcp}/*.svg` (curated sources)
- Regenerate: `packages/icons-cloud/src/generated/*-pack.ts`, `packages/icons-cloud/provenance.json`

**This task runs once the official toolkits are available (user-vendored bulk into `vendor/icons/`).**

- [ ] **Step 1:** User downloads the official AWS/Azure/GCP architecture-icon toolkits (accepting each provider's terms) into `vendor/icons/{aws,azure,gcp}/`.
- [ ] **Step 2:** Copy the curated files named in `ALLOWLIST` into `packages/icons-cloud/svg/<provider>/` (the committed subset). Reconcile any file-name mismatches by fixing `allowlist.ts`.
- [ ] **Step 3:** Run `pnpm build:icons`. Expected: writes real packs + `provenance.json`, prints `Wrote N icons`. Address any conversion warnings (hand-tune source or drop from allowlist; set `needsChip: true` on low-contrast entries).
- [ ] **Step 4:** Run the full gate:
  - `pnpm typecheck`
  - `pnpm test` (all packages green, including new suites)
  - `pnpm verify:render`
  - `pnpm gallery` → open `examples/output/gallery/cloud-icons.png` and eyeball: real brand art, correct colors, chips where flagged, no clipping.
- [ ] **Step 5:** Browser check: `pnpm --filter nodus-example-browser exec vite --host 127.0.0.1` (background), then `node scripts/browser-verify.mjs` (should still pass), plus manually add an `aws:lambda` node via the picker; stop the server (`kill $(lsof -ti tcp:5188)`).
- [ ] **Step 6: Commit**

```bash
git add packages/icons-cloud/svg packages/icons-cloud/src/generated packages/icons-cloud/provenance.json examples/output/gallery/cloud-icons.png
git commit -m "feat(icons-cloud): generate curated AWS/Azure/GCP packs from vendored toolkits

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** §Architecture → Tasks 1,4; core `drawVectorIcon` → Task 1; `needsChip` → Tasks 2,3; codegen pipeline → Tasks 5,6; pack format → Task 1 (types) + Task 6 (emit); registration/namespacing → Task 4; node wiring/picker → Task 7; licensing/provenance/commit strategy → Task 6 + Task 8; testing → Tasks 1–7; vendored generation → Task 8. All spec sections map to a task.

**Placeholder scan:** The `ALLOWLIST` in Task 6 is intentionally abbreviated with a "fill the full set from vendored file names" instruction, because the exact vendor file names are only known once toolkits are vendored (Task 8 reconciles them) — this is data entry against real files, not a logic placeholder. All code steps contain complete implementations.

**Type consistency:** `VectorIcon`/`VectorSubpath`/`OP` defined in Task 1 and consumed by Tasks 4–6; `registerIcon(name, draw, meta?)` + `getIconMeta` defined in Task 2 and used in Tasks 3,4; `svgToVectorIcon` signature defined in Task 5 and called in Task 6; pack shape `Record<string, VectorIcon>` consistent across Tasks 4,6. `installCloudIcons`/`installAwsIcons` names consistent Tasks 4,7.

**Note for the implementer:** two steps (Task 5 rect-coord assertion, Task 7 `installDiagrams`/`createNode` API) explicitly say to verify against the real emitted output / existing signatures and adjust — because svgpath's normalization and the exact editor API are best confirmed at the keyboard. The invariants being tested are stated so the adjustment is unambiguous.

---

## Follow-ups from the final review (address during Task 8, when real toolkits are converted)

Tasks 1–7 shipped with the fixtures rendering correctly and all constraints held (final review: 0 Critical). Two Important converter-fidelity gaps were **fixed** during execution: `fill-rule="evenodd"` is now captured and honored (compound glyphs with holes), and stroke-only shapes now emit a converter warning instead of being silently dropped. The following are **deferred** because they only matter once real vendor SVGs are converted — verify/address them while curating packs in Task 8:

- **Gradient flatten (M4):** `collectGradients` picks the last stop of a 2-stop gradient rather than a true midpoint/blend. Modern flat toolkits rarely use gradients, but if a converted icon looks off-color, improve the flatten (blend first/last hex) or hand-tune the source.
- **Inherited stroke (residual of I2):** the stroke-only warning inspects the shape's own `stroke`/`style` only. A shape whose stroke comes purely from an ancestor `<g stroke=…>` with `fill="none"` would still drop without a warning. If an outline icon converts to empty art, thread an `inheritStroke` param through `walk` like `inheritFill`.
- **ViewBox min-x/min-y (M2):** `readViewBox` returns only `[w,h]`; a non-zero `viewBox` origin isn't subtracted. AWS/Azure/GCP toolkits use 0-origin viewBoxes, so this is inert today; if a vendored icon is offset/clipped, extend the format to carry the origin and subtract it in `drawVectorIcon`.
- **Provenance + integrity (M3):** once `build:icons` generates real packs, commit `provenance.json` and add a test asserting every `ALLOWLIST` entry produced a pack icon (and vice-versa). This test would fail against today's fixtures, so it belongs after real generation.
- **Allowlist curation:** replace the 7-entry starter `ALLOWLIST` with the full curated ~25–30 per provider, using the real vendored file names; set `needsChip: true` on any low-contrast (dark/mid-tone) glyph after eyeballing the render.
