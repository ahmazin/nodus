# Design: Real-time collaboration for Nodus (`@ahmazin/collab`)

- **Date:** 2026-07-19
- **Status:** Approved (design decisions locked); ready for an implementation plan (Phase 1)
- **Area:** new package `@ahmazin/collab`; small hooks into `@ahmazin/core` (`makeId` mode, presence overlay). The core stays framework/DOM-free and **CRDT-dependency-free** — yjs lives only in `@ahmazin/collab`.
- **Motivation:** The four-lane audit named real-time multiplayer the single biggest "why switch" lever and the one capability totally absent. The engine is unusually *ready*: every mutation flows through one serializable op-log (`store.apply` → `ChangeInfo{changes,inverse,source,capture}` to `store.listen()`), `ChangeSource` already reserves a `'remote'` value (`model.ts:200`), and `History.record` already ignores `capture:'never'` for remote edits — so peer edits stay out of local undo by design. The gap is a sync layer, not an engine rewrite.

## Locked decisions (from brainstorming)

1. **Conflict model: CRDT (yjs).** A `@ahmazin/collab` package owns a `Y.Doc` as the shared source of truth. Outbound: subscribe `store.listen()`, and for `source === 'user'` changes, write them into the Y.Doc. Inbound: observe the Y.Doc and translate remote changes into `store.apply(remoteChanges, { source: 'remote', capture: 'never' })`. Self-hostable, offline-first, presence via yjs awareness. The core never imports yjs.
2. **ID scheme: hybrid (counter solo, prefixed in collab).** Solo (default) keeps the module-counter IDs (`node:0`, `node:1`) — so canonical `.nodus.json` and reproducible LLM/text-to-diagram output are fully preserved. A live collab session sets a short stable client prefix so `makeId` yields `<prefix>:<counter>` (stable, collision-free across clients). On save-back-to-canonical, a **canonicalization pass** remaps session IDs to clean sequential counter IDs, rewriting all references — so committed files stay pristine.

## Non-goals (v1)

- **Per-character collaborative text.** Label edits are last-writer-wins on the whole string in v1; a per-char text CRDT (`Y.Text`) for labels is a v2 follow-up.
- **Auth / permissions / a hosted service.** The transport + room server is a thin self-hostable reference; identity, authorization, and any managed offering are separate initiatives. (Read-only viewer mode — the cheaper prerequisite the audit flagged — is tracked separately and ties in here as a permission tier.)
- **Changing the solo experience.** With no collab session active, behavior, IDs, and serialization are byte-for-byte unchanged.

## Architecture

### 1. The store ↔ Y.Doc binding (the heart)

`@ahmazin/collab` exports something like `bindCollab(editor, ydoc, opts): () => void` (returns a disposer).

- **Document representation:** a top-level `Y.Map<recordId, Y.Map<field, value>>` — one `Y.Map` per record, keyed by record id, with per-field keys. Per-field (not whole-record) granularity means two clients editing *different fields* of the same node (one moves it, one recolors it) merge cleanly instead of clobbering. Values are plain JSON (numbers, strings, nested style/props objects). Derived data (routes, back-refs, the scene index) is **not** stored — it's recomputed locally from records, exactly as today.
- **Outbound (local → Y.Doc):** on `store.listen()`, for each `ChangeInfo` with `source === 'user'`, apply its `changes` to the Y.Doc inside a `ydoc.transact(..., LOCAL_ORIGIN)`: `add`/`update` → set the record's field keys; `remove` → delete the record's `Y.Map`. `program`/`remote`-sourced changes are NOT echoed back (prevents loops).
- **Inbound (Y.Doc → store):** a `ydoc` observeDeep whose events with a non-local origin are translated into engine `Change[]` and applied via `store.apply(changes, { source: 'remote', capture: 'never' })`. `capture:'never'` keeps them out of the local undo stack (already honored by `History`) and out of autosave/history churn.
- **Loop prevention:** tag local transactions with a known origin; ignore inbound events whose origin is local. Symmetric to the `source` filter on the outbound side.
- **Convergence proof:** two `Editor`s bound to the same `Y.Doc` (in-memory, no transport) must converge to identical documents under interleaved edits — this is the Phase 1 headless test and the core correctness gate.

### 2. Hybrid ID generation

