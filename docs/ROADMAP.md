# Nodus build roadmap

Tracking the full feature push. Each batch lands typecheck-clean + tests green.

## Phase 1 — Deepen the four axes

**Axis 1 — types**
- [x] Pluggable edge routing (straight / orthogonal / bezier) + router registry
- [x] Edge labels (render + inline edit)
- [x] Edge waypoints (data + render + editor API)
- [x] Grouping / frames (group, ungroup, move-with-parent)

**Axis 2 — theming**
- [x] Theme pack (light, blueprint, neon, paper) in core
- [x] Per-type icon glyphs (12-icon registry + infra type icons)

**Axis 3 — layout**
- [x] Tree layout adapter (`@ahmazin/layout-tree`)
- [x] Force layout adapter (`@ahmazin/layout-force`)
- [x] ELK layout adapter (`@ahmazin/layout-elk`, worker-capable via workerUrl)
- [x] Off-main-thread layout (ELK worker option; supersedes dagre-worker)

**Axis 4 — plugins / editor UX**
- [x] Snapping + alignment guides
- [x] Minimap
- [x] Copy / paste / duplicate (+ keyboard shortcuts)
- [x] Command palette (⌘K)
- [x] Context menu (right-click)

## Phase 2 — Killer demos (shipped as packages)
- [x] Freehand / sketch plugin (`@ahmazin/plugin-freehand`)
- [x] ERD visualizer (`@ahmazin/preset-diagrams`)
- [x] State-machine editor (`@ahmazin/preset-diagrams`)
- [x] Cloud architecture with icons (icon node + glyph set)

## Phase 3 — Three highest-leverage moves
- [x] Arenas: Studio / Reverse / Evolution (infra preset adapters)
- [x] Text → diagram (`@ahmazin/text-to-diagram`)
- [x] Live infra from Terraform / Kubernetes (`@ahmazin/import-infra`)

---
Legend: [x] done · [~] in progress · [ ] todo

---

## Post-launch: Excalidraw-replacement tiers (structured-first)

**Tier 0 — blocks daily adoption**
- [x] Resize (8 handles, grab-offset, min-clamp) + z-order (bring-to-front / send-to-back)
- [x] Per-element style bag (`setStyle`/`clearStyle`, merged last in resolveTokens, serialized, undoable)
- [x] Floating / re-binding arrows — endpoint union `node | outline | point`, drag endpoints to re-bind, connect-to-body
- [x] Persistence (`@ahmazin/persistence` + doc server; localStorage autosave in playground)
- [x] Draw preset (`@ahmazin/preset-draw`: rect/ellipse/diamond/text + line/arrow + R/E/L/A/T)
- [x] Properties panel (`<Properties>` over the style bag — stroke/fill/text/width/dashed/state/clear; React example + vanilla)
- [x] Copy-as-image (`copyImage`/`downloadImage`/`renderPngBlob`; ClipboardItem PNG via OffscreenCanvas; verified image/png to clipboard on Chromium/Fedora)

**Tier 1 — parity**
- [ ] SVG backend (Ctx2D seam) · images (hashed sidecar) · `fromExcalidraw` · align/distribute · eraser · pinch · stencils

**Tier 2 — beat Excalidraw**
- [x] PIS phosphor brand theme
- [x] `fromMermaid` + ELK — `@ahmazin/from-mermaid` parses flowchart/state/ER subsets → reuses `@ahmazin/preset-diagrams` builders → ELK layout; `importMermaid(editor, src)`; verified headless render of all 3 subsets; live "⤓ Mermaid" import in the playground
- [x] MCP server (`@ahmazin/mcp`) — dependency-free stdio JSON-RPC around a headless `Editor`; 14 tools (import_mermaid, add/connect/update/delete, layout, **set_flow / set_flow_metric** for data-driven flow, export_png inline traffic-snapshot, export_json, save/load_doc); review-hardened (path containment, replace-on-import, graceful drain); verified via real stdio handshake
- [x] structured-diagram speed — double-click empty canvas → create+edit node; drag-from-port → connect (or quick-create a node in empty space); port dots on hover. (obstacle-nudged elbows deferred — needs obstacle threading through the router)
- [x] flow animation — animated packets/dashes traveling along edges (`FlowSpec` on `EdgeRecord`, `editor.setFlow`/`hasFlow`/`paintFlow`); a gated rAF layer that animates only while flows exist so idle stays 0-paints; "⇢ Flow" toggle in the playground
- [x] **data-driven flow** — `FlowScale` maps a live metric → packet speed/count/size/threshold-or-gradient color (`resolveFlow`); live values are EPHEMERAL (`editor.setFlowMetric`, not serialized/historied/autosaved) so a dashboard ticks freely without doc churn; "📊 Live" playground demo; **exposed over MCP** (`set_flow`/`set_flow_metric` + `export_png` traffic snapshot) so an agent can colour links by real metrics
- [ ] optional "rough" hand-drawn paint variant (cosmetic; deferred)

**Robustness pass (2026-07-11)** — property/fuzz invariant suite (`invariants.test.ts`: store↔index bijection, no dangling refs, undo∘redo identity, toJSON round-trip over 8 seeded random op-sequences) + a 9-subsystem adversarial core audit. **17 real bugs fixed + regression-tested**: 2 fuzzer-found integrity bugs (group-delete orphaned children; ungroup left dangling edges) and 15 audit-confirmed (signals: transaction rollback dropped/stale effects+computeds, computed leak; serialization: NaN endpoints, page style; events: reentrancy + set leaks; renderer: grid infinite-loop, save/restore leak; scene-index: dropped-edge rebuild + nodeEdges leak; geometry/routing: single-point distance, short-segment arrowhead gap; editor: duplicate clobbered clipboard; tools: mid-gesture tool-switch state/history leak).
