# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Nodus** (`@nodus/*`) is a headless, framework-agnostic, extensible **diagram engine** for TypeScript
— an Excalidraw-class editor built to be customized. It owns *model → layout → render → interact* on a
Canvas-2D surface. The original infra-architecture tool (**InfraCanvas**, the repo/dir name) now ships
as one preset (`@nodus/preset-infra`) on top of the general core.

pnpm workspace monorepo. `@nodus/core` has **zero framework/DOM dependencies**; `@nodus/react` is a thin
binding. The core renders identically in the browser and headless (Skia via `@napi-rs/canvas`).

## Commands

```bash
pnpm install                       # uses corepack pnpm; allowBuilds is pinned (esbuild)
pnpm typecheck                     # tsc --strict across all packages — THIS is the static gate (no eslint/prettier)
pnpm test                          # vitest run (whole suite)
pnpm exec vitest run packages/core/src/__tests__/routing.test.ts   # a single file
pnpm exec vitest run -t "hit test"                                 # tests matching a name
pnpm test:watch                    # vitest watch
pnpm dev                           # Vite example app → http://localhost:5188 (strictPort)
pnpm verify:render                 # headless Skia render → examples/output/*.png + interaction/serialization smoke checks
pnpm verify:all                    # typecheck + test + verify:render
pnpm build                         # scripts/build-all.mjs — tsup per package in dependency order (ESM+CJS+.d.ts)
pnpm nodus fmt|render|diff <...>   # the `nodus` CLI, run via tsx (see below)
```

There is **no lint step** — `tsc` with `strict` + `noUncheckedIndexedAccess` is the correctness gate. Run
`pnpm typecheck` after edits.

### Dev loop is source-first (no build needed)

Each package's `package.json` sets `main`/`types` to `./src/index.ts`, and Vite/Vitest alias every
`@nodus/*` to `packages/*/src`. So the example app, tests, and the CLI all run **TypeScript source
directly** — editing a package is picked up live with no `pnpm build`. `publishConfig` swaps to `dist/`
only for publishing. Don't add a build step to the inner loop.

### Verifying UI / browser behavior

`pnpm test` runs under **`environment: 'node'` — there is no jsdom**. Existing tests cover pure logic
(geometry, routing, store invariants, serialization). Anything DOM- or browser-specific (clipboard,
pointer interaction, actual paint output) is verified by driving the running Vite app with
`playwright-core` against the browsers in `~/.cache/ms-playwright` (`scripts/browser-verify.mjs` is the
canonical example; it asserts create/drag/undo/rename/auto-layout with zero console errors). The example
exposes the live `Editor` at `window.__editor` for this. Prefer this over adding a jsdom dependency.

## Architecture

Reactive record store (the single mutation channel) → a retained `RenderItem` scene index (rbush R-tree)
→ a layered Canvas-2D renderer, with all type-specific behavior in engine-owned **registries**. The
`Editor` (`packages/core/src/editor/`) is the façade that wires these together and hosts the tool manager,
camera, and history.

### One mutation channel — `store.apply(changes, { capture })`

Every change goes through the store. `apply` computes inverse deltas, updates per-record signal atoms
atomically, and notifies the scene index, history, and event bus through one path. Editor helpers
(`createNode`, `setStyle`, `setEdgeRouter`, `updateRecord`, …) are thin wrappers over it.

- **`CapturePolicy` = `'immediately' | 'later' | 'never'`** (`model.ts`) controls undo grouping. A
  discrete action uses `'immediately'` (one undo entry). A continuous gesture (slider drag, color
  scrub) applies with `capture: 'later'` on each `onChange`, then calls `editor.mark()` once on
  release/blur — collapsing the whole gesture into a single undo entry. Match this when adding controls.
- **Edges own their endpoints** (`from`/`to` on the edge record); back-refs and routed polylines are
  derived. Moving a node reflows its edges; deleting a node cascades its edges.
- **Three distinct version counters**: `record.version` (diff/cache keys), the scene-index `version`
  atom (render invalidation), and `schemaVersion` (serialization migration). Keep them separate.

### Signals substrate — `.get()` subscribes, `.peek()` does not

`packages/core/src/signals/` is a tiny dependency-free reactive engine (`atom`/`computed`/`effect`/
`reaction`/`transact`). The rule that everything depends on: reading `.get()` inside a reactive context
registers a dependency; `.peek()` reads without subscribing. `transact` batches writes and **rolls back
all of them** if the body throws.

