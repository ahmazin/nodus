# Design: Stencils & Templates for Nodus

- **Date:** 2026-07-19
- **Status:** Approved (scope + key decisions); ready for an implementation plan
- **Area:** `@ahmazin/core` (capture/place primitives), `@ahmazin/react` (library panel + templates gallery), a new `@ahmazin/stencils` package (types + serialization + built-in content), example app wiring.
- **Motivation:** The competitive audit named a stencil/template ecosystem table-stakes: "a blank canvas is intimidating; XD's community libraries and draw.io's 10,000 shapes are the on-ramp." Two existing pieces make this a *generalization*, not a from-scratch build: the **CloudIconPicker** is already a searchable, drag-to-canvas palette, and **canonical serialization** lets a stencil BE a git-diffable `.nodus` fragment and a library a reviewable `.noduslib.json` bundle — something no incumbent's library format offers.

## Goals

1. **Stencils:** select one or more elements → "Save as stencil" → it appears in a searchable **library panel** → drag onto the canvas to place a copy (fresh ids, at the drop point).
2. **Templates:** a **gallery** of full starting diagrams (e.g. "3-tier web app", "CI/CD pipeline") — click to open one as a new document.
3. **Git-native format:** stencils are canonical, id-normalized `.nodus` record fragments; libraries are `.noduslib.json` bundles; templates are `.nodus.json` documents — all deterministic and code-reviewable (the differentiator).
4. Reuse existing patterns: the CloudIconPicker UI, the canonical serializer, and the drag-to-place canvas-registry path.

## Non-goals (v1)

