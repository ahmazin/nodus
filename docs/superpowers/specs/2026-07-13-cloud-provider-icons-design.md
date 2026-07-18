# Cloud provider icon packs (AWS / Azure / GCP) — design

- **Date:** 2026-07-13
- **Status:** Approved (design) — pending spec review, then implementation plan
- **Depends on:** the symbol-forward "stencil" node rendering (`drawStencil`, `core/src/renderer/stencil.ts`) and the icon registry (`core/src/icons/index.ts`).

## Context

Infra/cloud objects now render symbol-forward (a large glyph on an accent tile with the label below). The current glyph set is 14 hand-drawn, provider-neutral procedural icons. To make diagrams read as authentic cloud architecture — matching what users expect from draw.io / Cloudcraft — we want the **official branded AWS, Azure, and GCP service icons** available as node glyphs.

The engine's defining invariant is that **all rendering is procedural and produces an identical result in the browser and headless (`@napi-rs/canvas`/Skia)** through the structural `Ctx2D` interface — there are currently zero image assets or `Path2D`/`drawImage` usages anywhere. Any icon system must preserve that invariant.

Confirmed feasibility: `@napi-rs/canvas` (v0.1.100) exposes `Path2D`, `Image`, and `loadImage`, and both the browser and Skia support the same 2D path primitives — so real vendor SVGs can be converted to path commands and replayed through the existing `Ctx2D` in both environments.

## Decisions (locked)

1. **Fidelity:** official branded vendor icons (not in-house recreations).
2. **Scope (slice 1):** all three providers, ~25–30 curated common services each (~75–90 icons total).
3. **Asset source:** the user vendors the official toolkits into `vendor/icons/{aws,azure,gcp}/`; the build converts only a curated allowlist.
4. **Rendering:** Approach A — build-time SVG → path-command **vector packs**, replayed through the existing `Ctx2D`. No engine `Ctx2D` changes, no runtime assets, no async, crisp at any zoom, tree-shakeable. Gradients flatten to a representative solid; the converter reports anything it cannot faithfully convert.
5. **Tile contrast (§6a):** keep the neon-dark stencil tile; each pack entry may declare a `needsChip` flag so low-contrast icons get a light rounded chip behind the glyph. No global light-tile switch.
6. **Commit strategy (§7a):** commit the curated ~75–90 **source SVGs actually used** (self-contained, reproducible, reviewable) plus the generated packs, `provenance.json`, `NOTICE`, and per-provider `LICENSES/`. The user must accept each provider's terms before publishing; this spec flags licensing but does not adjudicate it.

## Goals / non-goals

**Goals:** a repeatable pipeline that turns vendored official SVGs into compact vector packs; register them under namespaced names (`aws:lambda`, `azure:functions`, `gcp:run`); render them faithfully (own colors) as stencil node glyphs in browser and headless; a minimal way to place them; license/provenance hygiene.

**Non-goals (future specs):** full-toolkit coverage; a searchable icon-picker UI; provider category-color theming of tiles; auto-layout hints per service; animated/edge glyphs.

## Architecture

```
vendor/icons/{aws,azure,gcp}/*.svg        # user-vendored official toolkits (gitignored bulk)
packages/icons-cloud/svg/{aws,azure,gcp}/ # curated source SVGs we actually convert (committed, §7a)
        │  scripts/build-icon-packs.mjs  (dev-only codegen; reads allowlist.ts)
        ▼
packages/icons-cloud/src/generated/{aws,azure,gcp}-pack.ts   # committed vector data
packages/icons-cloud/provenance.json                          # committed: version+source+license per icon
        │  installAwsIcons()/installAzureIcons()/installGcpIcons()  (or installCloudIcons())
        │    → core registerIcon('aws:lambda', <IconDraw wrapping drawVectorIcon>)
        ▼
core icon registry ──► drawStencil / iconNode draw it UNCHANGED (props.icon = 'aws:lambda')
```