This is the most common footgun. In React, `useValue(fn)` re-runs `fn` and re-renders when any signal
`fn` read via `.get()` changes — so a component that must react to document mutations reads
`editor.sceneIndex.version.get()` inside `useValue`, while `editor.selectedIdsArray()` (which uses
`peek`) does not subscribe on its own. Getting this wrong = a panel that silently stops updating.

### Scene index & hit-testing

`packages/core/src/scene-index/` keeps a retained `RenderItem` per record in an rbush R-tree. It drives
viewport culling, marquee, paint order (`comparePaint` — edges under nodes, then z), and **two-phase
hit-testing**: R-tree broad phase, then per-geometry `geometry.hitPoint(p, tolerance)` narrow phase.
Tolerances are in **world units**, so callers pass `px / camera.z` (e.g. pointer selection uses `5/z`,
context menu `6/z`). Edges are thin — a hit needs the cursor within tolerance of the routed polyline.

### Registries & the four extension axes

Type-specific behavior is data/objects registered on the editor, never `switch`-on-type in the core:

- **Node/edge types** — a `NodeUtil` object (`getGeometry` is the single source for hit-test/bounds/cull,
  plus `getPorts` and `draw`); `editor.registerNodeType(util)`.
- **Routers** — `RouterRegistry` resolves `edge.props.router` (`straight`/`orthogonal`/`bezier`) to a
  function that turns endpoints into a polyline; unset falls back to the util's default.
- **Layouts** — `editor.registerLayout(engine)` then `await editor.layout('dagre', { direction: 'LR' })`.
  Adapters live in `@nodus/layout-{dagre,tree,force,elk}`.
- **Plugins** — `editor.use(plugin)`; a plugin gets an `EngineHost` to register types/tools/themes/
  layouts/overlays and hook the store & event bus (`@nodus/plugin-freehand` is a full example).

### Rendering & theming

The renderer (`packages/core/src/renderer/`) draws through a `Ctx2D` abstraction, so the same code paints
to a DOM canvas or a Skia canvas. `editor.paintRegion(ctx, region, ratio, opts)` is the export/preview
entry (used by PNG export and headless render). Themes are **data**: `resolveTokens(theme, { state,
overlay, focused }, type)` layers slices at draw time —
`base < byType[type] < states[state] < overlays[overlay] < focus`. Swapping the theme atom re-skins every
node in one frame.

### Git-native diagrams (the product moat)

`@nodus/core` has **deterministic/canonical serialization**; diagrams are stored as `*.nodus.json`. The
`nodus` CLI (`packages/cli`, run via tsx: `pnpm nodus`) offers `fmt [--check]` (canonicalize/verify),
`render` (headless PNG), and `diff` (semantic). `.github/workflows/diagrams.yml` enforces canonical form
on any PR touching `*.nodus.json` and posts rendered previews — "diagrams you can code-review." When
touching serialization, keep output canonical (stable key order, normalized numbers) or the diff CI and
`canonical.test.ts` will fail.

## Packages (map)

- `core` — the whole engine (signals, store, scene-index, camera, geometry, routing, tools, registries,
  renderer, theme, history, diff, serialization, editor). Deps: `rbush` + vendored signals.
- `react` — `<Nodus>` canvas host (wires pointer/wheel/keyboard to tools, runs a signal-reactive rAF
  loop, hosts the inline label editor), `<Minimap>`, `<CommandPalette>` (⌘K), context menu, `<Properties>`,
  flow controls, `useValue`, clipboard/PNG export.
- `preset-infra` — infra node types + dark theme + the `InfraCanvas({ model, mode, overlays })` façade.
- `preset-diagrams` · `preset-draw` — general diagram types / drawing tools.
- `layout-{dagre,tree,force,elk}` — auto-layout adapters. `icons-cloud` — curated AWS/Azure/GCP glyphs.
- `from-mermaid` · `text-to-diagram` · `import-infra` — importers (Mermaid, LLM tool schema, Terraform/K8s).
- `mcp` — MCP server exposing the engine as tools. `persistence` — snapshot storage. `cli` — the `nodus` CLI.

## Conventions

- New engine behavior belongs in a registered type/router/layout/plugin, not a core `switch`. Keep the
  core free of DOM and framework imports.
- Route mutations through `store.apply` / editor helpers so undo, the scene index, and events stay in sync
  — don't mutate records in place.
- After changes: `pnpm typecheck` always; `pnpm test` for logic; a `playwright-core` drive of the Vite app
  for anything visual/interactive.