- A hosted/community library marketplace (XD's libraries.excalidraw.com equivalent). v1 is local + file import/export only.
- Live-updating "smart" stencils / instances that stay linked to a master (that's components/symbols — a later feature). A placed stencil is a plain copy.
- Rich per-stencil metadata beyond name + tags + an optional preview.

## Locked decisions

1. **Scope:** core mechanism **+ full-diagram templates** (both in v1).
2. **Format:** canonical `.nodus` fragment per stencil; `.noduslib.json` bundle per library; templates are `.nodus.json` documents. All git-diffable.
3. **UI:** a generalized **library panel** built from the CloudIconPicker pattern (search, drag-to-canvas, grouped by library, recents) + a **templates gallery**.

## Architecture

### 1. Data model (`@ahmazin/stencils`)

```ts
interface Stencil {
  id: string;                 // stable within its library
  name: string;
  tags?: string[];
  records: NodusRecord[];      // canonical, id-normalized fragment (positions relative to bbox origin)
  preview?: string;            // optional data: URI thumbnail (else derived by rendering on demand)
}
interface StencilLibrary { name: string; stencils: Stencil[]; }     // serialized as *.noduslib.json (canonical)
interface Template { id: string; name: string; description?: string; snapshot: Snapshot; preview?: string; }
```

`.noduslib.json` uses the **same canonical stringify** as `.nodus.json` (sorted keys, stable order) so libraries diff cleanly in git.

### 2. Core primitives (`@ahmazin/core`)

Two engine helpers keep id/geometry normalization in one tested place:

- `editor.captureStencil(ids: Id[]): NodusRecord[]` — collect the selected records + any edges whose **both** endpoints are in the set (dangling edges dropped, mirroring `restore`'s repair); **remap ids** to a normalized local sequence (`n0`, `n1`, … / `e0`, …), rewriting `edge.from/to.nodeId` and `parentId`; **translate** all node positions so the selection bbox origin is `(0,0)`. Result is placement-agnostic and diff-stable.
- `editor.placeStencil(records: NodusRecord[], at: Vec2, opts?): Id[]` — clone the fragment with **fresh document ids** (via `makeId`), rewrite internal refs, offset positions by `at`, `store.apply` them as one undo entry, and return the new ids (selected after placement). Reuses the same id-rewrite pass as capture (DRY).

These are pure engine operations (no UI), unit-testable headlessly, and the id-rewrite pass is closely related to the collaboration `canonicalizeIds` work (same reference-completeness discipline — see `docs/superpowers/specs/2026-07-19-collaboration-design.md`); keep the two implementations aligned.

### 3. React UI (`@ahmazin/react`)

- `<StencilLibrary editor libraries onSave>` — generalizes `CloudIconPicker`: a searchable grid of stencil previews grouped by library, a recents strip, drag-to-canvas (reuse the existing canvas-registry drag→`placeStencil` path used by CloudIconPicker), and a "Save selection as stencil" affordance (prompts for a name, calls `captureStencil`, appends to the user library, persists).
- `<TemplatesGallery editor templates onOpen>` — a grid of template previews; clicking opens `editor.loadSnapshot(template.snapshot, { fit: true })` after a guard ("Replace the current diagram?" when there are unsaved changes).
- Previews: render a stencil/template to a small PNG/SVG thumbnail on demand via the existing `renderSVG`/`toPNG` path (no stored bitmap needed unless the author supplies one).

### 4. Persistence

- The **user library** persists to localStorage via `@ahmazin/persistence` (a JSON blob under a stable key), auto-saved on every stencil add/remove.
- **Import/export:** a library round-trips as `.noduslib.json`; a template as `.nodus.json`. Reuse the existing `saveToFile`/`openFromFile` helpers.

### 5. Built-in content (`@ahmazin/stencils`)

Ship a **small** starter set so the panel isn't empty: a handful of common stencils (a labeled box, a note, a decision diamond, a simple 2-tier group) and 2–3 templates (blank, 3-tier web app, CI/CD pipeline) authored as canonical fragments/snapshots. Curated depth (UML/BPMN/cloud packs) is an explicit follow-up, not v1.

## Package layout

- `packages/stencils/` (NEW): `types.ts`, `serialize.ts` (`.noduslib` canonical read/write, reusing `stableStringify`), `builtin/` (starter stencils + templates as data), `index.ts`. Depends on `@ahmazin/core` (types + canonical) only.
- `packages/core/src/editor/index.ts`: `captureStencil` + `placeStencil` (+ a shared private id-rewrite helper).
- `packages/react/src/stencil-library.tsx`, `templates-gallery.tsx` (NEW) + exports.
- `examples/browser/src/main.tsx`: mount the panel + gallery, wire the built-in content and the user library.

## Phasing (each independently testable)

- **Phase 1 — Core primitives.** `captureStencil` / `placeStencil` + id-rewrite, headless tests (capture→place round-trip: fresh ids, refs intact, positions offset, dangling edges dropped). Ships usable to anyone building their own UI.
- **Phase 2 — `@ahmazin/stencils` + format.** Types, `.noduslib` canonical serialize/restore, built-in starter content, `stableStringify` reuse + canonical test.
- **Phase 3 — React panels.** `<StencilLibrary>` (generalize CloudIconPicker) + `<TemplatesGallery>`, persistence, example-app wiring; browser-verify drag-to-place + save-from-selection + open-template.

## Testing plan

1. **Capture round-trip:** select 2 nodes + 1 connecting edge → `captureStencil` → normalized ids (`n0`,`n1`,`e0`), edge refs rewritten, positions bbox-relative; a selection with an edge to an *unselected* node drops that edge.
2. **Place:** `placeStencil(fragment, {x,y})` → fresh doc ids (no collision with existing), refs rewritten, positions offset by the drop point, one undo entry reverts all.
3. **Canonical library:** a `StencilLibrary` serializes to deterministic `.noduslib.json` and restores identically; byte-stable across repeated writes.
4. **Templates:** opening a template `loadSnapshot`s its records; the built-in templates are valid (restore with 0 dropped).
5. **UI (browser):** drag a stencil onto the canvas adds its records at the drop point; "Save selection as stencil" adds to the library + persists; opening a template replaces the doc.

## Risks & mitigations

- **Id-rewrite reference-completeness** (the highest-risk area — a missed ref orphans an edge/child): one shared, tested id-rewrite helper used by both capture and place; the round-trip test asserts zero dangling refs. (Same class of risk as the collab id-canonicalization; keep the implementations aligned.)
- **Preview cost:** render thumbnails lazily/on-demand and cache; don't store bitmaps unless authored.
- **Scope creep into "components/symbols":** explicitly out of scope — a placed stencil is a plain copy, no master link.
- **Built-in content size:** keep the starter set small (data authored as canonical fragments); curated packs are a separate effort.

## File-level change map (for the plan)

- `packages/core/src/editor/index.ts` — `captureStencil`, `placeStencil`, shared id-rewrite helper; export any new types via `packages/core/src/index.ts`.
- `packages/stencils/` — new package (types, canonical serialize, built-in starter stencils + templates).
- `packages/react/src/stencil-library.tsx`, `packages/react/src/templates-gallery.tsx` — new; exported from `packages/react/src/index.tsx`.
- `examples/browser/src/main.tsx` — mount + wire built-ins + user library.
- Tests: `packages/core/src/editor/stencil.test.ts`, `packages/stencils/src/*.test.ts`, React browser-verify.