`makeId` (`model.ts`) gains a client-prefix mode:
- Default (solo): unchanged module counter → `node:0`.
- Collab: `@ahmazin/collab` calls a setter (e.g. `setIdClientPrefix('a3f')`) on session join, so new IDs are `a3f:0`, `a3f:1` — stable, collision-free, still counter-based per client. The prefix is a short stable per-client token (derived from the yjs client id).
- **Canonicalization pass** (`canonicalizeIds(records): records`) used on save-back / by `nodus fmt`: build an old→new id map by remapping records to clean sequential counter IDs **in canonical order** (`compareRecords`), then rewrite every reference — `edge.from.nodeId`, `edge.to.nodeId`, `node.parentId` — atomically. Output is identical to what a solo session would have produced. This pass must be reference-complete (a missed ref = a dangling edge), so it is covered by a round-trip test: prefixed session → canonicalize → clean counter IDs + all edges/parents intact + canonical string matches the solo equivalent.
  - Diff-stability note: canonicalization runs on an explicit save-to-canonical action (or in `fmt`), NOT on every keystroke, so it does not churn live-session state. Within a session, prefixed IDs are stable-once-assigned, so live autosave diffs stay clean too.

### 3. Presence (cursors, selection, awareness)

- yjs **awareness** carries each peer's cursor (world coords), current selection ids, and a display color/name.
- Rendered through the engine's existing **`overlaysAtom`** overlay layer (the audit identified this as the natural attach point): a presence overlay paints remote cursors + selection outlines each frame. No core change beyond registering the overlay from `@ahmazin/collab`.
- Laser pointer / follow-mode (deferred experience items) become trivial once this cursor-broadcast channel exists.

### 4. Transport

- Pluggable yjs provider. v1 ships a `y-websocket` binding + a minimal room server (a real collab backend — the existing `scripts/doc-server.mjs` is single-writer/no-auth and is NOT it). `y-webrtc` remains an option for serverless peer-to-peer.
- Offline + reconnect are handled by yjs natively (the CRDT merges on reconnect) — the reason CRDT was chosen over server-OT. The deterministic `diff(prev,next)` is available to verify/seed a room from a canonical baseline.

## Phasing (each phase independently testable)

- **Phase 1 — Binding + hybrid IDs (headless, no transport).** `bindCollab`, the per-field Y.Map representation, outbound/inbound translation with loop prevention, `makeId` prefix mode + `canonicalizeIds`. Test: two in-memory Editors sharing a Y.Doc converge under interleaved ops; ID canonicalization round-trip. **This phase proves the hard part** and ships as a usable library for anyone bringing their own provider.
- **Phase 2 — Presence + transport.** Awareness-driven cursor/selection overlay via `overlaysAtom`; `y-websocket` provider + reference room server. Browser-verify two live clients.
- **Phase 3 — Canonicalize-on-save + read-only tie-in.** Wire the canonicalization pass into save/`fmt`; integrate the read-only viewer permission tier.
- **Phase 4 (later) — per-char text CRDT for labels; auth/permissions.**

## Risks & mitigations

- **yjs dependency:** confined to `@ahmazin/collab`; `@ahmazin/core` stays dependency-free (enforced by the existing external-consumer pack-test discipline). First real external runtime dep for the collab package — surface to the human at plan time.
- **Whole-string label LWW (v1):** acceptable; documented; `Y.Text` upgrade is additive later.
- **ID canonicalization ref-completeness:** the single highest-risk correctness area (a missed reference orphans an edge). Mitigated by a reference-complete remap + a round-trip test asserting zero dangling refs and canonical-string equality with the solo equivalent.
- **Representation churn:** if per-field Y.Map proves too chatty, batch via `ydoc.transact`; the granularity decision is contained in the binding module.

## Testing plan

1. **Convergence (Phase 1, core gate):** two Editors + one Y.Doc; scripted interleaved edits (move, restyle, add, delete, connect) from both → identical `toJSON()`.
2. **Loop safety:** a local edit does not re-trigger an inbound apply; a remote edit does not echo back out.
3. **Undo isolation:** remote edits never enter local undo (assert `history` unchanged across a remote apply).
4. **ID hybrid:** solo IDs unchanged (`node:0`); a prefixed session mints `<prefix>:n`; `canonicalizeIds` round-trips to clean counter IDs with all edge/parent refs intact and canonical output equal to the solo equivalent.
5. **Property/fuzz:** random concurrent op-sequences on two peers converge (extends the existing invariant-suite style).

## File-level change map (for the Phase 1 plan)

- `packages/collab/` (NEW package): `bind.ts` (store↔Y.Doc), `ids.ts` (`canonicalizeIds`), `presence.ts` (Phase 2), `provider-websocket.ts` (Phase 2), package.json (yjs dep), README.
- `packages/core/src/model.ts` — `makeId` client-prefix mode + `setIdClientPrefix` (additive; default unchanged).
- `packages/core/src/index.ts` — export the id-prefix setter + `canonicalizeIds` helper location TBD (or keep canonicalizeIds in collab if it needs no core internals).
- Tests: `packages/collab/src/*.test.ts` (convergence, loop, undo isolation, id round-trip).
