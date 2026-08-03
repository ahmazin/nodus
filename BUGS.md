# Bugs

Tracking list of known issues. Check off when fixed.

## Tracking

- [x] **Copy PNG doesn't work** — clipboard write now feature-detected + gesture-safe (Safari/older-Firefox no longer drop the user activation), falls back to a PNG download when the clipboard is unavailable/blocked, and shows a toast either way instead of failing silently.
- [x] **Copy as Image from the command palette doesn't work** — same fix; the palette command now routes through `copyOrDownloadImage`.
- [x] **Can't change connection style** — not reproducible; verified working in Firefox + Chromium. Right-click an edge → `Router → straight/orthogonal/bezier` (line shape), `Style → red/amber/dashed` (color/dash), and `Clear style` all apply and repaint. Note: `straight` vs `orthogonal` look identical on a horizontal/short edge, which can read as "nothing changed."

## QA Campaign — 2026-07-21 (8-agent full-surface sweep)

Baseline was green (652/652 tests). Every item below was net-new — not covered by the existing suite. Each has a runnable repro; triggers are inlined so they survive scratch-dir cleanup.

**Fix pass — 2026-07-22 (8-agent parallel swarm, disjoint file ownership).** All P0/P1/P2 and every checkable P3 are fixed with a dedicated fail-before/pass-after regression test. Integrated suite: **701/701 tests pass across 98 files** (was 652/93 → +49 tests), `tsc --strict` clean, no ownership conflicts. Items left unchecked below are consciously **DEFERRED** with a stated reason (render-loop perf that needs browser profiling, or inherent Canvas-2D/JSON tradeoffs) — not silently dropped.

### P0 — security, exploitable via a shared `.nodus.json`

- [x] **ReDoS in `@nodus-dev/from-mermaid`** — `from-mermaid/src/index.ts:175-178`, inline-link normalization regex `/(?:--|==)\s+([^|>\n]+?)\s+(-->|---|==>|===)/g`. Trigger: `flowchart LR\nA --<many spaces>x` (opens inline-link form, long space run, **no** closing arrow) → catastrophic backtracking, ~cubic. Measured: 400 chars=21ms, 800=162ms, ~3200≈10s, ~6.5KB≈80s+ (freezes the event loop). Not size-driven — benign 20k-edge graphs stay linear.
  ✅ **FIXED:** anchored the label class to non-space boundaries (`([^\s|>][^|>\n]*[^\s|>]|[^\s|>])`) so the greedy `\s+` prefix leaves no ambiguous partitions to backtrack → linear. Applied to **both** the `--`/`==` form AND the identically-vulnerable dotted `-.` form. Output byte-identical on legit inputs. Attack string dropped from ~24s to <0.1ms; regression test asserts a 4000-space input converts in <100ms.
- [x] **Stored XSS — unescaped `edge.flow.color` in SVG `animateFlow` export** — `core/src/renderer/svg-export.ts:98,108,121`. `flow.color` interpolated raw while numeric fields go through `n()`. Trigger: `flow.color = 'red"/><script>alert(document.domain)</script>'` → raw `<script>` in the exported SVG. Node labels + frozen flow-frame path ARE escaped; only animateFlow wasn't.
  ✅ **FIXED:** route `color` through an attribute escaper (mirrors the module-private `escapeAttr` in `svg-context.ts`) at every interpolation site (dash `stroke=` and packet `fill=`). Regression test asserts no raw `<script>` in output at any site.

### P1 — crash / data-loss / core-flow

- [x] **`makeId` collision → silent overwrite of loaded nodes (data loss)** — `model.ts:216`. Module-global `idCounter` starts at 0 each JS context, never seeded from loaded records; ids fully deterministic. Path: draw → save → reopen → draw regenerates a loaded node's id; `Store.apply` add-path silently *replaced* it.
  ✅ **FIXED (both layers):** (a) `Store.apply`'s add-path now **refuses** an add onto an existing id (skip + `onError` with new `{phase:'duplicate-add', id}`) instead of clobbering; (b) `Store.load()` calls `seedIdCounter()` to advance the counter past every loaded auto-id. `makeId` output verified byte-identical to the legacy formula (canonical tests green). Audited every `op:'add'` caller — none relied on the old replace behavior.
