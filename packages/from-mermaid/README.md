# @nodus-dev/from-mermaid

Import a [Mermaid](https://mermaid.js.org/) diagram string into [Nodus](https://github.com/ahmazin/nodus) records. It
reuses the [`@nodus-dev/preset-diagrams`](https://github.com/ahmazin/nodus/tree/main/packages/preset-diagrams) builders (so the result renders
with the diagram node types + theme) and lays the graph out under any registered layout engine.
Deliberately scoped to the three subsets that cover the common cases: `flowchart` / `graph`,
`stateDiagram(-v2)`, and `erDiagram`. Unknown lines are skipped, never thrown.

## Install

```bash
pnpm add @nodus-dev/from-mermaid @nodus-dev/core @nodus-dev/preset-diagrams
# for the default layout used by importMermaid:
pnpm add @nodus-dev/layout-elk
```

> `@nodus-dev/core` is a **peer dependency** — install it alongside so the importer shares your app's single
> engine instance.

## Usage

One-shot: parse, add to the editor, lay out, and fit.

```ts
import { importMermaid } from '@nodus-dev/from-mermaid';
import { elkLayout } from '@nodus-dev/layout-elk';

editor.registerLayout(elkLayout);   // importMermaid defaults to layout 'elk'
await importMermaid(editor, 'graph LR\n A[Start] --> B{OK?} -->|yes| C[Done]');
```

Or just parse to records and handle placement yourself:

```ts
import { fromMermaid } from '@nodus-dev/from-mermaid';

const { kind, direction, records } = fromMermaid('stateDiagram-v2\n [*] --> Idle\n Idle --> Running');
```

`importMermaid(editor, src, opts?)` options: `layout` (engine id, or `false` to skip; default
`'elk'`), `direction` (override), `fit` (zoom-to-fit after layout, default true). The low-level
`parseFlowchart` / `parseStateDiagram` / `parseERDiagram` are exported for hosts that want the
intermediate spec before building.

## Errors

`fromMermaid` follows the shared importer convention:

- **Malformed input throws** a `NodusError` (from `@nodus-dev/core`) with a namespaced `code`:
  `'from-mermaid/parse-failed'` (empty source or an unrecognized diagram header) or
  `'from-mermaid/source-too-large'` (over the ~512 KB byte cap). Match with `isNodusError(e)`, never
  `instanceof`.
- **Partial success is not silent.** A body statement that parses as the right format but matches no
  rule is reported in `ParsedMermaid.issues` (a typed `MermaidIssue { code, message, statement }`, one
  per skipped line), and counted by `skipped` — so you can tell the user *which* line was dropped.

```ts
import { isNodusError } from '@nodus-dev/core';
import { fromMermaid } from '@nodus-dev/from-mermaid';

try {
  const { records, issues } = fromMermaid(src);
  for (const issue of issues) console.warn(issue.message, issue.statement);
} catch (e) {
  if (isNodusError(e) && e.code === 'from-mermaid/parse-failed') {
    // not a Mermaid diagram we understand — show e.message / e.context
  }
}
```

## See also

- [`@nodus-dev/preset-diagrams`](https://github.com/ahmazin/nodus/tree/main/packages/preset-diagrams) — the node/edge types and builders behind the import.
- [Extending Nodus](https://nodus.dev/docs/extending) · [`@nodus-dev/core`](https://github.com/ahmazin/nodus/tree/main/packages/core)

**Stability: pre-1.0 (0.x) — the public API may change before 1.0.**
</content>