### New package `@nodus/icons-cloud`
Keeps bulky icon data out of `core`. Subpath exports per provider (`@nodus/icons-cloud/aws|azure|gcp`) for tree-shaking; importing/installing a provider registers its pack into core's existing registry. Contains: `allowlist.ts`, `svg/` (curated sources), `src/generated/*-pack.ts`, `src/install.ts`, `provenance.json`, `NOTICE`, `LICENSES/`.

### One core addition
`packages/core/src/icons/vector.ts` — `drawVectorIcon(ctx, icon, box)`, exported from the barrel. Generic, data-driven replay of a `VectorIcon` through existing `Ctx2D` primitives. Mirrors how `drawIcon` already lives in core. **No `Ctx2D` interface change.**

## Build-time codegen (`scripts/build-icon-packs.mjs`)

Dev-only Node script. For each allowlist entry:
1. Read the source SVG from `packages/icons-cloud/svg/<provider>/<file>.svg`.
2. Parse (dev deps, e.g. `svgson` + `svgpath`): resolve `<g transform>` by baking transforms into coordinates; support `<path>`, `<rect>`, `<circle>`, `<ellipse>`, `<polygon>`, `<polyline>`, `<line>`; absolutize path data; convert arcs **and quadratic segments** to cubic béziers so the runtime replayer only needs `M/L/C/Z`.
3. Extract per-shape `fill` (attribute or inline style); flatten `linearGradient`/`radialGradient` references to a representative solid (e.g. mid-stop).
4. Normalize coordinates to the SVG `viewBox`.
5. Emit a compact numeric command stream per subpath.
6. **Report** (fail-soft, listed in build output) any icon using masks, filters, embedded rasters, or gradients that don't flatten cleanly — so we hand-tune the source or drop it from the allowlist.
7. Write `src/generated/<provider>-pack.ts` and update `provenance.json`.

`allowlist.ts` shape: `{ name, provider, service, file, category, needsChip? }` per icon — the single source of truth for what's converted and how it's named/presented.

## Pack data format + runtime replay

```ts
// generated data
export interface VectorSubpath { fill: string; cmds: number[]; } // opcodes: 0=M,1=L,2=C,3=Z (arcs & quadratics pre-baked to cubic)
export interface VectorIcon { vb: [number, number]; sub: VectorSubpath[]; needsChip?: boolean; }
export type IconPack = Record<string, VectorIcon>;
```