- `BUGS.md` at the root is the working bug tracker (checkbox list).

# Agent Team Protocol

These rules apply whenever this session is part of an agent team, as lead or teammate.
Teammates: you did not see the conversation that produced your tasks. Your task
description and the contract file are your source of truth. If they are materially
ambiguous, message the lead. If the ambiguity is trivial, choose the reasonable
reading and log it under "assumptions" in your completion report.

## Roles

- **Lead**: decomposes work, writes ownership into tasks, approves plans, integrates,
  and is the only agent that runs git write operations. The lead coordinates; it does
  not implement tasks assigned to teammates.
- **Teammate**: claims tasks, implements within its ownership boundary, verifies with
  evidence, reports honestly. One task in progress at a time.

## 1. Ownership — one writer per file

- Every task description MUST contain an `Owns:` list of files/directories. The lead
  writes this at task creation. A task without an ownership list is not ready to claim.
- A teammate may create or edit ONLY paths in its own `Owns:` list. If you need a
  change in a file you don't own — even a one-line fix — message the owner or ask the
  lead to create a task. Never edit another agent's files.
- Lead-owned by default (high contention): `go.mod`/`go.sum`, `Cargo.toml`/`Cargo.lock`,
  `package.json` + lockfiles, CI workflows, Terraform files, DB migrations, and shared
  contract/type files.
- Findings, research notes, review comments: write to your own file
  (`notes/<your-name>.md`). Never concurrently edit a shared document; the lead
  synthesizes.

## 2. Contract-first parallelism

- Before implementation tasks start, the lead creates a **contracts task**: shared
  types, function signatures, API request/response shapes, error conventions, and
  module boundaries, written to a contract file. Record the baseline commit SHA and
  the team branch name in this file.
- Every implementation task declares a dependency on the contracts task, so nothing
  can be claimed until contracts are frozen.
- Changing a frozen contract requires messaging the lead AND every affected owner
  before editing it. Silent contract drift is the primary integration failure; treat
  it as an incident.

## 3. Git and shared-tree discipline

- Before spawning any teammate, the lead creates a dedicated branch
  (`team/<topic>`) from a clean baseline and records the baseline SHA in the
  contract file. Team work never happens directly on `main`. Recovery from a failed
  integration is `git reset --hard <baseline>`, not incremental unpicking.
- All agents share one checkout unless explicitly told otherwise. Therefore:
  **only the lead runs git write operations** (add, commit, stash, checkout, restore).
  Teammates edit files; they do not stage or commit.
- The lead stages by explicit path (`git add <paths>`) — never `git add .` or `-A`,
  because the tree contains other agents' in-progress work.
- The lead commits at integration checkpoints, after quality gates pass, then
  messages all teammates that the tree moved.
- Re-read any file immediately before editing it. The tree is shared; a copy you
  read earlier may be stale.
- Runtime contention: do not start long-running processes (dev servers, containers,
  local databases, emulators) unless your task explicitly assigns them, with
  explicit ports. Tear down anything stateful you started before completing the task.
- No dependency-mutating commands (`go get`, `cargo add`/`update`, `npm`/`pnpm
  install <pkg>`, lockfile regeneration). Dependency changes happen only through a
  lead-owned task.
- Nobody rebases, amends pushed commits, force-pushes, or pushes at all without the
  human's explicit approval.

## 4. Definition of Done — verification before completion

A task is NOT complete until every applicable gate passes. "It should work" and
"looks correct" are not evidence. Run the commands; report real output.

**Teammates gate the scope they own.** The shared tree contains other agents'
in-progress work, so full-repo runs will fail on code that isn't yours. If a gate
fails in code outside your ownership, report it to the lead with the output — do
not fix it, and do not mark your task complete on the strength of "the failure
isn't mine" without the lead's acknowledgment.

| Present | Teammate gates (owned scope) |
| --- | --- |
| `go.mod` | `gofmt -l <owned>` (empty) · `go vet ./<owned>/...` · `go build ./<owned>/...` · `go test -race ./<owned>/...` |
| `Cargo.toml` | `cargo fmt --check` · `cargo clippy -p <crate>` · `cargo test -p <crate>` |
| `package.json` | `npx tsc --noEmit` (read-only, whole project) · owned tests via the runner's path filter |
| `pyproject.toml` / `*.py` | `ruff check <owned>` · `pytest <owned paths>` |
| `*.tf` | `terraform fmt -check` · `terraform validate` · `terraform plan` — NEVER apply |