- [x] **Unbounded recursion in `stableStringify` → stack-overflow DoS** — `serialization/index.ts:64`, overflows ~depth 5000. A valid ~36KB `.nodus.json` crashed `nodus fmt`/`diff`, the diagrams-CI format gate, in-app PR-review canonical diff, persistence save, and MCP export.
  ✅ **FIXED:** rewrote as an iterative explicit-stack walk (so a valid deeply-nested file serializes instead of crashing). Byte-for-byte output identity proven by a 200k-case fuzz vs. the recursive reference (incl. undefined-in-array, undefined keys, NaN/Infinity, empty containers).
- [x] **`restore()` is not defensive despite its contract** — `serialization/index.ts` restore path. `records:[null]` → `Cannot read properties of null (reading 'typeName')`; non-array `records` → `raw is not iterable`. Both valid JSON, both crashed `editor.loadSnapshot()` and all CLI commands.
  ✅ **FIXED:** validate `records` is an array (non-array → empty + `onError`) and guard each entry (null/primitive/array → skip + `onError`). Added an optional, backward-compatible `onError` hook to `RestoreOptions`.
- [x] **One non-finite coordinate poisons the scene-index R-tree** — `SceneIndex.addRecord` + bulk rebuild path (no finite-guard). A single NaN (incremental) or NaN/Infinity (bulk load) in x/y/w/h made ALL healthy nodes un-hit-testable, `visible()`→0 (blank canvas), marquee→0, `contentBounds()`→non-finite (zoomToFit/export break), no error emitted.
  ✅ **FIXED:** `addRecord` (the single choke point for both the incremental insert and bulk `tree.load` paths) drops any record with a non-finite entry box *before* touching `items`/`entries`/the tree, and reports it via the editor's `onError` (new distinct `phase:'non-finite'`). Excluding it from `items` too keeps `contentBounds()` finite. Healthy nodes stay hit-testable when a neighbor has NaN geometry.
- [x] **Auto-layout stack-overflow at ~2000 nodes** — `@nodus-dev/layout-{dagre,tree,elk}` via `editor.layout()`. dagre crashes at N≈2000 (OK 1500), tree ~2500, elk 10000; only force survives. `RangeError: Maximum call stack size exceeded` — O(N)-depth recursion in adapters/underlying libs.
  ✅ **FIXED (per root cause):** **tree** — the recursion was in *our* `place()`; rewritten as an explicit-stack post-order (now scales to arbitrary depth; 50k-node chain in ~222ms, small-graph output unchanged). **dagre/elk** — recursion is inside the third-party libs; added fail-fast node-count guards (`DAGRE_MAX_NODES=1500`, `ELK_MAX_NODES=8000`, exported constants) that throw a clear, catchable error *before* invoking the engine (no state mutation on the error path) instead of a cryptic `RangeError`.
- [ ] **Whole-graph pan/zoom is a full repaint every frame** — 60fps holds only to ~150–300 on-screen nodes (193ms@1k, 1370ms@10k). Zoomed-in editing with culling is fine to 10k+. Fix: cached-layer blit + transform on pan/zoom instead of full re-render.
  ⏸ **DEFERRED:** a real render-loop optimization (the `StaticLayerCache` keys on `camera`, so pan/zoom always misses → full static repaint). The fix — blit+transform the existing bitmap *during* the gesture, then snap to an exact repaint on settle — deliberately trades pixel-exactness mid-gesture for speed and needs browser profiling to verify the 60fps claim. Correct behavior today, just slow past ~150–300 on-screen nodes. Slated for a measured, single-threaded perf pass (contends for the one dev-server), not the parallel swarm.

### P2 — robustness / DoS / perf-ceiling / contract

- [x] **Canonical output not order-invariant** — `compareRecords` uses `localeCompare`, which returns 0 for distinct ids that collate equal → semantically-equal diagrams canonicalize to different bytes (diff-CI/merge hazard).
  ✅ **FIXED:** `compareRecords` now uses a code-point total order (`a<b?-1:a>b?1:0`), so distinct ids that `localeCompare` collided on (soft-hyphen/combining-mark) get a deterministic tiebreak. Strictly more deterministic; editor-generated ids never hit the collision.
