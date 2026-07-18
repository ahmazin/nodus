# @nodus/react

The React binding for the [`@nodus/core`](../core) diagram engine — a thin host that mounts the
engine to a canvas, plus the panels, hooks, design-system primitives, and PNG export helpers a real
editor UI needs. The engine owns model/render/interaction; this package wires it to the DOM.

## Install

```bash
pnpm add @nodus/react @nodus/core react react-dom
```

## Quickstart

Create an `Editor`, then mount it with `<Nodus>`:

```tsx
import { Editor } from '@nodus/core';
import { Nodus } from '@nodus/react';

const editor = new Editor();
editor.createNode({ type: 'rect', x: 40, y: 40, label: 'Web' });

export function App() {
  return <Nodus editor={editor} style={{ position: 'absolute', inset: 0 }} />;
}
```

`<Nodus>` mounts the canvas, wires pointer / wheel / keyboard events to the engine's tools, runs a
signal-reactive `requestAnimationFrame` render loop (it repaints only when the scene actually
changes), and hosts the inline label editor and (opt-out) context menu.

```tsx
interface NodusProps {
  editor: Editor;
  className?: string;
  style?: React.CSSProperties;
  contextMenu?: boolean; // default true
}
```

## Reading engine state in React — `useValue`

The engine is signal-based; `useValue(fn)` re-runs `fn` and re-renders the component whenever any
signal `fn` read via `.get()` changes.

```tsx
import { useValue } from '@nodus/react';

function SelectionCount({ editor }: { editor: Editor }) {
  // subscribe to document mutations via the scene-index version atom
  const count = useValue(() => {
    editor.sceneIndex.version.get();
    return editor.selectedIdsArray().length;
  });
  return <span>{count} selected</span>;
}
```

The footgun to know: `.get()` subscribes, `.peek()` does not. A panel that must react to document
changes has to read a signal via `.get()` inside `useValue` — otherwise it silently stops updating.

## Panels

Drop-in, editor-aware components — each takes `editor` and manages its own state through the store:

- **`<Properties>`** — style / geometry / flow inspector for the current selection.
- **`<CommandPalette>`** — ⌘K palette (`defaultCommands` provided; extend with your own `Command[]`).
- **`<NodusContextMenu>`** — right-click menu (`contextMenuItems` builds the default set).
- **`<Minimap>`** — viewport overview with click-to-pan.
- **`<FlowControls>` / `<FlowScaleEditor>`** — animated-flow authoring for edges (style, direction,
  data-driven color scales).
- **`<CloudIconPicker>`** — searchable AWS/Azure/GCP glyph picker (backed by `@nodus/icons-cloud`);
  `filterCatalog` is the underlying query helper.
- **`showToast(...)`** — transient action feedback.

## Design system

Tokens and primitives are sourced from the core `Theme` atom, so the DOM chrome re-skins with the
canvas. `Theme.appearance` drives light/dark; `modeOfTheme(theme)` resolves the current mode.

```tsx
import { UiTokensProvider, Panel, Button, useUiTokens } from '@nodus/react';

function Toolbar({ editor }: { editor: Editor }) {
  const tokens = useUiTokens(editor); // WCAG-AA light + dark
  return (
    <UiTokensProvider tokens={tokens}>
      <Panel>
        <Button variant="primary" onClick={() => editor.undo()}>Undo</Button>
      </Panel>
    </UiTokensProvider>
  );
}
```

Primitives: `Panel`, `Button`, `IconButton`, `Field`, `Row`, `Menu`, `MenuItem`, `Divider`. Tokens:
`uiTokens`, `uiTokensFor`, `useUiTokens`, `modeOfTheme`. Call `injectGlobalStyles()` once to install
the `:focus-visible` rings and reduced-motion stylesheet.

## PNG export

The engine paints headlessly, so export is a canvas render — no DOM screenshot:

```ts
import { renderPngBlob, copyOrDownloadImage, downloadImage } from '@nodus/react';

const blob = await renderPngBlob(editor, { pixelRatio: 2, padding: 24 });
await copyOrDownloadImage(editor); // clipboard where supported, else download
await downloadImage(editor, 'diagram.png');
```

`canCopyImage()` reports clipboard-image support; `copyImage` / `downloadImage` / `renderPngBlob`
give finer control. All accept `ImageExportOptions` (`pixelRatio`, `padding`, `background`, and
`selection` to export just the current selection's bounds).

## License

MIT.
