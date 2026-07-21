# Canvas "Signature" Overhaul — Design

**Date:** 2026-07-21
**Status:** Approved (design) — pending implementation plan
**Scope:** A large visual + interaction overhaul of the Nodus canvas, delivered as one program across four
mostly-independent subsystems on two shared foundations ("keystones").

## Locked decisions

- **Intensity: Balanced** — "landing-page hero." Clear depth and glow that reads instantly but stays
  professional (not arcade). Concrete parameter set is in [Appendix A](#appendix-a--balanced-parameter-set).
- **Theme application: Dark full / Light calm** — the dark theme gets the full aesthetic; the light theme
  keeps glass, gradients, and depth but drops neon bloom and the ambient radial washes to near-zero (they
  read as muddy haze on a light canvas). This repo ships both themes (locked GA scope), so the aesthetic is
  never theme-blind.

## What already exists (out of scope — do NOT rebuild)

A prior audit established that ~a third of the original wishlist is already shipped. These are explicitly
**not** part of this program:

| Already DONE | Evidence |
| --- | --- |
| Glowing flow packets along edges | `paintFlowMarkers` dots + `shadowBlur` — `renderer/paint.ts` |
| Functional drag-from-port to connect | `SelectTool` porting state — `tools/index.ts` |
| Node + canvas right-click menus (duplicate/front/back/lock/delete; fit/select-all) | `react/context-menu.tsx` |
| Snap-to-grid + live alignment guides while dragging | `computeSnap` + `snapGuidesAtom` — `editor/index.ts` |
| `?` shortcuts cheatsheet (opens `?`, closes Esc) | `ShortcutsDialog` — `main.tsx` |
| Per-node category glow | `byTypeSlices` `glow:accent` — `preset-infra/theme.ts` |
| Reduced-motion, `:focus-visible` rings, ⌘D duplicate | `global-styles.ts`, `tools/index.ts` |

**Partial features finished by this program (not rebuilt):** selection halo/pulse/marching-ants (had a
static stroke only), hover node-lift + edge highlight (had port dots only), status bar (had counts only),
toast icons (text only), button press-scale (had color transitions only).

## Two keystones (shared foundations, built first)

### K1 · Paint-material primitive
**Owns:** `packages/core/src/renderer/draw-api.ts`, `context.ts`, `svg-context.ts` (+ their tests).

Extend `FillOpts`/`StrokeOpts` with two new, **backward-compatible** capabilities; today's symmetric
`glow`/`glowBlur` stays intact:

- `gradient?: { stops: { at: number; color: string }[]; angle?: number }` — the DrawApi builds a
  `createLinearGradient` across the shape's bounding box (default angle = vertical, top→bottom).
- `shadow?: { color: string; blur: number; dx?: number; dy?: number }` — an *offset* drop shadow, distinct
  from the symmetric `glow`, for real lit-from-above depth.

**Cross-context parity is the reason this is a keystone.** The same draw code paints to DOM canvas, Skia
(`@napi-rs/canvas`), and the SVG export context:

- DOM + Skia: gradients and offset shadows are native — pass through.
- SVG (`svg-context.ts`): must emit `<linearGradient>` defs for gradients. If any context cannot honor a
  gradient it degrades to the flat mid-stop color. **Glow/shadow blur is omitted in SVG export** (keeps
  exports crisp and small) — an accepted, deliberate limitation.

**Invariant:** material specs live in *theme tokens* (themes are data, layered by `resolveTokens`), never in
records — so the document, undo, `canonical.test.ts`, and diff-CI are untouched.

### K2 · Animation clock + ephemeral presentation layer
**Owns:** `packages/core/src/editor/` (a new `animation`/clock module + editor wiring), `react/nodus-host.tsx`
(one-line continuous-paint gate change).

A generic `editor.animate(spec)` tween/spring registry plus an `isAnimating()` gate — the structural twin of
the existing `isFlowAnimating()`. The host loop's continuous-paint condition becomes
`isFlowAnimating() || isAnimating()`.

Two design rules:

1. **Reduced-motion snaps tweens to their final value immediately** (reuse `reducedMotionAtom`): apply `to`,
   fire `onDone`, never tick. Correct a11y with zero new atoms.
2. **A new ephemeral presentation layer** — a map `id → { alpha, scale, dx, dy }`, never serialized, never in
   undo — is what the clock writes and `paintItem` reads. This is the seam that animates *visuals* while the
   store stays truthful. (Mirrors how flow metrics are already ephemeral.)

Clock time is fed by the host's existing paint timestamp (`editor.render(..., now)`); the headless core never
calls `performance.now()` itself.

## Subsystem 1 · Render materials (needs K1)
**Owns:** `packages/core/src/renderer/paint.ts` + `stencil.ts`, `packages/preset-infra/src/theme.ts` (+ any
new material token fields), new headless sample scene(s) for `verify:render`.

- **Glassy nodes** — vertical gradient fill (±14% lightness) + offset drop shadow (0/4px, blur 16, 30% alpha)
  + 1px inner top rim-light (18% white). Via K1, applied to `drawStencil`.
- **Edge gradients** — source→target, resolved at paint time from the endpoint nodes' resolved colors. Not
  serialized.
- **Neon flow-on edge restyle** — while flow is on, the edge itself gains +40% width + bloom (blur 12–16).
  Off when flow is off (base edge unchanged).
- **Depth-faded grid** — `drawGrid` gains accent major gridlines (every N cells) layered over the fine dots,
  plus a radial edge-fade mask so the grid fades toward the viewport edges.
- **Ambient background** — `fillBackground` gains accent + cool-blue radial washes and a soft inner vignette
  (~12% dark). Near-zero in light mode.
- **Static selection halo** — an accent glow ring around the selected node (the *animated* pulse is in
  Subsystem 2).
- **Depth-of-field LOD** — below ~50% zoom (`cam.z` threshold), `drawStencil` drops the sub-label and icon
  detail to declutter.

Verifies cleanly via headless PNG (`pnpm verify:render`).

## Subsystem 2 · Motion & feel (needs K2)
**Owns:** `packages/core/src/editor/` (motion behaviors on the clock), `packages/react/src/nodus-host.tsx`
(pointer-velocity capture for momentum, grab/release hooks).

- **Spring drag + grab-lift** — the committed position stays **exact** (snapping/undo stay truthful); the
  lift/scale is presentation-only (`scale 1→1.03` + shadow bump on grab, spring back on release).
- **Momentum pan** — the host tracks pointer velocity during pan; on release the clock decays the camera
  under exponential friction until below threshold. Disabled under reduced-motion.
- **Entrance animation** — fade + scale on create/import, with a **staggered cascade** on bulk load/import
  (each node's entrance tween offset by index).
- **Layout tween** — `editor.layout()` applies final positions to the store in one change (truthful
  immediately), then tweens the *visual* offset old→new to zero over ~400ms. No flurry of store writes.
- **Animated pulse halo + marching-ant dashes** — clock-driven modulation in the existing `paintInteractive`
  (halo alpha sine pulse; selection dash offset marches).
- **Parallax** — the ambient washes offset by camera pan × a small factor (camera-linked; repaints already
  happen on camera change).
- **Idle shimmer** — a very subtle animated grid/scanline shimmer when idle.

**Idle shimmer is the only "always ticking" cost** (it defeats the engine's paint-once-and-stop
efficiency): fps-capped (reuse `flowConfig().maxFps`), visibility-gated, reduced-motion-gated, and
**toggleable**. It is the only feature the user may veto for battery reasons; everything else is
event-driven.

## Subsystem 3 · Chrome & polish (react/example CSS — no core changes, fully independent)
**Owns:** `examples/browser/src/main.tsx`, `packages/react/src/minimap.tsx`, zoom controls,
`packages/react/src/ui/tokens.ts`, `ui/global-styles.ts`, `packages/react/src/toast.ts`, and new
status-bar + empty-state components.

- **Frosted glass** on top bar / left rail / right panel / zoom bar / minimap — `backdrop-filter: blur` +
  translucent surface + hairline border, with a solid fallback where `backdrop-filter` is unsupported.
- **Button press-scale** — `:active { transform: scale(0.97) }`, reduced-motion aware.
- **Toast icons** — per-action icon in `showToast` (e.g. a check for success), tone-colored.
- **Status bar** — a slim bottom bar: active tool · live cursor world-coords · selection info · zoom,
  reading editor atoms (a minimal throttled pointer/cursor atom is added for coords).
- **Empty-state onboarding card** — shown when the document has zero nodes, dismissible and
  localStorage-remembered, with quick actions.

## Subsystem 4 · Signature semantics (preset + react + a little core paint)
**Owns:** `packages/preset-infra/src/` (a pure `classifyIcon` util + node draw glyph fallback), a small
addition to `renderer/paint.ts` for the spotlight muting + flow-rate readout, `react` wiring.

- **Spotlight / focus** — on selection, compute the connected subgraph (selected nodes + their edges +
  neighbor nodes). Non-subgraph items resolve through a "muted" overlay (lower saturation + opacity) reusing
  the theme's *existing* overlay/focus token layer (`base < byType < states < overlays < focus`). Packets and
  flow-rate labels collapse to the focused edges only.
- **Live flow-rate readout** — a small numeric pill at the edge midpoint when flow is on, derived from the
  existing flow metric / `FlowScale`. Collapses with spotlight.
- **Label→cloud-icon classification** — a pure `classifyIcon(label): iconId | undefined` keyword heuristic
  (lambda/function→bolt, gateway/route→route, client/browser→monitor, queue/kafka/sqs→layers,
  db/postgres/data→cylinder, bucket/s3→storage, …). Used **only as a draw-time glyph fallback**
  (`node.props.icon ?? classify(label) ?? KIND_ICON[kind]`), never written to the record — so it cannot fight
  user choice or serialization.

## Build order

```
K1 ─┐                 K2 ─┐
    ├─► Subsystem 1        ├─► Subsystem 2
    └─► Subsystem 4        Subsystem 3 (independent, anytime)
```

K1 and K2 are independent of each other (parallelizable). Subsystem 3 is independent of the keystones.
Subsystems 1 and 4 need K1; Subsystem 2 needs K2.

## Verification

- `pnpm typecheck` — always (the static gate; `tsc --strict` + `noUncheckedIndexedAccess`).
- `pnpm test` — for logic-testable parts: tween/spring/momentum math, tween lifecycle incl. reduced-motion
  snap, `classifyIcon` keyword mapping, edge-gradient color resolution, SVG-gradient canonical output.
- `pnpm verify:render` — new headless sample scenes → PNGs for glassy node, neon flow edge, depth grid,
  ambient background, selection halo, spotlight.
- Browser drive (`chrome-devtools` / `playwright-core` against the running Vite app, zero console errors) —
  entrance cascade on load, drag lift, momentum pan, hover lift, pulse halo, frosted chrome, status-bar
  coords, empty-state, toast icons.
- **User visual sign-off** on the PNGs for the material/aesthetic work.

## Invariants (non-negotiable)

1. **Nothing new enters the document or undo.** All new visual state is theme-data or ephemeral presentation
   — canonical serialization and diff-CI stay green (`canonical.test.ts`).
2. **Full Ctx2D parity** (DOM + Skia + SVG export) for every material introduced by K1.
3. **Reduced-motion** disables clock ticking, momentum, shimmer, and pulse (reuse `reducedMotionAtom`).
4. **Light mode is calm** — drops washes/bloom per the locked decision.
5. **No core `switch`-on-type**; new behavior stays in registries/tokens/util draw, and mutations route
   through `store.apply`/editor helpers.

## Deliberate non-goals (flagged; overridable)

- Committed drag positions are kept **exact** rather than spring-interpolated — springing the real position
  would break snap-truthfulness and undo. The springy *feel* is presentation-only.
- SVG export **omits glow/shadow blur** — keeps exports crisp and small. Gradients are emitted as defs.
- No radial/pie context menu (the existing linear menus already cover the actions).

## Execution

Default is incremental: one subsystem at a time, fully verified before the next. Because the subsystems are
file-isolated (see each `Owns:`), parallel agent lanes are viable; solo-vs-parallel is settled when the
implementation plan is written, not here. If parallel lanes are used, the Agent Team Protocol in `CLAUDE.md`
governs (one writer per file, contract-first, lead-only git writes, a `team/<topic>` branch off a recorded
baseline).

## Appendix A — Balanced parameter set

```
Node gradient   : ±14% lightness, top→bottom
Node shadow     : offset 0/4px, blur 16, 30% alpha
Rim-light       : 1px inner top highlight, 18% white
Flow-on edge    : +40% width + bloom blur 12–16
Edge gradient   : source color → target color
Grid            : dots + accent major lines, edge-fade mask
Ambient         : accent + cool-blue radial washes, soft inner vignette (~12% dark)
Selection halo  : accent glow, gentle pulse
Idle shimmer    : very subtle, on (dark only; toggleable)
```

Light mode: gradients + glass + depth retained; ambient washes and neon bloom → near-zero.