- [x] **Unbounded recursion → RangeError on nested Terraform JSON** — `import-infra` `collectResources`/`collectReferences`, ~depth 5000.
  ✅ **FIXED:** added a `depth` param + `MAX_DEPTH=1000` cap to `collectResources`/`collectConfigResources`/`collectReferences`; exceeding it throws a structured, catchable `ImportError` instead of a raw `RangeError`.
- [x] **O(n²) CPU on large Terraform/K8s inputs (DoS)** — TF `depends_on` resolution (8000 resources=7.3s) and K8s selector matching.
  ✅ **FIXED:** replaced three nested linear scans with precomputed indexes — a boundary-aligned prefix resolver for `depends_on`, a config-addr-keyed Map for reference resolution, and a `label→workloads[]` bucket for K8s Service selectors (candidates re-sorted into object order → edge output byte-identical). Realistic inputs now near-linear.
- [x] **Importers propagate raw parse exceptions uncaught at the trust boundary** — YAML errors (incl. correctly-mitigated billion-laughs) and text-to-diagram malformed payloads threw raw `TypeError` despite `normalizeSpec` documented "validate + normalize".
  ✅ **FIXED:** wrapped K8s YAML parse in try/catch → `ImportError` (incl. the yaml lib's alias-bomb `ReferenceError`); `normalizeSpec` now validates the spec shape up front and throws a structured `DiagramSpecError` instead of destructuring `undefined`. The browser `analyzeImport` already catches these → clean modal messages, not crashes.
- [x] **`colorForValue(scale, NaN)` → invalid `#NaNNaNNaN`** — `flow.ts`; `clamp01(NaN)` doesn't clamp and the `Number.isFinite` guard `resolveFlow` has is missing here. Not reachable via normal flow pipeline (resolveFlow guards first); bites direct external callers only.
  ✅ **FIXED:** NaN-specific guard at the top of `colorForValue` returns the first stop's color. Chose NaN-specific (not a blanket early finite-check) so ±Infinity keeps its correct existing clamp-to-endpoint behavior; only the NaN hole is closed.
- [x] **MCP `new_diagram` ignores its schema `preset` enum** — off-enum value returns `ok:true`, then next default `add_node` fails "unknown node type undefined".
  ✅ **FIXED:** added an enum guard (mirroring `set_flow`'s `scale.domain` check) that validates `preset` against the schema enum *before* `reset()` and returns a clear error for an off-enum value, leaving the session's prior preset intact.
- [x] **Per-op bulk build is O(N²)** — `store/index.ts:126`, `store.apply` clones the whole id-set per add; 5.4s vs 0.38s batched @10k.
  ✅ **FIXED:** replaced the per-call `new Set(idsAtom.peek())` clone with an incremental mutable `idSet` (O(1) add/remove) + an `idsVersion` reactive counter + a lazily-materialized memoized snapshot. Atomicity preserved by extending the existing hand-unwind catch to also revert `idSet`/snapshot on a mid-apply throw; verified against the atomicity + undo/redo tests. Structural regression test (intercepts `new Set(...)`), not wall-clock.
- [ ] **`toPNG` of a large full-content diagram is pixel-bound** — 13.6s @10k.
  ⏸ **DEFERRED (largely inherent):** cost is dominated by rasterizing the full-content pixel area at export resolution, not by engine overhead. No clean algorithmic fix without changing export semantics (tiling/downscale). Documenting as a known ceiling; revisit only if a concrete product need arises.
- [ ] **Single-node drag frame balloons at 10k** — 187ms even with the layer cache.
  ⏸ **DEFERRED:** a perf ceiling in the same render-loop family as the pan/zoom item; needs profiling to attribute (dirty-region planning vs. scratch-buffer realloc at 10k). Grouped into the measured perf pass rather than guessed at here.

### P3 — minor / latent

- [x] **No upper bound on `schemaVersion`** — future/negative/NaN/string versions load silently.
  ✅ **FIXED:** only a non-negative integer ≤ `SCHEMA_VERSION` is honored; future/negative/non-integer/NaN/string is reported via `onError` and best-effort loaded as current. Absent version stays silent (a snapshot may predate the field).
- [x] **`Infinity`/out-of-range numbers in props/style/flow/meta silently become `null`** on serialization.
  ✅ **FIXED (silence only):** `toCanonicalString`/`stableStringify` now surface each `Infinity`/`NaN` via `onError`. Output bytes are UNCHANGED (JSON still writes `null` — a `.nodus.json` can't hold `Infinity`); only the silent data-shape change is now reported.
- [x] **Duplicate record IDs survive `restore()`**.
  ✅ **FIXED:** restore dedupes by id (last-wins) via a Map, reporting each duplicate via `onError`; the dangling-edge repair uses the deduped set.
- [x] **`createNode` writes `label: undefined` as an explicit own-key** — `editor/index.ts:445`; cosmetic, canonical form normalizes it away.
  ✅ **FIXED:** `label` is conditionally spread, omitted entirely when undefined.
- [ ] **Deeply-chained computeds (~10k) overflow the stack** via recursive recompute — unrealistic in practice.
  ⏸ **DEFERRED (won't-fix):** the ticket itself notes this is unrealistic (~10k-deep computed chains don't occur in the engine). Making the signals recompute iterative is a core-substrate change whose regression risk outweighs a scenario that can't arise in practice. Left as documented latent.
- [x] **Several MCP tools mark schema-`required` fields the handler defaults** (add_node label, delete_elements refs, set_flow_metric metrics) — internal inconsistency, harmless.
  ✅ **FIXED:** dropped the over-promising `required[]` entries so the schema matches the handlers (which coalesce label→'', refs→[], metrics→[]). `set_flow_metric`'s inner per-item `required:['edge','value']` left intact (that's the genuine metric-entry shape). No handler/semantic change.
- [x] **`Editor.setFlowMetric(ghostId, v)` stores orphan metrics unvalidated** — ephemeral, not serialized; MCP guards upstream.
  ✅ **FIXED:** `if (!this.store.has(id)) return;` — consistent with the existing "orphan flow sources auto-unbind on store change" behavior.
- [x] **tsconfig path for `@nodus-dev/react` points to `index.ts` but the file is `index.tsx`** — no runtime impact (Vite/Vitest use own aliases), latent config nit.
  ✅ **FIXED:** root `tsconfig.json` `@nodus-dev/react` path now points to `packages/react/src/index.tsx`.
- [x] **text-to-diagram silently accepts non-object node entries → garbage records**.
  ✅ **FIXED:** `normalizeSpec` filters `nodes` to objects with a string `id` (bare strings/numbers/null dropped, not turned into stray `service` records); the edge filter likewise requires object edges with string from/to.
- [ ] **Initial-load fit clips the two right-most seed nodes behind the Properties panel** — fit-before-ResizeObserver race; recoverable (minimap shows all). Fix: defer initial fit to after first resize, or inset the fit box by panel widths.
  ⏸ **DEFERRED:** a `@nodus-dev/react` host timing fix (`nodus-host.tsx` ResizeObserver + initial fit) that needs a live browser to verify the fix actually resolves the race across panel widths. Held for the dev-server-backed pass rather than fixed blind.
- [ ] **Canvas shapes are not in the DOM accessibility tree** — inherent to canvas-2D (Excalidraw shares it). Chrome controls otherwise clean: 44/44 accessible names, no focus trap.
  ⏸ **DEFERRED (inherent):** Canvas-2D shapes have no DOM nodes to expose; a real fix means a parallel offscreen a11y tree (large, separate initiative). The surrounding chrome is already clean. Informational.

### Informational (no ticket)

- Undo history is unbounded (~354 B/entry) — consider a cap for very long sessions.
- Force-layout separation relies entirely on d3-force v3's internal LCG jiggle (the adapter's own spread-seed is dead code because store `x` defaults to 0). Deterministic today, but a d3-force major bump could silently break it — recommend a pinned cross-process determinism test.

**Verified-clean (evidence-backed positives):** no memory leaks (heap flat over 100k–200k cycles) · no prototype pollution · all 4 layout engines deterministic byte-identical cross-process · undo/redo exact + `transact` atomic + scene-index never drifts (60k-op storms) · 24/24 live-app interactions pass with zero console errors · MCP session isolation + all 14 tools graceful · culling gives 10k nodes@60fps zoomed-in · billion-laughs mitigated by `yaml@2.9.0` maxAliasCount · routing terminates/finite/axis-aligned on pathological inputs.
