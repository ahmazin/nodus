# @nodus/cli

The `nodus` CLI — the git-native toolchain for [Nodus](../../README.md) diagrams. It canonicalizes
(`fmt`), renders to PNG (`render`), and semantically diffs (`diff`) `*.nodus.json` files, so diagrams
become artifacts you can code-review. Exit codes are nonzero on failure, so `fmt --check` works as a
CI gate or a pre-commit hook.

## Install

```bash
pnpm add -D @nodus/cli        # provides the `nodus` bin
```

In this monorepo, run it without installing via `pnpm nodus <cmd>` (executed through tsx).

## Commands

```bash
# Canonicalize diagram files in place (stable key order, normalized numbers):
nodus fmt diagrams/architecture.nodus.json

# Verify canonical form without writing — the CI gate (nonzero exit if any file would change):
nodus fmt --check diagrams/*.nodus.json

# Render a diagram to PNG:
nodus render diagrams/architecture.nodus.json --out arch.png --preset infra --scale 2
#   flags: --out <file> · --preset infra|draw|diagrams · --scale <n> · --no-bg · --grid

# Semantic diff between two diagram files (add/remove/change of records):
nodus diff old.nodus.json new.nodus.json
nodus diff old.nodus.json new.nodus.json --json
```

## Programmatic API

The command functions are exported for use in scripts and tests:

```ts
import { fmt, render, diffReport } from '@nodus/cli';

const results = fmt(['a.nodus.json'], { check: true });   // FmtResult[]
const out = await render('a.nodus.json', { out: 'a.png', preset: 'infra' });
const report = diffReport('old.nodus.json', 'new.nodus.json');   // { text, result }
```

Also exported: `canonicalizeFile`, `detectPreset`, and the `FmtResult` / `RenderOptions` / `Preset` /
`DiffReport` types.

## See also

- [`@nodus/core`](../core/README.md) — the canonical serialization these commands wrap.
- Root README's [Git-native diagrams](../../README.md#git-native-diagrams) section and
  `.github/workflows/diagrams.yml` (the CI enforcement).

**Stability: pre-1.0 (0.x) — the public API may change before 1.0.**
</content>
