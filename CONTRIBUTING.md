# Contributing to Nodus

Thanks for your interest in Nodus (`@nodus-dev/*`) — a headless, framework-agnostic, extensible
diagram engine for TypeScript. This guide covers how to set up the repo, the checks your change must
pass, and how releases work. By participating you agree to abide by our
[Code of Conduct](./CODE_OF_CONDUCT.md).

> **Status: pre-1.0 (`0.x`).** APIs may change between minor releases under the
> [stability policy](./docs/stability.md). Small, focused pull requests are much easier to review than
> large ones — if you are planning something substantial, please open an issue or a
> [Discussion](https://github.com/ahmazin/nodus/discussions) first so we can agree on the shape before
> you invest the time.

## Development setup

Nodus is a **pnpm workspace monorepo**. pnpm is managed through
[corepack](https://nodejs.org/api/corepack.html), so you do not install it globally.

```bash
corepack enable          # activates the pnpm version pinned in package.json
git clone https://github.com/ahmazin/nodus.git
cd nodus
pnpm install             # allowBuilds is pinned (esbuild); no other native builds run
```

**Requirements:** Node 20+ (CI runs on Node 22). No global tools beyond corepack are needed.

### The dev loop is source-first — no build step

Each package's `package.json` points `main`/`types` at `./src/index.ts`, and Vite/Vitest alias every
`@nodus-dev/*` import to `packages/*/src`. The example app, the tests, and the `nodus` CLI all run the
**TypeScript source directly**, so editing a package is picked up live with **no `pnpm build`**.
`publishConfig` swaps to `dist/` only at publish time. Please do not add a build step to the inner
loop.

```bash
pnpm dev                 # Vite example app → http://localhost:5188
pnpm test:watch          # vitest in watch mode
pnpm nodus fmt|render|diff <...>   # the nodus CLI, run via tsx
```

## The three gates

There is **no lint step** — `tsc` with `strict` + `noUncheckedIndexedAccess` is the correctness gate.
Before you open a pull request, run the three checks CI enforces:

```bash
pnpm typecheck           # tsc --strict across all packages — the static gate
pnpm test                # vitest run (whole suite)
pnpm verify:render       # headless Skia render + interaction/serialization smoke checks
```

`pnpm verify:all` runs `typecheck + test + verify:render + verify:dist` in one shot — the same bar the
release uses. Run it before requesting review if you touched anything cross-cutting.

### Testing conventions

- **New behavior needs a test that fails without your change.** Bug fixes need a regression test that
  reproduces the bug.
- The test suite runs under **`environment: 'node'` — there is no jsdom.** Pure logic (geometry,
  routing, store invariants, serialization) is covered with plain vitest.
- Anything DOM- or browser-specific (pointer interaction, clipboard, actual paint output) is verified
  by driving the running Vite app with `playwright-core` — see `scripts/browser-verify.mjs` for the
  canonical example. Prefer this over adding a jsdom dependency.
- Do not weaken, skip, or delete an existing test to make the suite pass. If a test looks wrong, say so
  in your PR and explain why rather than changing it silently.

## Architecture norms

A few conventions keep the engine extensible (see [`CLAUDE.md`](./CLAUDE.md) and
[`docs/`](./docs/) for the full picture):

- **New engine behavior belongs in a registered type / router / layout / plugin**, not a `switch`-on-type
  in the core. `@nodus-dev/core` must stay free of DOM and framework imports.
- **Route every model mutation through `store.apply` / editor helpers** so undo, the scene index, and
  the event bus stay in sync — never mutate records in place.
- **Keep serialization canonical.** `*.nodus.json` bytes are a versioned contract; a change to
  canonical output is semver-breaking. The `diagrams` CI workflow enforces canonical form on any PR
  touching `*.nodus.json` and `canonical.test.ts` will fail on drift.

## Changesets — required for user-facing changes

Nodus releases with [changesets](https://github.com/changesets/changesets). **Every pull request that
changes the public behavior of a published package must include a changeset.** CI checks for one, and a
PR that touches published behavior without it is incomplete.

Add one from the repo root:

```bash
pnpm changeset
```

The prompt walks you through it:

1. **Select the affected package(s)** with space, then Enter.
2. **Pick a bump type** — `patch` or `minor`. Under the pre-1.0 `0.x` rules, a breaking change is a
   `minor` and everything else is a `patch` (see
   [`docs/stability.md`](./docs/stability.md#semver-under-0x)). There is no `major` while we are `0.x`.
3. **Write a one-line summary** in the imperative — it becomes the CHANGELOG entry consumers read.

This writes a small Markdown file under `.changeset/`. **Commit it with your change.** You do not run
`changeset version` or publish — a maintainer does that at release time (see
[`RELEASING.md`](./RELEASING.md)).

Docs-only, test-only, tooling, and CI changes that do not alter a published package's behavior do not
need a changeset.

## Submitting a pull request

1. Fork and branch from `mainline`.
2. Make your change, add tests, and run the three gates.
3. Add a changeset if the change is user-facing.
4. Open the PR and fill in the template. Link any related issue.

CI runs typecheck, the test suite, the render/dist verification, the changeset check, and — for PRs
touching `*.nodus.json` — the canonical-form diagram check.

## Licensing of contributions (inbound = outbound)

Nodus is licensed under the [MIT License](./LICENSE). **By submitting a contribution you agree that it
is provided under the same MIT License** that covers the project ("inbound = outbound"), and that you
have the right to license it that way. You retain copyright to your contribution.

We ask that you **sign off** your commits with a
[Developer Certificate of Origin](https://developercertificate.org/) (DCO) line, which certifies you
wrote the patch or otherwise have the right to submit it under the project's license:

```bash
git commit -s -m "your message"     # appends: Signed-off-by: Your Name <you@example.com>
```

The sign-off is recommended today and may become a required, enforced check as the project grows.

> **Note on third-party content.** Some parts of the repo are **not** MIT — notably the cloud-provider
> artwork under `@nodus-dev/icons-cloud` and the elkjs dependency of `@nodus-dev/layout-elk` (EPL-2.0).
> See the root [NOTICE](./NOTICE) before contributing to those areas.

## Reporting bugs, requesting features, and getting help

- **Bugs and feature requests:** open an issue using the templates.
- **Questions, ideas, and help:** use [GitHub Discussions](https://github.com/ahmazin/nodus/discussions)
  and see [SUPPORT.md](./SUPPORT.md).
- **Security vulnerabilities:** do **not** open a public issue. Follow [SECURITY.md](./SECURITY.md).

## Governance

Nodus is currently maintained by a single maintainer; decision-making and the succession posture are
documented in [GOVERNANCE.md](./GOVERNANCE.md) and [MAINTAINERS.md](./MAINTAINERS.md).
