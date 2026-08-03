# Nodus GA — Design Spec

**Date:** 2026-07-18
**Status:** Approved-to-plan (scope forks answered by owner)
**Author:** Claude Code (orchestrating), for Ali Malik

## Goal

Take `@nodus-dev/*` from a strong 0.1 engine to a **credible, shippable GA (1.0)**: a headless
diagram engine plus a **polished, robust, performant web editor** whose interaction model is on par
with Excalidraw. The canvas render is already Excalidraw-grade; this initiative closes the gap in the
**product shell, design system, accessibility, engine hardening, performance, and release
engineering** — grounded in five parallel read-only assessments (see `/tmp` reports summarized in the
initiative thread).

Baseline at kickoff: `pnpm typecheck` clean, `pnpm test` = **248 passing / 37 files**, one CI
workflow (`diagrams.yml`). This green baseline is the integration gate for every workstream.

## Scope decisions (owner-selected)

1. **Theme:** Ship **light + dark with a toggle** (Excalidraw defaults light). The design-token layer
   is sourced from the core `Theme` atom so DOM chrome and canvas re-skin together.
2. **Touch/mobile:** **Desktop-first.** No pinch-zoom / two-finger pan / responsive relayout in this
   push. (Deferred, not rejected.)
3. **Migrations:** **Remove** the unimplemented per-type migration/validate/version API for a clean
   1.0. Re-introduce real migrations when the first schema change needs one.
4. **Heavy items IN:** image insert, autosave + open/save, renderer layer cache. **OUT:** reusable
   shape library, live collaboration.

### Non-goals (explicit)

Touch/mobile support · responsive panel relayout · reusable shape/component library · live
multiplayer collaboration & comments (the git-native diff *is* the collaboration story) · hand-drawn
"roughness" rendering · SVG export (PNG stays) · implementing the migration engine.

## Workstreams

Each workstream is a bounded unit with **one-writer-per-file ownership** (Agent Team Protocol in
CLAUDE.md). `editor/index.ts`, react barrel/host files, and package manifests are contention hubs;
ownership is assigned so no two *concurrently running* agents write the same file.

### WS-0 · Foundation & contracts (lead + foundation agent, first, blocks all)

- **CI code gate:** `.github/workflows/ci.yml` running `pnpm typecheck && pnpm test && pnpm
  verify:render` on every PR. The suite is 3s and green — no reason it isn't gating.
- **Fix the P0 publish break:** `@nodus-dev/react` imports `@nodus-dev/icons-cloud` without declaring it, and
  icons-cloud is `private:true`. Declare the dependency + unprivate (or vendor the catalog).
- **Release hygiene:** `files:["dist"]` + `repository` on every publishable package; broaden vitest
  `include` to `.test.{ts,tsx}`.
- **Design-system contract:** `packages/react/src/ui/tokens.ts` (color/border/radius/spacing/shadow/
  focus-ring/type-scale, **light + dark values**, sourced from the core `Theme` atom) and
  `packages/react/src/ui/primitives.tsx` skeletons (Panel, Button, IconButton, Field/Row, Menu) with
  frozen prop signatures.
- **Editor API contract:** type-correct method signatures (stub bodies acceptable to keep typecheck
  green) for the new commands the UI shell will call: `align`, `distribute`, `lock`/`unlock`,
  `rotate`, `pasteFromSystem`, zoom helpers, arrow-nudge. Frozen so UI and core proceed in parallel.

### WS-A · Engine hardening (core, no `editor/index.ts`)

Owns `store/`, `history/`, `serialization/`, `scene-index/`, `registries/`, and new core tests.

- Make `store.apply` genuinely atomic via `transact` (currently `batch()` — no rollback) + a
  throwing-mid-apply test.
- Crash-isolate the mutation channel against third-party `NodeUtil`s: per-listener + per-`buildNode`
  try/catch surfaced through an error hook, so a throwing `getGeometry` can't drift undo state.
- **Remove** the dead migration/validate/version API (registries + serialization `migrate` no-op).
- Fix scene-index `nodeEdges` adjacency leak (unlink from linkage, not item existence).
- Fix undo-of-key-introducing-update leaving `undefined` keys (restore strict in-memory
  `load(save(x)) === x`).

### WS-B · Core editor & interaction (owns `editor/index.ts` + react host `index.tsx` + `clipboard.ts`)

Single owner of the editor hub and the interaction wiring, to serialize hub edits.

- Implement the WS-0 editor command stubs for real: **rotate** (plumbing/`canRotate` exists),
  **align & distribute**, **lock/unlock**, **system-clipboard paste** (image/text/foreign), zoom
  shortcuts (⌘±/0, zoom-to-selection, scroll-to-content), **arrow-key nudge**, **eraser** tool.
- Perf in the editor: compute the culled+sorted `visible()` set **once per frame**, shared across
  static/flow passes; make `isFlowAnimating` **O(1)** via a flow-edge counter (drop the per-frame
  `store.edges()` filter+scan).
- Interaction wiring in the react host: DOM paste handler, tool cursors (crosshair for create/connect),
  focus-ring global stylesheet injection, per-frame perf hookup.

### WS-C · Renderer perf & image node (owns `renderer/`, new `image` node type in `packages/preset-diagrams/src/`)

- Renderer **layer cache**: cached static offscreen layer + dynamic layer for moving/selected/flow, so
  dragging one node doesn't redraw every visible node.
