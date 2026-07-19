# @nodus/preset-diagrams

General diagram node/edge types for [Nodus](../../README.md), plus builders that turn friendly specs
into records. Ships types for flowcharts (`pill` / `process` / `decision`), state machines (`state`),
ERDs (`table`), org charts (`card`), and image nodes (`icon`), a theme that colours each type, and
`buildFlowchart` / `buildStateMachine` / `buildERD` / `buildOrgChart`. Use it when you want classic
diagram shapes rather than the infra preset.

## Install

```bash
pnpm add @nodus/preset-diagrams @nodus/core
```

## Usage

```ts
import { Editor } from '@nodus/core';
import { installDiagrams, buildFlowchart } from '@nodus/preset-diagrams';

const editor = new Editor();
installDiagrams(editor);   // registers the diagram node/edge types + applies diagramsTheme

const records = buildFlowchart({
  steps: [
    { id: 'a', kind: 'start', label: 'Start' },
    { id: 'b', kind: 'process', label: 'Do work' },
    { id: 'c', kind: 'decision', label: 'OK?' },
    { id: 'd', kind: 'end', label: 'Done' },
  ],
  links: [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'c', to: 'd', label: 'yes' },
  ],
});

editor.addRecords(records);
// records are unpositioned — run a registered layout to place them:
// await editor.layout('elk', { direction: 'TB' });
```

`installDiagrams(editor, { theme? })` accepts an optional theme override (`diagramsTheme` /
`diagramsLightTheme` are exported). The builders each return `NodusRecord[]`, so you can add them to an
editor, feed them to a layout, or serialize them directly.

## Exports

Builders `buildFlowchart` / `buildStateMachine` / `buildERD` / `buildOrgChart` (with their spec types
`FlowStep`, `FlowLink`, `StateSpec`, `Transition`, `TableSpec`, `OrgPerson`), `installDiagrams`,
themes `diagramsTheme` / `diagramsLightTheme`, the util arrays `diagramNodeUtils` / `diagramEdgeUtils`,
and the image-node helpers (from `./image`).

## See also

- [`@nodus/from-mermaid`](../from-mermaid/README.md) — reuses these builders to import Mermaid text.
- [`docs/EXTENDING.md`](../../docs/EXTENDING.md) · [`@nodus/core`](../core/README.md)

**Stability: pre-1.0 (0.x) — the public API may change before 1.0.**
</content>