**The lead runs the full-repo suite** (`./...`, the whole test script) at every
integration checkpoint. Cross-cutting breakage is caught there, not in teammate gates.

**Universal gates:**

- New behavior has at least one test that fails without your change. Bug fixes
  include a regression test reproducing the bug.
- No debug leftovers: `console.log`, stray `fmt.Println`, `dbg!`, bare `print(`,
  commented-out code, or TODOs without an owner.
- No swallowed errors. Go: no discarded error returns; wrap with `%w` and context.
  All languages: errors surface with enough context to diagnose.
- If you changed a public interface, update its doc comment and any README section
  that documents it.
- Dependency-changing tasks (lead-owned) additionally run the vulnerability scan —
  `govulncheck ./...`, `cargo audit`, or `npm audit` — and include results in the
  report to the human.
- NEVER weaken, skip, or delete a test to make the suite pass. If a test looks wrong,
  message the lead with your reasoning; do not touch it unilaterally.

**Completion report** — post to the lead when marking a task complete:

1. Files changed (must be a subset of your `Owns:` list)
2. Commands run and their actual results (pass/fail, counts)
3. Assumptions made where the task was underspecified
4. Deviations from the approved plan, if any
5. Open risks or follow-ups

Then mark the task complete **immediately**. Stale task status blocks dependent
tasks and stalls the whole team.

**Task failure states:**

- If you cannot finish a claimed task, do not abandon it silently. Report failure
  to the lead with what you tried and observed, and ask for the task to be reset or
  reassigned. A claimed-and-dead task blocks all of its dependents.
- When no unblocked task is claimable, report idle to the lead and stop. Never
  invent work to stay busy.

## 5. Communication protocol

- Message the lead when: you are blocked, the task is materially larger than
  described, you need a file outside your ownership, a contract needs changing, or
  you found a defect outside your scope.
- Out-of-scope defects: report them; do not fix them. Drive-by fixes cause ownership
  collisions. The lead files a new task.
- Bounded retries: after 2 failed attempts at the same fix, stop. Write down what you
  tried and what you observed, then escalate. Do not thrash.
- Status honesty: report actual state, including partial failure. A truthful
  "80% done, two tests failing, here's why" beats a false "done" every time.

## 6. Lead conduct

- Size tasks as self-contained deliverables: a function, a module, a test file, a
  review. Target 5–6 tasks per teammate; declare dependencies explicitly.
- Delegate. Do not implement teammates' tasks yourself; wait for all teammates to
  finish before synthesizing.
- Plan approval: approve only plans that list the files to be touched (within the
  task's ownership), the test strategy, and known risks. Reject plans that touch
  auth, crypto, key management, payments, or infrastructure without explicit tests.
  Reject any plan whose file list exceeds its ownership.
- Reap orphans: an in-progress task whose teammate is unresponsive gets inspected
  (is the work actually done?), then reset or reassigned. Do not let a dead claim
  block the dependency graph.
- Integration: after all tasks complete, run the full gate suite once on the
  integrated tree, then review the combined diff for contract mismatches before
  closing out.
- Close-out report to the human, always, before declaring the session done: team
  branch and baseline SHA, summary of the integrated diff, full-suite gate results,
  dependencies added, open risks, and every action deferred to the human (pushes,
  applies, migrations).
- If a teammate errors out or goes quiet, inspect its transcript and redirect or
  respawn it. Do not silently absorb its work.

## 7. Security and rigor floor (non-negotiable)

- Never read, print, log, or commit secrets: `.env*`, `*.tfstate*`, `*.tfvars`,
  private keys, tokens, credentials. If a secret appears in any output, redact it
  and alert the human immediately.
- Never run: `terraform apply`/`destroy`, `kubectl delete`, database migrations
  against any non-local target, `git push --force`, or bulk file deletion. These
  require the human, always, regardless of permission mode.
- No side effects visible outside this repository without the human's explicit
  approval: sending email or messages, publishing content, creating tickets or PRs,
  posting to third-party APIs, or any MCP tool call that writes to an external
  system.
- No new dependencies without lead approval, and the lead surfaces every new
  dependency to the human. Each dependency is supply-chain surface and lockfile
  contention.
- Cryptography: vetted standard libraries only. No hand-rolled primitives, no custom
  protocols. Constant-time comparison for any secret material. Any change touching
  crypto, auth, or key handling must state its key-management approach in the plan.
- Prefer the smallest change that satisfies the task. No opportunistic refactors
  inside feature tasks — propose them as separate tasks instead.