- Per-item `catch` in the paint loop (one malformed record must not blank the frame).
- Memoize `resolveTokens` by `record.version` + theme identity (currently per-item, per-frame, ×2 for
  flowing edges).
- **Image node type**: draws an `HTMLImageElement`/decoded bitmap, participates in hit-test/bounds/
  export, serialized as a data-URI or asset ref.

### WS-D · Design system + panel migration + a11y (owns the 5 existing panels + minimap)

Owns `properties.tsx`, `command-palette.tsx`, `context-menu.tsx`, `minimap.tsx`, `flow-controls.tsx`,
`flow-scale-editor.tsx`, `flow-shared.ts`, `toast.ts`.

- Migrate all five panels onto the WS-0 tokens + primitives; delete the two duplicated grey scales.
- **Light + dark**: wire the toggle; every panel re-skins from tokens.
- **A11y**: `role=menu/menuitem` + arrow/Enter/Escape + focus trap on the context menu;
  `role=dialog`/`listbox`/`option` + `aria-activedescendant` + `aria-label` on the command palette
  (the cloud picker already does this correctly — use as the in-repo pattern); landmarks
  (`role=toolbar`, canvas `aria-label`, `aria-live` for action feedback); visible `:focus-visible`
  rings everywhere; fix WCAG-failing contrast (MICRO `#556058`, status `#3a423f`).
- Hover/cursor feedback on chrome; empty/onboarding states; toast stacking.
- Cache minimap `contentBounds` by version (P3 perf).

### WS-E · Product shell + persistence (owns new `ui/` shell components + example app)

Owns `packages/react/src/ui/` shell (Toolbar, ToolPalette, ZoomControls, ThemeToggle,
ShortcutsDialog), the react barrel exports, `examples/browser/src/main.tsx`, and browser persistence.

- Built-in **UX shell**: left tool palette, top toolbar, zoom widget (+/−/reset/%), on-canvas
  undo/redo, shortcut-help dialog (`?`). Replaces the demo's ad-hoc inline button bar.
- **Autosave + open/save**: wire the unused `@nodus-dev/persistence` package to the web layer —
  localStorage autosave, restore-on-reload, open/save `.nodus.json`.
- Rebuild the example app on the real shell + tokens as the reference product surface.

### WS-F · Test, docs & release readiness (owns new tests + READMEs + changesets)

- Promote `scripts/browser-verify.mjs` into CI as the react-UI interaction gate; add PNG pixel-diff
  baseline to `verify:render`.
- Tests for `layout-dagre` / `layout-tree` / `layout-force` (no-overlap/determinism, mirroring
  layout-elk).
- READMEs for `@nodus-dev/core` and `@nodus-dev/react`; root README polish.
- Changesets/CHANGELOG + versioning story; GA release checklist.

## Integration strategy

- Dedicated branch `team/ga` from a clean baseline; current uncommitted WIP checkpointed into a commit
  first so the baseline is resettable. **Nothing is pushed without explicit approval.**
- **Contracts frozen in WS-0** before parallel work starts (tokens, primitive props, editor method
  signatures). `ui/tokens.ts` and `ui/primitives.tsx` are **read-only imports** for WS-C/D/E during
  Phase 1; any change to them goes through the lead. Changing a frozen contract requires coordinating
  with affected owners.
- Lead runs all git writes, stages by explicit path, and runs the **full gate**
  (`pnpm verify:all`) at every integration checkpoint. Teammates gate their owned scope.
- Concurrency rule: within any parallel batch, ownership sets are pairwise disjoint. Hub files
  (`editor/index.ts`, react host, barrel, manifests) are single-owner or lead-only.
- Final verification: a `playwright-core` / chrome-devtools drive of the running app exercising the new
  shell, themes, paste, image insert, autosave, align/rotate/lock — zero console errors.

## Definition of Done (GA checklist)

- [ ] `pnpm verify:all` green; CI runs it on every PR.
- [ ] `@nodus-dev/*` publish graph valid (no undeclared/private imports); `files`/`repository` set.
- [ ] Engine: atomic apply, fault-isolated mutation channel, migration API removed, leaks/undef-key
      fixed, with regression tests.
- [ ] Web parity: shell (palette/toolbar/zoom/undo-redo), system paste, rotate, align/distribute,
      lock, eraser, zoom shortcuts, arrow-nudge, image insert, autosave + open/save.
- [ ] Design system: tokens + primitives, light+dark toggle, focus rings, WCAG AA contrast,
      keyboard-navigable + ARIA-correct menu & palette.
- [ ] Performance: shared per-frame cull/sort, O(1) flow gate, memoized tokens, renderer layer cache;
      smooth drag at ~1000 nodes.
- [ ] Docs: core + react READMEs, changesets/CHANGELOG, GA checklist.
- [ ] Browser E2E verifies the above with zero console errors.

## Risks

- **`editor/index.ts` contention** — mitigated by single-owner (WS-B) + WS-0 signature freeze so UI
  builds against stubs.
- **Light theme regressions** on the canvas — the theme atom is swappable but assets/glows were tuned
  for dark; needs a visual pass under light.
- **Layer cache correctness** (invalidation bugs) — highest-risk perf item; gated by render-diff tests.
- **Parallel-edit collisions** — mitigated by disjoint ownership + lead-only hubs + phased batches.
