# Nodus roadmap

Where the engine is going, framed as **Now / Next / Later**, with the deliberate **non-goals** that
keep the scope honest. Each batch lands typecheck-clean with tests green.

This file is the strategic roadmap; the long "what already shipped" checklist is preserved in the
[Shipped](#shipped-appendix) appendix at the bottom.

## Now — launch readiness (0.3.x)

Getting the already-built engine in front of people without broken promises. **Most of this landed on
`team/prr-remediation` (PR #2); what remains is human-gated deploy/publish** — open tasks live in
[`TRACKER.md`](../TRACKER.md); detail in [the PRR remediation report](audits/PRR-REMEDIATION-REPORT.md).

- **Deploy** the docs/marketing site and the hosted playground at a stable public URL. — _Pages workflow
  + `/nodus` base plumbing ready; **enable GitHub Pages to go live** (human)._
- **Version coherence** — every publishable package on the synchronized `0.3.x` line (see
  [Stability & versioning](https://ahmazin.github.io/nodus/docs/versioning)). — _✅ re-baselined;
  **publish via `release.yml`** remains (human)._
- **Link & policy sweep** — canonical URLs, support matrix, privacy/telemetry statement, accessibility
  statement, comparison page. — _✅ landed._
- **Correctness gates** — rotation geometry fix, first-session playground defects, export pixel cap,
  bounded undo history, capped idle rAF. — _✅ landed + regression tests._
- **Touch** — two-finger pan, pinch-zoom, and fat-finger hit-tolerance so the public playground works on
  a tablet/phone. — _✅ landed._
- **A11y & i18n** — aria-live selection, keyboard authoring (Enter/F2 + portable connect), non-color
  overlays; the i18n literal sweep across all chrome panels + light-mode swatches. — _✅ landed
  (shipped translations still to come, see Next)._
- **Performance envelope** — a committed `pnpm bench` baseline and a published
  [performance envelope](https://ahmazin.github.io/nodus/docs/performance). — _✅ landed; the pan fast
  path was **attempted → no-go** (the renderer's absolute-coordinate gradient AA floors integer-shift
  diffs at ~5 LSB, above a pixel-safe blit), so the cliff is documented, not hidden._

## Next — reach & migration

- **Framework reach** — extract a framework-free DOM host from the React binding; ship a vanilla
  interactive example and CDN docs; add a React 19 verification leg; scope Vue/Svelte bindings.
- **Migration path** — `fromExcalidraw` / draw.io import so teams can bring existing diagrams.
- **Parity fills** — SVG editing backend, images (hashed sidecar), align/distribute, eraser,
  stencils, `toMermaid` export.
- **i18n** — ship real translations on top of the message-override foundation (English defaults exist
  today; no shipped locales yet).

## Later — depth

- **Collaboration extension point** — a `yjs` (or similar) adapter layered over the change-delta
  stream for teams that want live multiplayer, kept as an opt-in extension rather than a core
  concern (see the non-goal below and the
  [collaboration position](https://ahmazin.github.io/nodus/docs/collaboration)).
- **Zoom LOD** — skip labels/detail below a zoom threshold so a fully-zoomed-out large estate stays
  interactive.
- **Screen-reader depth** — an accessible structural mirror of canvas content beyond selection
  announcements (see the [accessibility statement](https://ahmazin.github.io/nodus/docs/accessibility)).
- **Distribution** — VS Code diagram previewer, marketplace Action for the diagrams-in-CI workflow,
  IndexedDB persistence store.

## Non-goals

- **Built-in real-time multiplayer sync is a deliberate non-goal.** Nodus's collaboration model is
  **git-native async review**: diagrams are canonical `*.nodus.json` text, so they branch, diff
  (`nodus diff`), review (the diagrams-in-CI workflow + in-app PR-diff), and merge like code. This is
  a different, deliberate bet from a live cursors-on-a-shared-doc editor — the two demand opposite
  ID/merge models (counter IDs and a CRDT vs. distributed creation and canonical text). Live sync
  remains possible as a *Later* extension over the change-delta stream, but it is not something the
  core will grow. See the [collaboration position](https://ahmazin.github.io/nodus/docs/collaboration).
- **Not a general illustration tool.** Nodus is structured-diagram-first (nodes, edges, layout,
  git-native review). Freehand drawing exists as a plugin, but pixel-art / rich vector illustration is
  out of scope.
- **No bundled backend / account system.** The engine is headless and local-first; persistence and
  auth are the host's concern (a `DocStore` interface is provided, not a hosted service).

---

## Shipped appendix

The capability the *Now/Next/Later* plan builds on. Legend: `[x]` done · `[~]` in progress · `[ ]` todo.

### Phase 1 — the four axes

- [x] Pluggable edge routing (straight / orthogonal / bezier) + router registry
- [x] Edge labels (render + inline edit); edge waypoints (data + render + editor API)
- [x] Grouping / frames (group, ungroup, move-with-parent)
- [x] Theme pack (light, blueprint, neon, paper) + per-type icon glyphs
- [x] Layout adapters — dagre, tree, force, ELK (worker-capable)
- [x] Snapping + alignment guides, minimap, copy/paste/duplicate, command palette (⌘K), context menu

### Phase 2 — killer demos (shipped as packages)

- [x] Freehand / sketch plugin (`@nodus-dev/plugin-freehand`)
- [x] ERD + state-machine editors (`@nodus-dev/preset-diagrams`)
- [x] Cloud architecture with icons (icon node + glyph set)

### Phase 3 — highest-leverage moves

- [x] Arenas: Studio / Reverse / Evolution (infra preset adapters)
- [x] Text → diagram (`@nodus-dev/text-to-diagram`)
- [x] Live infra from Terraform / Kubernetes (`@nodus-dev/import-infra`)

### Excalidraw-replacement tiers (structured-first)

- [x] **Tier 0** — resize + z-order, per-element style bag, floating/re-binding arrows, persistence,
  draw preset, properties panel, copy-as-image.
- [~] **Tier 1** — parity fills (SVG backend, images, `fromExcalidraw`, align/distribute, eraser,
  pinch, stencils) — in progress; see *Next*.
- [x] **Tier 2** — PIS phosphor theme, `fromMermaid` + ELK, MCP server, structured-diagram speed
  (double-click create, drag-from-port connect), flow animation, data-driven flow.

### Robustness

- [x] Property/fuzz invariant suite (store↔index bijection, no dangling refs, undo∘redo identity,
  round-trip) + a multi-subsystem adversarial core audit; 17 real bugs fixed + regression-tested.
