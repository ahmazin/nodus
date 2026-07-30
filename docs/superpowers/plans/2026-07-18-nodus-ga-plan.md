# Nodus GA — Fleet Coordination (lead's source of truth)

**Branch:** `team/ga` · **Baseline:** `ffd545e` · **Foundation commit:** `455545a`
**Spec:** `docs/superpowers/specs/2026-07-18-nodus-ga-design.md`

Lead runs ALL git + integration gating (`pnpm verify:all`). Agents edit their OWNED files only,
never run git, and REPORT barrel/manifest changes for the lead to apply. Recovery = `git reset --hard
ffd545e`.

## Frozen contracts (from WS-0, committed @ 455545a)

- **Theme mode:** `Theme.appearance?: 'light'|'dark'` is the single source of truth. Chrome derives via
  `modeOfTheme(theme)`. Themes: `defaultTheme`/`defaultLightTheme` (core), `darkInfraTheme`/
  `infraLightTheme` (preset-infra). Atom: `editor.themeAtom` (get via `useValue(() => editor.themeAtom.get())`).
- **UI tokens:** `packages/react/src/ui/tokens.ts` — `UiTokens` (color/radius/space/shadow/focusRing/
  font), `uiTokens` (WCAG-AA light+dark), `uiTokensFor`, `modeOfTheme`, `useUiTokens(editor)`.
- **Primitives:** `packages/react/src/ui/primitives.tsx` — `Panel/Button/IconButton/Field/Row/Menu/
  MenuItem/Divider`, CONTEXT pattern (`UiTokensProvider`/`useUiTokensContext`, optional `tokens?`
  prop). `ui/global-styles.ts` — `injectGlobalStyles()` (focus-visible, reduced-motion).
- **Editor commands:** `rotate/align/distribute/nudge/zoomToSelection/scrollToContent` REAL;
  `lock/unlock/isLocked` STUB (need `NodeRecord.locked?`). Types `AlignEdge`, `DistributeAxis`.
- **Model:** `NodeRecord.rotation?` EXISTS; `locked?` DOES NOT (WS-B adds; edit-lock ≠ visual `'locked'`
  state).
- **Image node (FROZEN):** id `'diagram.image'`, props `{ src; naturalWidth; naturalHeight; alt?;
  fit?:'contain'|'cover' }`. Export `imageNode` from preset-diagrams.

## Ownership map (one writer per file)

| WS | Owns | Wave |
|---|---|---|
| **A** core hardening | `core/src/{store,history,serialization,scene-index,registries}/`, new `core/src/__tests__/*` | 1 |
| **C** renderer + image | `core/src/renderer/`, `packages/preset-diagrams/src/` | 1 |
| **D** design-system panels + a11y | `react/src/{properties,command-palette,context-menu,minimap,flow-controls,flow-scale-editor,flow-shared,toast}.*` | 1 |
| **B** editor + interaction | `core/src/{editor,model,tools}/…`, `react/src/nodus-host.tsx`, `react/src/clipboard.ts` | 2 |
| **E** shell + persistence | `react/src/ui/shell/*`, `examples/browser/src/main.tsx`, persistence wiring | 2 |
| **F** tests + docs + release | new tests (layout-{dagre,tree,force}), READMEs, changesets, icons-cloud build machinery | 2 |
| **lead** | both barrels (`core/src/index.ts`, `react/src/index.tsx`), `scripts/build-all.mjs`, CI, all git | — |

Concurrency rule: within a wave, ownership sets are pairwise disjoint. Hub files are lead-only or
single-owner. `editor/index.ts` and `nodus-host.tsx` are single-owner (WS-B).

## Wave schedule

- **Wave 1 (parallel):** A + C + D. Disjoint dirs (core-model/serialization, core-renderer/preset,
  react-panels). None touch `editor/index.ts` or barrels.
- **Lead between waves:** split `react/src/index.tsx` → `nodus-host.tsx` (host) + `index.tsx` (barrel);
  apply reported barrel changes (remove `Migration` export for WS-A; add image/ui/shell exports);
  integrate + `verify:all` + commit.
- **Wave 2 (parallel):** B + E + F. B owns editor/model/tools/host; E owns shell/example; F owns
  tests/docs/release. Barrel exports applied by lead.
- **Final:** browser E2E drive (chrome-devtools/playwright) of shell + themes + paste + image +
  autosave + align/rotate/lock; full gate; docs; final report.

## Deferred / follow-up (lead tracks)

- **icons-cloud build machinery** (WS-F): no `tsup.config.ts` (multi-entry `.`/`aws`/`azure`/`gcp`),
  absent from `scripts/build-all.mjs order`, no `license` field (legal call → user). Publish blocker.
- **repository URL:** no git remote → placeholder `ahmazin/nodus` in every package. Needs real URL (user).
- **theme/presets.ts** `appearance` tags: only needed if the theme-pack feeds a theme picker (WS-E
  decides; owns presets.ts if so).
- **Migration API removal** (WS-A): drop `type Migration` from the core barrel — lead applies at Wave-1
  integration.

## Universal gates (every task)

New behavior has a failing-without-change test; no debug leftovers/swallowed errors; keep `tsc` strict
green on owned files; continuous gestures use `capture:'later'` + `mark()`; route mutations through
`store.apply`/editor helpers. Report: files changed (⊆ Owns), commands run + real output, assumptions,
barrel/manifest changes needed.
