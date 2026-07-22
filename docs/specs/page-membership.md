# Spec: page membership (`pageId`)

**Status:** model + serialization + load migration **implemented** (with tests); editor/render wiring is a follow-on (not yet built).
**Date:** 2026-07-22
**Area:** `@nodus/core` — `model.ts`, `serialization/index.ts`

## Problem

`PageRecord { name, index }` exists as the third arm of `NodusRecord` and round-trips through
serialization (`store.pages()` lists them), but **no record references a page** — there is no `pageId`,
and `parentId` is a *group/frame parent* (a low-z container node), never page membership. So a diagram
is effectively a single implicit page, and multi-page is scaffolded but inert.

This spec adds an explicit record→page binding **without** disturbing the git-native byte contract.

## Decisions

1. **Field placement:** `pageId?: Id<'page'>` on **`NodeRecord` and `EdgeRecord`** — *not* `PageRecord`
   (a page has no page) and *not* `BaseRecord` (same reason). Edges carry their own `pageId` because a
   `point` endpoint has no node to inherit from.
2. **Edge page: stored, not derived.** Simpler and required for floating edges; for node-bound edges it
   must match its endpoints' page (an editor-enforced invariant, not a load-time repair).
3. **Active page: ephemeral.** The currently-viewed page is session state (like the camera) — never
   serialized. (If "reopen on the last page" is wanted later, it would be an explicit `Snapshot.meta`
   exception, since the envelope `meta` is otherwise dropped.)
4. **No `SCHEMA_VERSION` bump.** `pageId` is an additive optional field — exactly like `hidden`,
   `rotation`, `parentId`, none of which bumped it. `engineMigrations[]` is reserved for breaking
   *record-shape* changes; this isn't one.

## The invariant

- **0 `PageRecord`s** ⇒ a single **implicit** page; nodes/edges carry **no `pageId`**. A pre-pages
  diagram serializes **byte-identically** — the git-native moat is preserved.
- **≥1 `PageRecord`** ⇒ every node/edge carries an **explicit** `pageId` resolving to a real page.
- There is deliberately **no** persistent "undefined ⇒ lowest-index page" semantic once pages exist —
  that would teleport records when pages are reordered. The implicit default lives only at the
  zero-pages boundary.

**Rejected alternative:** required `pageId` backfilled onto every record at load. It rewrites 100% of
existing `.nodus.json` files on first save — a non-starter for a git-native format.

## Implemented

### Data model (`model.ts`)
`pageId?: Id<'page'>` added to `NodeRecord` and `EdgeRecord`, documented as omit-when-implicit and
distinct from `parentId`.

### Serialization (`serialization/index.ts`)
- `canonicalRecord` already emits it (it strips only `version`), so **writing is automatic** and only
  present when set — page-less docs never gain the key.
- `normalizeNode` / `normalizeEdge` accept `pageId` when it's a string (same omit-when-absent idiom as
  `parentId`).
- **Load migration/repair** in `restore()`, after the edge-endpoint repair:
  - `firstPageId` = the page with the lowest `index` (or `null` when there are no pages).
  - `firstPageId === null` (page-less doc): strip any stray `pageId` → implicit page. (No-op for a
    correct page-less doc.)
  - pages present: a node/edge with a **missing or dangling** `pageId` is **backfilled/repointed to the
    first page**; a valid one is left untouched.
  - `RestoreResult.repointedPageRefs` counts how many were changed (0 for every page-less diagram).

### Tests (`serialization/pages.test.ts`, 6)
Byte-stability of page-less docs (re-serialize == input, no `pageId` in bytes); round-trip when set;
backfill of a missing `pageId` to the lowest-index page; repoint of a dangling `pageId`; strip of a
stray `pageId` when no pages exist; reorder safety. Full suite: **728 passing**.

## Follow-on (NOT in this change)

Making pages *usable* is separate work in `editor/` + `renderer/` + `scene-index/`:

- `editor.activePageId: Atom<Id<'page'> | null>` — ephemeral (null = implicit page).
- `editor.pageIdOf(rec) = rec.pageId ?? firstPageId() ?? null`.
- `editor.createPage(name?)` — **first** call materializes a `PageRecord` for the existing content
  ("Page 1", assigning its records an explicit `pageId` — the single, deliberate one-time churn where
  0→≥1 pages happens), then creates the new page.
- `editor.movePage(ids, toPageId)` — set `pageId`; enforce edge↔endpoint page coherence.
- `editor.deletePage(id)` — reassign or delete members; refuse to delete the last page.
- Renderer / scene-index: cull to `pageIdOf(rec) === activePageId`.

## Deferred refinements

- **Edge-from-endpoint repair:** on load, derive a node-bound edge's missing `pageId` from its endpoints
  rather than defaulting to the first page. Cheap and more correct; skipped to keep the repair minimal.
- **Group-member page coherence:** a node's `pageId` should match its `parentId` group's page; enforced
  by the editor, could also be a load repair.
- **Persist last-active page** via a `Snapshot.meta` exception, if desired.
