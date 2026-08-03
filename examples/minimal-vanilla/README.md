# @nodus-dev-examples/minimal-vanilla

The smallest possible Nodus program: build a diagram headlessly, serialize it to canonical JSON, and
print it. No framework, no DOM — just `@nodus-dev/core` + the infra preset.

```bash
pnpm install          # link the workspace packages
pnpm typecheck        # tsc --noEmit
pnpm start            # tsx src/index.ts — prints the canonical *.nodus.json to stdout
```

`src/index.ts` is ~12 lines: create an `Editor`, install the infra preset, add two nodes and connect
them through the one mutation channel (`createNode` / `connect`), then `toCanonicalString(editor.toJSON())`.
Pipe the output to a file to get a git-trackable diagram: `pnpm start > architecture.nodus.json`.
