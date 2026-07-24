# @nodus/preset-infra

The infra-architecture preset for [Nodus](https://github.com/OWNER/nodus) — the **InfraCanvas** seed as one preset on
top of the general engine. It ships six semantic node types (`service`, `db`, `cache`, `queue`, `lb`,
`edge`) with icons, dark/light themes, the connector edge, Freeform / Reveal / Stages mode adapters,
and the high-level `InfraCanvas({ model, mode, overlays })` façade. Use it when you want an
architecture diagram from a friendly `{ nodes, edges }` model instead of wiring records by hand.

## Install

```bash
pnpm add @nodus/preset-infra @nodus/core
```

> `@nodus/core` is a **peer dependency** — install it alongside so the preset shares your app's single
> engine instance.

## Usage

Register the preset onto a bare editor:

```ts
import { Editor } from '@nodus/core';
import { installInfraPreset } from '@nodus/preset-infra';

const editor = new Editor({ viewport: { w: 1200, h: 700 } });
installInfraPreset(editor);   // six infra.* node types + connector edge + dark theme

const api = editor.createNode({ type: 'infra.service', label: 'API', x: 0, y: 0 });
const db = editor.createNode({ type: 'infra.db', label: 'Postgres', x: 300, y: 0 });
editor.connect({ kind: 'node', nodeId: api, portId: 'out' }, { kind: 'node', nodeId: db, portId: 'in' });
```

Or drive the whole thing from a model with the façade (great for React and headless render):

```ts
import { InfraCanvas } from '@nodus/preset-infra';

const { editor, toPNG, toJSON, dispose } = InfraCanvas({
  model: {
    nodes: [
      { key: 'api', type: 'service', label: 'API', x: 0, y: 0 },
      { key: 'db', type: 'db', label: 'Postgres', x: 300, y: 0 },
    ],
    edges: [{ from: 'api', to: 'db' }],
  },
  mode: 'freeform',   // 'freeform' | 'reveal' | 'stages'
});
```

`InfraCanvas` returns `{ editor, render, toPNG, toJSON, on, dispose }` (plus `unlock` in reveal mode
and `advance` in stages mode). `modelToRecords(model, overlays?)` is exported if you want the records
without the façade. In the model, a bare `type` like `service` is mapped to the `infra.service` node
type.

## Exports

`installInfraPreset`, `InfraCanvas`, `modelToRecords`, `infraNodeUtils`, `infraConnectorUtil`,
`darkInfraTheme`, `infraLightTheme`, `INFRA_TYPES`, `infraTypeKey`, `ACCENTS`, and the mode adapters
`freeformMode` / `revealMode` / `stagesMode`.

## See also

- [Extending Nodus](https://nodus.dev/docs/extending) — write your own node/edge types, routers, layouts, plugins.
- [`@nodus/core`](https://github.com/OWNER/nodus/tree/main/packages/core) · [`@nodus/react`](https://github.com/OWNER/nodus/tree/main/packages/react) for the browser host.

**Stability: pre-1.0 (0.x) — the public API may change before 1.0.**
</content>
