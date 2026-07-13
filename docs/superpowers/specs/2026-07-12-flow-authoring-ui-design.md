# Flow Authoring UI — Design Spec

**Date:** 2026-07-12
**Status:** Approved (design), pending implementation plan
**Sub-project:** ② of the "configurable live flow" initiative (the last piece)

## Context

Sub-projects ① (engine config) and ③ (live data sources) shipped. Flow is fully driveable by
code (`editor.setFlow`, `setFlowConfig`, `bindFlowSource`) but has **no end-user UI** — you can't
turn flow on or author a data-driven scale by clicking. This sub-project adds that UI.

The React package already has a `Properties` panel (`packages/react/src/properties.tsx`) that
appears on selection and batches gestures into one undo (`editor.setStyle(ids, o, {capture:'later'})`
+ `editor.mark()` on release/blur), and a flat context-menu builder
(`packages/react/src/context-menu.tsx`, `contextMenuItems(editor, target)`). We extend both.

## Scope

Per-edge flow authoring across two surfaces, at an **elevated** polish bar. Covers the full
`FlowSpec` and data-driven `FlowScale` authoring. React-only (`@nodus/react`) — no core changes
(the core API from ①/③ is sufficient). No source-binding UI (sources are wired in code; out of scope).

## Decisions (locked during brainstorming)

- **Surfaces:** both — context-menu quick-toggles AND a Properties-panel flow section.
- **MVP scope:** full `FlowSpec` + `FlowScale` authoring.
- **Scale UI:** a collapsible "Advanced / data-driven" disclosure holds the scale editor; basic
  FlowSpec controls are always visible.
- **Polish:** elevated / designed (frontend-design), staying cohesive with the embedded dark
  monospace panel.

## Design tokens

Inherit the panel's palette; add ONE flow accent. Reuse `ui-monospace` (cohesion with the
infra/terminal subject); elevate via a disciplined scale and uppercase micro-labels.

```
--bg        #0d1310   --border    #28322c   --text     #cdd5d0
--muted     #8b958f   --label     #556058   --field-bg #12161c
--flow      #2dd4bf   (teal — "live signal"; the flow section's accent: active states, ramp handle,
                       the enabled preview)
threshold defaults: #22c55e (green) / #f59e0b (amber) / #ef4444 (red)
```

## Signature — "the editor shows you the flow"

The one memorable, subject-true element (not decoration):

- **Basic mode — live preview strip.** A ~180×24 track at the top of the flow section renders
  actual moving packets reflecting the current spec: `dots` = moving dots, `dash` = marching
  dashes; `speed` → animation duration, `reverse` → direction, `color`/`size` applied. Pure
  CSS animation. **`prefers-reduced-motion` → a static rendering** (evenly spaced dots / a dashed
  line, no motion).
- **Data-driven mode — color-stop ramp.** The strip becomes a horizontal ramp across the domain:
  a CSS gradient (when `gradient`) or stepped bands (thresholds) built from the stops; each stop is
  a draggable handle (position = `at` normalized over the domain) with numeric `at` + color-picker
  fallbacks for accessibility. Below it, a **metric scrubber** (range over the domain) that, while
  dragged, calls `editor.setFlowMetric(id, value)` so the *real* selected edge updates live —
  you drag the metric and watch the actual edge's flow respond.

`buildRampCss(stops, domain, gradient)` (a pure helper → a `background` CSS string) is the one
unit-testable piece.

## Surface A — context menu (quick toggles)

In `contextMenuItems`, the `target.kind === 'edge'` branch gains a small flow group (flat items,
matching the existing style; the panel is the rich editor):

- `Flow: on` / `Flow: off` — toggles based on the edge's current `flow` (`setFlow([id], DEFAULT_FLOW)` /
  `setFlow([id], null)`).
- `Flow: dots` / `Flow: dash` — sets `style` (only shown when flow is on).
- `Flow: reverse` — toggles `reverse` (only shown when flow is on).

`DEFAULT_FLOW: FlowSpec = { style: 'dots', speed: 70, size: 3 }` (count derives from length).

## Surface B — Properties panel flow section

A new focused component `packages/react/src/flow-controls.tsx` exporting `<FlowControls editor ids>`,
rendered by `Properties` when the selection includes at least one edge (below the Style section).
It reads the **first selected edge's** `flow` for display and writes to **all selected edges**.

Writes mirror the style panel's undo batching: `setFlowField(patch)` reads the first edge's current
flow, merges `patch`, and calls `editor.setFlow(ids, merged, { capture: 'later' })`; `commit()` =
`editor.mark()` on pointer-up / blur / change-commit. Toggling a discrete control commits immediately.

Layout:

```
FLOW · N edge(s)
  [ live preview strip ]              ← signature (basic) / ramp (data-driven)
  Animate      [✓]                    on: setFlow(DEFAULT_FLOW) · off: setFlow(null)
  ── when Animate on ──
  Style        [dots ▾]
  Speed        [────●──]  slider 10–200
  Size         [──●────]  slider 1–12
  Count        [──●────]  slider 1–30   (dots only; hidden for dash)
  Reverse      [ ]
  Color        [🎨]  + "reset" (clears flow.color → falls back to edge stroke)
  ▸ Advanced / data-driven            disclosure (chevron rotates; animated height)
  ── when expanded ──
    Data-driven [✓]                   on: scale = DEFAULT_SCALE · off: delete flow.scale
    ── when Data-driven on ──
    Domain      [min] [max]
    Speed range [✓] [lo] [hi]         each range: enable + lo/hi (unchecked → field undefined)
    Count range [ ] [lo] [hi]
    Size range  [ ] [lo] [hi]
    Gradient    [ ]                   stepped bands ↔ blended
    Color stops                        ← the ramp handles + this list stay in sync
      ● at [__] [🎨] ✕
      ● at [__] [🎨] ✕
      [+ Add stop]
    Metric      [────●────]            scrubber → setFlowMetric(ids, value); live edge updates
```

