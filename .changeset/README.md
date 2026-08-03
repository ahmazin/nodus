# Changesets

This directory is managed by [changesets](https://github.com/changesets/changesets) — it holds the
pending release notes for the `@nodus-dev/*` packages. Each Markdown file here describes one change and
the semver bump it warrants; on release, changesets consumes them to bump versions, update the
per-package `CHANGELOG.md`, and cut the release.

## Workflow

Once `@changesets/cli` is installed (a root dev dependency), the loop is:

```bash
pnpm changeset          # answer the prompts → writes a new .changeset/*.md for your change
pnpm changeset version  # apply the pending changesets: bump versions + write CHANGELOG.md
pnpm changeset publish   # publish the bumped packages to npm (maintainers only)
```

Add a changeset in the **same PR** as the change it describes. A PR with no user-facing package
change needs no changeset.

## Conventions

- **`access: public`** — every `@nodus-dev/*` package publishes publicly. The `nodus-example-browser`
  app is `private`, so changesets ignores it automatically.
- **`updateInternalDependencies: patch`** — when a package bumps, its in-repo dependents
  (`workspace:*`) get at least a patch bump so the published graph stays consistent.
- **`baseBranch: main`** — releases are cut from `main`.

See the [changesets docs](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md)
for the full model.