`drawVectorIcon(ctx, icon, box)`:
- Uniform-scale `vb → box` (preserve aspect, center), translate.
- For each subpath: set `fillStyle = subpath.fill` (the icon's **own** baked color — theme accent is ignored for provider icons), replay opcodes via `beginPath/moveTo/lineTo/bezierCurveTo/closePath`, `fill()`.
- Save/restore-wrapped so no state leaks (consistent with `DrawApi`).

Registration wraps each icon into an `IconDraw` closure:
```ts
registerIcon('aws:lambda', (ctx, x, y, s, _color, _fill) =>
  drawVectorIcon(ctx, awsPack.lambda, { x, y, w: s, h: s }));
```
The `color`/`fill` args are ignored for provider icons (they render their own palette). The stencil tile still uses the type accent for its border/glow.

## Node wiring / UX (slice 1, minimal)

- The diagrams `iconNode` already renders `props.icon` → setting `props.icon: 'aws:lambda'` renders the provider glyph with **zero new node types**.
- `drawStencil` reads the `needsChip` flag on the resolved icon; when set, it paints a light rounded chip behind the glyph before `drawVectorIcon` for contrast. (Small extension to `drawStencil`/its icon lookup.)
- Add a minimal picker to the browser example toolbar (and optionally a ⌘K command): choose provider → service, which sets `props.icon`. This proves end-to-end placement.

## Rendering / tile treatment (§6a)

Keep the existing neon-dark tile (accent border + glow). Provider glyphs render their own colors centered on the tile. Icons flagged `needsChip` in the allowlist get a light rounded chip behind the glyph so mid/dark brand colors stay legible on dark. No global light-tile mode. Exact chip inset/radius tuned by eyeballing real renders (same loop we used for the procedural glyphs).

## Licensing & reproducibility (§7a)

- Commit the curated source SVGs under `packages/icons-cloud/svg/<provider>/` (only the ~75–90 used), the generated packs, and `provenance.json` (toolkit name+version, source path, and license per icon).
- Add `packages/icons-cloud/NOTICE` and `LICENSES/{aws,azure,gcp}.md` with each provider's terms + attribution text.
- Bulk `vendor/icons/` is gitignored; only the curated subset is committed.
- README states the user must review/accept each provider's icon terms before publishing/distributing. This spec **flags** licensing; it does not provide legal advice.

## Testing & verification

- **Unit — renderer:** `drawVectorIcon` on a hand-built 2-subpath `VectorIcon` into a stub `Ctx2D`: asserts viewBox→box scaling, one `fill` per subpath with the right `fillStyle`, correct opcode replay.
- **Unit — converter:** the SVG→cmds function on a small fixture SVG (path + rect + transformed group): asserts absolutized/transform-baked output and fill extraction.
- **Pack integrity:** every allowlist entry produced a valid icon (`vb` + ≥1 subpath); names correctly namespaced; no duplicate names; `provenance.json` covers every generated icon.
- **Registration sweep:** after `installCloudIcons()`, `getIcon('aws:lambda')` etc. return functions and render into a stub ctx without throwing (mirrors the existing glyph sweep in `stencil.test.ts`).
- **Visual:** a napi render script draws a labeled grid of every provider icon on stencil tiles (light-chip variants included) → eyeball PNG; wire into `pnpm gallery`/`demos`.
- Full gate: `pnpm typecheck && pnpm test && pnpm verify:render`, plus the visual grid.

## Slice-1 boundary

**In:** `@nodus/icons-cloud` package; `core` `drawVectorIcon`; codegen script + allowlist; 3 curated packs (~25–30 each); registration/namespacing; `needsChip` chip in `drawStencil`; `props.icon` wiring + minimal toolbar selector; unit/integrity/visual tests; NOTICE/LICENSES/provenance.

**Out (later):** full-toolkit coverage; searchable icon-picker UI; provider category-color tile theming; per-service layout hints.

## Risks / notes

- **Vendor availability:** the pipeline is blocked until the official toolkits are vendored into `vendor/icons/`. The codegen must fail with a clear message listing missing sources.
- **Gradient/complex-art loss:** modern official service icons are overwhelmingly flat vector, so the curated set converts with high fidelity; the converter's report surfaces exceptions for manual handling.
- **Naming drift across toolkits:** AWS/Azure/GCP use different taxonomies; the `allowlist.ts` fixes our canonical `provider:service` names independent of vendor file names.
- **Contrast on dark:** handled per-icon via `needsChip`; revisit after the first visual render.

## Files (created / changed)

| Area | Path | Action |
|---|---|---|
| Core renderer | `packages/core/src/icons/vector.ts` (+ barrel export) | new `drawVectorIcon` + `VectorIcon` types |
| Stencil chip | `packages/core/src/renderer/stencil.ts` | honor `needsChip` (light chip behind glyph) |
| New package | `packages/icons-cloud/` (`package.json`, `allowlist.ts`, `svg/`, `src/generated/`, `src/install.ts`, `provenance.json`, `NOTICE`, `LICENSES/`) | new |
| Codegen | `scripts/build-icon-packs.mjs` | new dev-only converter |
| Wiring | browser example toolbar (+ optional ⌘K command) | minimal provider→service selector |
| Tests | `packages/core/src/__tests__/vector.test.ts`, `packages/icons-cloud/src/__tests__/packs.test.ts` | new |
| Visual | `scripts/gallery.ts` or `scripts/demos.ts` | provider-icon grid |
| Ignore | `.gitignore` | ignore bulk `vendor/icons/` |