`DEFAULT_SCALE: FlowScale = { domain: [0, 100], colors: [ {at:0,color:'#22c55e'}, {at:60,color:'#f59e0b'}, {at:85,color:'#ef4444'} ] }`.

Behavior details:
- **Empty/none:** when no edge is selected, `FlowControls` renders nothing (panel already hides when
  nothing is selected). When only nodes are selected, the flow section is absent (flow is edge-only).
- **Count** row hidden when `style === 'dash'` (count is a dots concept).
- **Color reset** clears `flow.color` so the marker falls back to the resolved edge stroke.
- **Stops** kept sorted by `at` for display; editing `at` re-sorts; a stop's `at` clamps to the domain.
- **Multi-select** shows the first edge's values and applies every change to all selected edges.
- **A11y/quality floor:** every control keyboard-operable with visible focus; the ramp handles have
  numeric `at`/color fallbacks; motion (preview + disclosure) respects `prefers-reduced-motion`.

## File structure

- `packages/react/src/flow-controls.tsx` — `<FlowControls editor ids>`: preview strip, basic
  controls, the advanced disclosure, and the scale editor (ramp + stops + scrubber). If this grows
  past ~250 lines, split the scale editor into `flow-scale-editor.tsx`.
- `packages/react/src/properties.tsx` — render `<FlowControls>` when the selection includes an edge.
- `packages/react/src/context-menu.tsx` — the flow quick-toggle items + `DEFAULT_FLOW`.
- `packages/react/src/index.tsx` — export `FlowControls` (and `DEFAULT_FLOW`) from the barrel if useful.

## API wiring (no core changes)

- Read: `(editor.store.peek(id) as EdgeRecord).flow`.
- Write spec: `editor.setFlow(ids, merged, { capture: 'later' })` then `editor.mark()` on commit.
- Live metric preview: `editor.setFlowMetric(id, value)` per selected id (ephemeral).
- Selection reactivity: reuse the panel's `useValue(() => { editor.sceneIndex.version.get();
  return [...editor.selectedAtom.get()].join(','); })` so edits and selection changes re-render live.

## Testing / verification

- **Unit (react, headless):** `buildRampCss(stops, domain, gradient)` — pure; assert the gradient
  string for stepped vs blended and correct stop ordering/positions. `DEFAULT_FLOW`/`DEFAULT_SCALE`
  shape. (These are the only pure pieces; the rest is DOM/interaction.)
- **Browser E2E** (headless Chromium against the example, driving real DOM):
  - select an edge → the flow section appears; toggle **Animate** → the edge record gains/loses
    `flow` (assert via `window.__editor`).
  - change Style/Speed/Reverse/Color → assert the edge's `flow` fields update; undo reverts the
    whole gesture in one step.
  - expand Advanced → toggle **Data-driven** → `flow.scale` set; edit domain / add + edit a color
    stop / toggle gradient → assert `flow.scale` updates.
  - drag the **Metric** scrubber → `editor.flowMetric(id)` reflects it.
  - context-menu `Flow: on/off/dots/dash/reverse` → assert the edge record.
  - no console errors; keyboard-focusable controls; `prefers-reduced-motion` emulation → preview
    static.

## Task breakdown (subagent-built)

1. `FlowControls` scaffold + basic FlowSpec controls (animate/style/speed/size/count/reverse/color)
   + wiring into `Properties` + the **live preview strip** (signature, basic mode).
2. Advanced disclosure + scale editor: data-driven toggle, domain, three ranges, gradient, the
   **color-stop ramp** (add/remove/edit stops, `buildRampCss`) + the **metric scrubber**.
3. Context-menu flow quick-toggles + `DEFAULT_FLOW`.
4. Browser E2E verification (all the checks above), plus the `buildRampCss` unit test.

## Out of scope

- Source-binding UI (bind `FlowSource` from the panel) — sources are wired in code (③).
- Surfacing ①'s global `FlowRuntimeConfig` (pause-all/speed/reduced-motion) in a toolbar — a
  separate, later addition.
- Persisting UI state (open/closed disclosure) across sessions.

## Alternatives considered

- **Context-menu submenu only** (no panel) — rejected: too cramped for scale authoring; the user
  chose both surfaces.
- **A brand-new visual language for the flow editor** — rejected: it would fight the embedded dark
  monospace chrome; distinctiveness comes from the preview/ramp signature, not new chrome.
- **Numbers-only scale editor** (no ramp) — rejected: the ramp is the elevated, subject-true element
  and makes thresholds legible at a glance.

## Notes

- Repo default branch `mainline`; work on `flow-authoring-ui`.
- `Properties` is rendered in the example at top-right and `<Nodus>` hosts the context menu, so the
  new UI surfaces automatically for browser verification.
