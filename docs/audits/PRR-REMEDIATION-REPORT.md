# Nodus PRR Remediation — Report & Launch Runbook

- **Branch:** `team/prr-remediation` (off baseline `cde51d8`) — **25 commits; opened as [PR #2](https://github.com/ahmazin/nodus/pull/2) → `mainline` (pushed 2026-09-30). Not yet merged/published/deployed.**
- **Gates (authoritative, on the settled tree):** `pnpm typecheck` clean · `pnpm test` **1064/1064** (from 970) · `pnpm --filter @nodus-dev/site build` green · `node scripts/browser-verify.mjs` **69/69 PASS** · `pnpm bench` green.
- **Method:** a 12-agent read-only recon → three write waves (E1 code, E2 surface, E3 tooling), each lane single-owner by directory, self-gated, then lead-integrated + committed per lane.

> **Update 2026-09-30.** A follow-up pass closed the deferred *technical* items — the full i18n literal sweep (all 15 chrome panels), touch hit-tolerance, portable keyboard-connect, and light-mode swatches all landed (suite 1024 → **1064**). The **pan fast-path** was re-attempted and returned an evidence-backed **no-go** (see *Deferred* below). The branch was then pushed and opened as **PR #2**; its CI shows every project gate green — the two red security-scanner checks (CodeQL `js/polynomial-redos`, `guardrails/scan`) are **pre-existing on `mainline`** (e.g. `svg-context.ts:132` is byte-identical to mainline), not introduced by this branch.

## What landed (by PRR facet / top blocker)

| PRR item | Status | Where |
|---|---|---|
| #5 Rotation resize corruption + edges/ports ignore rotation (P1) | ✅ fixed + tests | `core/geometry,scene-index,editor,tools` |
| #11 MCP export confused-deputy arbitrary file overwrite (P1) | ✅ path-containment + `NODUS_MCP_ALLOW_CWD` + regression test | `mcp/session.ts,bin.ts` |
| Uncapped export canvas DoS (P2) | ✅ `MAX_EXPORT_PIXELS`=256MP, catchable | `core/editor,errors` |
| #3 Versioning contract incoherent (P1) | ✅ re-baselined all pkgs → synchronized **0.3.0** + docs aligned | all `package.json`, `stability.md`, `versioning.md` |
| #6 Zero touch support (P1) | ✅ pinch-zoom / two-finger pan / pointer isolation + fat-finger hit-tolerance (`PointerMods.tolerance`) | `react/touch.ts`, `nodus-host.tsx`, `core/editor` |
| #9 Playground double-undo / keyboard trap / NaN edge-label (P1) | ✅ all three fixed, browser-verified | `example/main.tsx`, `react/nodus-host.tsx` |
| #12 A11y: SR-silent canvas, no keyboard authoring, color-only overlays (P1/P2) | ✅ aria-live, Enter/F2 + connect-from-selection, keyboard context-menu, dash+stroked-glyph overlays, AA contrast | `core` + `react` |
| i18n absent (P1) | ✅ foundation + **full literal sweep**: all 15 chrome panels through `useMessages` (14 namespaces, ~168 literals) + light-mode swatch palette | `core/messages`, `react/messages.tsx` + all react panels |
| #1/#2 Nothing deployed + dead links (P0/P1) | ✅ Pages workflow + `/nodus` base plumbing + full link-truth sweep + Discord removed | `apps/site/**`, all READMEs, `pages.yml` |
| #14 icons-cloud uninstallable (P1) | ⚠️ option-2 content ready (tarball ships **zero** artwork); **still HELD** pending your legal call | `icons-cloud/src`, `build-icon-packs.ts` |
| #10 Zero community infra (P2) | ✅ CONTRIBUTING/CoC/SUPPORT/GOVERNANCE/MAINTAINERS/NOTICE + issue/PR templates | repo root, `.github/` |
| #13 No bench/perf gate (P2) | ✅ `pnpm bench` + layer-cache invariants + real envelope docs | `scripts/bench.mjs`, `performance.md` |
| Testing: advisory CI, no coverage/pixel gate (P1/P2) | ✅ blocking e2e, post-publish smoke, dependabot, SHA-pins, coverage, size-limit, golden, axe+keyboard smoke | `.github/workflows`, `scripts/golden`, `browser-verify.mjs` |
| Docs unreachable / stale (P0/P1) | ✅ npx MCP, comparison/collab/troubleshooting/support/privacy/a11y/perf pages, base-aware nav, API reference wired | `apps/site/src/pages/docs`, `build.mjs` |
| Legal overclaim / elkjs undisclosed (P2/P3) | ✅ root NOTICE + README carve-out + elkjs EPL-2.0 note | `NOTICE`, READMEs |

## Deferred (evidence-backed / out of scope this pass)
- **Pan fast-path (perf P1) — DEFERRED; re-attempted 2026-09-30 → evidence-backed no-go.** The chrome/content split *was* prototyped and it eliminates the cliff (pan stops forcing a full repaint), so the screen-space parallax/vignette are **not** the real blocker. The deeper floor: the renderer anti-aliases gradient node fills at **absolute device coordinates**, so even two *direct* full paints at integer-pixel-shifted cameras already differ up to ~5 LSB (45/600 integer-shift pairs > 1) — no translate-blit can beat that shift-non-invariance floor, so a strict `maxDiff ≤ 1` gate is unreachable. Prototype reverted byte-identical. Cliff remains **masked by the `maxFps=30` cap**; the root cause + two future paths (integer-shift-invariant content rasterization, or a conscious ~5-LSB *active-pan* relaxation) are recorded in `performance.md`. Owner chose *leave deferred*.
- **Golden-image CI job is NON-BLOCKING** until baselines are regenerated on the CI runner (sandbox vs CI Skia AA determinism is uncharacterized). Harness + deterministic fixed-fixture baselines are committed.
- ~~Full i18n literal sweep; touch hit-tolerance; portable keyboard-connect; light-mode swatches~~ — **DONE 2026-09-30** (see the Update note above). Still deferred: **font self-hosting** (P3 GDPR — Space Grotesk / JetBrains Mono stay on the Google CDN rather than committing provenance-dirty `.woff2`).
- **M3 (post-launch):** from-excalidraw / draw.io import, system-clipboard interop, drag-drop import, CLI `import`/`--format svg`, `toMermaid`, web-component/vanilla host + Vue/Svelte, hyperlink field, laser pointer, resize snap/aspect-lock, waypoint-index metadata, IndexedDB store, VS Code previewer, marketplace Action, multi-select transforms.

## New dev-dependencies (supply-chain surface — surfaced per policy)
`@vitest/coverage-v8@2.1.9` (pinned to repo vitest 2.x), `size-limit` + `@size-limit/preset-small-lib`, `pixelmatch`, `pngjs`, `axe-core`. **All dev-only.** No new runtime deps.

## HUMAN-ONLY RESIDUAL (I did not and will not do these)

> **Live board:** open/pending work — this residual plus the deferred items and backlog — is tracked in [`TRACKER.md`](../../TRACKER.md), which is what agents pick tasks from. The list below is the point-in-time snapshot.

### Launch-gating (M0/M1)
1. **Merge** `team/prr-remediation` → `mainline`. ✅ Pushed + opened as **[PR #2](https://github.com/ahmazin/nodus/pull/2)** (2026-09-30) — **review + merge** it (branch is `MERGEABLE`; the red CodeQL/guardrails checks are pre-existing on `mainline`, not from this branch, and don't block since branch protection isn't enabled yet).
2. **Enable GitHub Pages** (Settings → Pages → Source = *GitHub Actions*); the committed `pages.yml` deploys under `/nodus/`. Then verify `https://ahmazin.github.io/nodus/` + `/nodus/docs/` + `/nodus/playground/` load and nav resolves.
3. **Publish the 0.3.0 line + deprecate old versions** — see runbook below.
4. **Branch protection** on `mainline`: require `verify` + `dist-consume` + `browser-e2e` + site build.
5. **icons-cloud publish decision** — STILL HELD (`private:true`). Option-2 makes the *tarball* artwork-free; the GitHub `svg/` exposure is pre-existing/unchanged. To publish: confirm the legal posture, empty `packages/icons-cloud/provenance.json` to `[]`, remove `private:true`/`_publishHold`, add `publishConfig.access:"public"`. **Your legal call, not an agent's.**

### Trust / quality (strongly recommended)
6. Decide owned origin (github.io vs domain) + commission a **"Nodus" trademark clearance** before more brand spend; if the origin changes, update `apps/site/src/config.ts` + `astro.config.mjs` (`site`/`base`) + `typedoc.json`.
7. Enable **GitHub Discussions**; set ~10 repo **topics** + the **homepage** field.
8. Delete the 17 stale `@ahmazin/*` git tags + GitHub Releases.
9. Add an **npm co-owner / credential escrow** for `@nodus-dev` (bus-factor 1).
10. Swap the CoC/SECURITY contact from `@ahmazin` to a dedicated alias if desired (marked in the files).
11. **Self-host site fonts** (P3 GDPR): drop OFL-1.1 `.woff2` for Space Grotesk + JetBrains Mono into `SiteHead.astro` (left on Google CDN — no provenance-dirty binaries committed).

## 0.3.0 publish/deprecate runbook (human)
1. Merge the branch; let **`release.yml` publish via CI** (not manual `npm publish`) so provenance attestations attach (the post-publish smoke job asserts them).
2. `npm dist-tag add @nodus-dev/<pkg>@0.3.0 latest` for the 14 formerly-1.0.0 packages (npm won't demote `latest` automatically).
3. `npm deprecate '@nodus-dev/<pkg>@1.0.0' "re-baselined to the synchronized 0.3.x pre-1.0 line; use 0.3.0+"` (and old 0.2.0 core/cli/mcp).
4. **Do NOT run `changeset version`** while the re-baseline changeset is present (it would re-mix versions).

## Verify locally
`pnpm typecheck && pnpm test` (1064) · `pnpm --filter @nodus-dev/site build` · `pnpm bench` · browser E2E: `pnpm dev` then `node scripts/browser-verify.mjs` (69/69). Real cloud icons locally: `pnpm build:icons` — **do NOT commit the regenerated packs; they must stay empty placeholders.**
