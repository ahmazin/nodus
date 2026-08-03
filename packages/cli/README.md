# @nodus-dev/cli

The `nodus` CLI — the git-native toolchain for [Nodus](../../README.md) diagrams. It canonicalizes
(`fmt`), renders to PNG (`render`), and semantically diffs (`diff`) `*.nodus.json` files, so diagrams
become artifacts you can code-review. Exit codes are nonzero on failure, so `fmt --check` works as a
CI gate or a pre-commit hook.

### `fmt` exit codes

Canonicalization can lose data: `restore()` drops dangling edges and malformed records and coerces
non-finite numbers. `fmt` will **not** silently rewrite a file over that loss — it leaves the file
untouched and reports it, unless you pass `--force` (which writes and prints exactly what was
dropped/stripped). A file written by a **newer** Nodus is refused outright.

| Code | Meaning |
| ---- | ------- |
| `0`  | clean (formatted, or already canonical) |
| `1`  | `--check`: at least one file would be reformatted |
| `2`  | refused: a file's canonical form would lose data and was **not** rewritten (use `--force`) |
| `3`  | a file was written by a newer Nodus than this CLI understands — upgrade `@nodus-dev/cli` |

`render`, `diff`, and `drift` also exit `3` on a too-new file, and print a one-line stderr summary
(`loaded N record(s); dropped 2 dangling edge(s), …`) when a load drops or repairs anything, while
still proceeding.

## Install

```bash
pnpm add -D @nodus-dev/cli        # provides the `nodus` bin
```

In this monorepo, run it without installing via `pnpm nodus <cmd>` (executed through tsx).

## Commands

```bash
# Canonicalize diagram files in place (stable key order, normalized numbers):
nodus fmt diagrams/architecture.nodus.json

# Verify canonical form without writing — the CI gate (nonzero exit if any file would change):
nodus fmt --check diagrams/*.nodus.json

# Rewrite even when canonicalization would drop/repair data (prints exactly what is lost):
nodus fmt --force diagrams/hand-edited.nodus.json

# Render a diagram to PNG:
nodus render diagrams/architecture.nodus.json --out arch.png --preset infra --scale 2
#   flags: --out <file> · --preset infra|draw|diagrams · --scale <n> · --no-bg · --grid

# Semantic diff between two diagram files (add/remove/change of records):
nodus diff old.nodus.json new.nodus.json
nodus diff old.nodus.json new.nodus.json --json

# Either side of a diff may be a `REV:path` git spec, resolved with `git show` (no shell):
nodus diff HEAD:diagrams/arch.nodus.json diagrams/arch.nodus.json   # committed vs working copy
nodus diff main:arch.nodus.json HEAD:arch.nodus.json                # branch vs branch
```

## Programmatic API

The command functions are exported for use in scripts and tests:

```ts
import { fmt, render, diffReport } from '@nodus-dev/cli';

const results = fmt(['a.nodus.json'], { check: true });   // FmtResult[]; add { force: true } to write over loss
const out = await render('a.nodus.json', { out: 'a.png', preset: 'infra' });
const report = diffReport('HEAD:old.nodus.json', 'new.nodus.json');   // { text, result, loadWarnings }
```

Each `FmtResult` carries `changed`, `wrote`, `lossy`, `dropped`, `issues`, and `tooNew` so a script can
make the same write-safety decision the CLI does. Also exported: `canonicalizeFile`, `detectPreset`,
`driftReport`, `readSource`, `main`, and the `FmtResult` / `CanonicalizeResult` / `RenderOptions` /
`Preset` / `DiffReport` / `DriftCliReport` types.

## See also

- [`@nodus-dev/core`](../core/README.md) — the canonical serialization these commands wrap.
- Root README's [Git-native diagrams](../../README.md#git-native-diagrams) section and
  `.github/workflows/diagrams.yml` (the CI enforcement).

**Stability: pre-1.0 (0.x) — the public API may change before 1.0.**
</content>
