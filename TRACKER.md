# Nodus — Work Tracker

The single source of **open / pending** work. This is the board agents pick tasks from.
Closed work is not re-listed here — it lives in git history and in
[`docs/audits/PRR-REMEDIATION-REPORT.md`](docs/audits/PRR-REMEDIATION-REPORT.md) (point-in-time record).

- **Snapshot:** branch `team/prr-remediation` → **[PR #2](https://github.com/ahmazin/nodus/pull/2)** (unmerged).
  Gates green: `pnpm typecheck` · `pnpm test` **1064/1064** · site build · `browser-verify` **69/69** · `pnpm bench`.
- **Priority:** P0 (launch-blocking) → P3 (nice-to-have). **Actor:** 🧑 human-only · 🤖 agent-ready · ⚖️ needs a decision first.

## How agents use this board

1. Pick a **🤖 agent-ready** task whose **Deps** are met. Don't pick 🧑 or ⚖️ tasks.
2. Follow the **Agent Team Protocol** in `CLAUDE.md`: your `Owns:` list is your single-writer scope
   (never edit outside it), meet the Definition-of-Done gates, and only the lead commits.
3. A task is claimable only if it has an `Owns:` list — if one is missing, ask the lead to add it, don't guess.
4. When done, check the box, append `— done <short-sha>`; never delete a line (keep the trail).
5. New work → add a task here first (with `Owns:` + Accept + Deps) before writing code.

---

## A. Launch gating — 🧑 human-only (not agent-claimable)

From the report's HUMAN-ONLY runbook. These change GitHub/npm/legal state, so an agent must not do them.

- [ ] **A1 · P0** Merge **PR #2** → `mainline` (branch is `MERGEABLE`; red CodeQL/guardrails checks are pre-existing on `mainline`, not blocking).
- [ ] **A2 · P0** Enable **GitHub Pages** (Settings → Pages → Source = *GitHub Actions*); verify `/nodus/`, `/nodus/docs/`, `/nodus/playground/` load.
- [ ] **A3 · P1** **Publish/deprecate the 0.3.0 line** via `release.yml` (not manual `npm publish`); `dist-tag` the 14 formerly-1.0.0 packages; `npm deprecate` the old 1.0.0/0.2.0. See report runbook.
- [ ] **A4 · P1** **Branch protection** on `mainline`: require `verify` + `dist-consume` + `browser-e2e` + site build.
- [ ] **A5 · P1** **icons-cloud publish decision** (legal): confirm redistribution posture, then empty `provenance.json`→`[]`, drop `private:true`/`_publishHold`, add `publishConfig.access:"public"`.
- [ ] **A6 · P2** **"Nodus" trademark clearance** + owned-origin decision (github.io vs domain). If origin changes: update `apps/site/src/config.ts`, `astro.config.mjs`, `typedoc.json`.
- [ ] **A7 · P2** Enable **GitHub Discussions**; set ~10 repo **topics** + **homepage** field.
- [ ] **A8 · P2** Delete the 17 stale `@ahmazin/*` git **tags** + GitHub Releases.
- [ ] **A9 · P2** Add an **npm co-owner / credential escrow** for `@nodus-dev` (bus-factor 1).
- [ ] **A10 · P3** Swap CoC/SECURITY contact from `@ahmazin` to a dedicated alias (marked in the files).

---

## B. Ready for an agent — 🤖

### B1 · P1 · Fix pre-existing ReDoS regexes 🤖
- **Why:** 5 open CodeQL `js/polynomial-redos` (high) alerts, also present on `mainline` — surfaced on PR #2 CI. Real (polynomial) ReDoS on long all-digit input.
- **Owns:** `packages/core/src/renderer/svg-context.ts` (line ~132), `packages/core/src/flow-format.ts` (~52), `packages/from-mermaid/src/index.ts` (~292/307/363), + one regression test file (new, under the owning package's `__tests__`).
- **Do:** replace each ambiguous `\d*\.?\d+`-style pattern with a non-backtracking equivalent (e.g. `/([\d.]+)px/` + `parseFloat`, or anchored alternation). Preserve accepted inputs.
- **Accept:** `pnpm typecheck` + `pnpm test` green; a test that feeds a long adversarial string and asserts bounded time / correct parse; CodeQL no longer flags these lines.
- **Deps:** none. (Not launch-blocking — branch protection isn't on — but clears the red check.)

### B2 · P3 · Self-host site fonts (GDPR) 🤖 ⚖️needs human OK (commits binaries)
- **Why:** Space Grotesk + JetBrains Mono load from the Google CDN (a P3 GDPR/provenance note). Report deliberately left them on CDN to avoid committing binaries.
- **Owns:** `apps/site/src/components/SiteHead.astro` + the `.woff2` assets under `apps/site/public/fonts/` (new).
- **Do:** drop OFL-1.1 `.woff2` for both families, self-host via `@font-face`, remove the Google `<link>`s.
- **Accept:** `pnpm --filter @nodus-dev/site build` green; no `fonts.googleapis.com`/`gstatic` requests; fonts render in a browser check.
- **Deps:** human approval to commit font binaries (provenance).

### B3 · P2 · i18n the command-palette / context-menu *item* labels 🤖 ⚖️needs a design decision
- **Why:** the i18n sweep did the container aria for these two but left their command/menu *item* labels hardcoded (deliberate scope-out). ~40 labels.
- **Owns:** `packages/react/src/command-palette.tsx`, `packages/react/src/context-menu.tsx`, `packages/react/src/messages.tsx` (+ the i18n test).
- **Decision needed first:** where command labels live — a new `ReactMessages.commands`/`menu` namespace, vs extending `CoreMessages.commands` so any host reuses them. Pick one, record it, then wire.
- **Accept:** overrides change the rendered labels (SSR test); `pnpm test` + `typecheck` green.
- **Deps:** the namespace decision above.

---

## C. Deferred with evidence — ⚖️ decide before picking

### C1 · P1 · Pan fast-path (the O(N) camera-pan cliff)
- **State:** attempted → **evidence-backed no-go** (2026-09-30). The chrome/content split works and kills the cliff, but the renderer AAs gradient fills at **absolute device coordinates**, so two *direct* paints at integer-pixel-shifted cameras already differ ~5 LSB — below a strict `maxDiff≤1` blit gate. Masked today by `maxFps=30`. Full diagnosis: `apps/site/src/pages/docs/performance.md`.
- **Two paths (pick one to un-defer):**
  - **C1a 🤖 (high blast radius):** make content rasterization integer-shift-invariant — bake only `cam.z` into the content CTM, apply integer `cam.x/y` as a whole-pixel post-translate (or snap gradient origins to a camera-independent lattice); then drop in the prototyped split. Will re-baseline goldens. `Owns:` `packages/core/src/renderer/**`, `packages/core/src/editor/index.ts`, `scripts/bench.mjs`.
  - **C1b ⚖️ (policy):** consciously accept the ~5-LSB *active-pan* drift (imperceptible; settles byte-exact on pan-stop) and ship the split under a relaxed pan gate. Human fidelity-bar call, then 🤖 implements.
- **Owner chose:** leave deferred (2026-09-30).

### C2 · P2 · Promote golden-image CI to blocking
- **State:** non-blocking until baselines are regenerated **on the CI runner** (sandbox vs CI Skia AA determinism uncharacterized). Not doable from the sandbox (local render collapses).
- **Do (on CI):** regenerate `scripts/golden/baseline/*.png` on the runner, commit as source of truth, drop `continue-on-error`.
- **Deps:** CI-runner access; a deliberate baseline regen.

---

## D. Backlog — post-launch (coarse; spec `Owns:`/Accept when picked)

**Next — reach & migration**
- [ ] Framework-free DOM host extracted from `nodus-host.tsx`; vanilla interactive example + CDN docs; React 19 verification leg; scope Vue/Svelte bindings. *(Top Blocker #4)*
- [ ] `@nodus-dev/from-excalidraw` + draw.io import. *(Top Blocker #8)*
- [ ] System-clipboard copy/paste interop; drag-and-drop file import.
- [ ] Publish the Playground shell as a degit template / `@nodus-dev/shell` starter.
- [ ] Ship real i18n **translations** on top of the message-override foundation (English defaults exist; no locales yet).
- [ ] Comparison page maintenance + collaboration-position FAQ (both exist; keep current).

**Later — depth**
- [ ] Zoom LOD (drop labels/detail below a zoom threshold).
- [ ] `yjs`-style collaboration adapter over the change-delta stream (opt-in extension, not core).
- [ ] Screen-reader structural mirror of canvas content (beyond selection announcements).
- [ ] CLI `import` + `--format svg`; `toMermaid` export; sequence-diagram Mermaid subset.
- [ ] Parity fills: SVG editing backend, images (hashed sidecar), align/distribute, eraser, stencils, multi-select transforms, resize snap/aspect-lock, waypoint-index metadata, hyperlink field, laser pointer.
- [ ] IndexedDB persistence store; VS Code `.nodus.json` previewer; marketplace GitHub Action (fmt-check + render + PR previews).

**Security/ops tail**
- [ ] Triage the repo's **Dependabot** alerts (GitHub reports 32 on the default branch: 3 critical / 13 high) — separate from this PR's diff.
- [ ] Investigate the `guardrails/scan` failure (external scanner; likely repo-wide findings, not diff-scoped).
