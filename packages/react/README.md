# @nodus-dev/react

The React binding for the [`@nodus-dev/core`](../core) diagram engine — a thin host that mounts the
engine to a canvas, plus the panels, hooks, design-system primitives, and PNG export helpers a real
editor UI needs. The engine owns model/render/interaction; this package wires it to the DOM.

## Install

```bash
pnpm add @nodus-dev/react @nodus-dev/core react react-dom
```

## Quickstart

Own the `Editor` with `useNodusEditor` (it builds the editor once and disposes it on unmount), then
mount it with `<Nodus>`:

```tsx
import { Editor } from '@nodus-dev/core';
import { useNodusEditor, Nodus } from '@nodus-dev/react';

export function App() {
  const editor = useNodusEditor(() => {
    const e = new Editor();
    e.createNode({ type: 'rect', x: 40, y: 40, label: 'Web' });
    return e;
  });
  return <Nodus editor={editor} style={{ position: 'absolute', inset: 0 }} />;
}
```

> Don't `new Editor()` at module scope: it leaks (nothing disposes it) and re-instantiating in
> render hands `<Nodus>` a fresh identity every frame. `useNodusEditor` fixes both.

`<Nodus>` mounts the canvas, wires pointer / wheel / keyboard events to the engine's tools, runs a
signal-reactive `requestAnimationFrame` render loop (it repaints only when the scene actually
changes), and hosts the inline label editor and (opt-out) context menu.

## Server-side rendering (Next.js, Remix)

The package is a client component — it ships a `'use client'` banner and its hooks read engine
signals through `useSyncExternalStore` with a server snapshot, so importing it never crashes a
server render. The canvas itself is a browser surface, though: `<Nodus>` only paints inside a layout
effect that runs after hydration. Two ways to keep it client-only:

```tsx
// 1. Next.js App Router — a client-component boundary is enough (the banner marks the module):
'use client';
import { useNodusEditor, Nodus } from '@nodus-dev/react';

// 2. Pages Router / any framework — skip SSR for the canvas entirely:
import dynamic from 'next/dynamic';
const Nodus = dynamic(() => import('@nodus-dev/react').then((m) => m.Nodus), { ssr: false });
```

```tsx
interface NodusProps {
  editor: Editor;
  className?: string;
  style?: React.CSSProperties;
  contextMenu?: boolean;                 // default true
  keyboardScope?: 'host' | 'window';     // default 'host' — see below
  onMount?: (editor: Editor) => void;    // once per editor instance
  onChange?: (info: ChangeInfo) => void;
  onSelectionChange?: (ids: Id[]) => void;
  onCameraChange?: (camera: Camera) => void;
}
```

`onMount`/`onChange`/`onSelectionChange`/`onCameraChange` subscribe to the engine's events; you can pass
fresh closures each render without causing a resubscribe. `<Nodus>` also forwards a `ref` exposing a
`NodusHandle`:

```tsx
import { useRef } from 'react';
import { Nodus, type NodusHandle } from '@nodus-dev/react';

const ref = useRef<NodusHandle>(null);
// ref.current?.canvas  → the <canvas> element
// ref.current?.host    → the focusable host <div>
// ref.current?.focus() → move keyboard focus to this editor
<Nodus ref={ref} editor={editor} />
```

### Keyboard scope

By default (`keyboardScope="host"`) keyboard shortcuts — undo/redo, nudge, zoom, Tab traversal — listen
on the canvas host element, so they only fire while this editor (or its chrome) holds focus. That's the
right choice when several `<Nodus>` instances, or other focusable UI, share a page. Pass
`keyboardScope="window"` for the legacy app-wide behavior (shortcuts fire regardless of focus). The scope
is read once at mount. (Paste always listens on `window`, but in `'host'` scope it ignores pastes unless
the host owns focus.) The default actions dispatch through the shared command registry
(`editor.commands` / `editor.execute`), the same one the command palette and context menu use.

## Reading engine state in React — `useValue`

The engine is signal-based; `useValue(fn)` re-runs `fn` and re-renders the component whenever any
signal `fn` read via `.get()` changes.

```tsx
import { useValue } from '@nodus-dev/react';

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

The second footgun: the getter must return a **stable reference or a primitive**. Snapshots are
compared with `Object.is`, so `useValue(() => editor.selectedIdsArray())` — a fresh array every
call — never compares equal and re-renders forever. Select a primitive (`.size`, an id, a version
counter) or derive a string key (`ids.join(',')`) and parse it outside the getter.

## Styling & opt-out

`<Nodus>` injects a small, zero-network, `[data-nodus-ui]`-scoped base stylesheet on mount
(idempotent). Pass `injectStyles={false}` to skip it entirely and bring your own styles; web fonts
are always a separate opt-in (`injectGlobalStyles({ webFonts: true })`).

## Stability

Pre-1.0: a **minor** bump (0.Y.0) may break, a **patch** (0.0.Z) is additive/fixes only — see the
[stability policy](https://github.com/ahmazin/nodus/blob/main/docs/stability.md).

## Panels

Drop-in, editor-aware components — each takes `editor` and manages its own state through the store:

- **`<Properties>`** — style / geometry / flow inspector for the current selection.
- **`<CommandPalette>`** — command palette. `hotkey` sets the toggle shortcut (default `'mod+k'` — ⌘K /
  Ctrl+K; pass `false` to disable it and open via the `nodus:open-command-palette` window event). Beyond
  its curated `defaultCommands`, it surfaces anything registered on `editor.commands` (e.g. by plugins),
  and its default actions dispatch through `editor.execute`.
- **`<NodusContextMenu>`** — right-click menu (`contextMenuItems` builds the default set).
- **`<Minimap>`** — viewport overview with click-to-pan.
- **`<FlowControls>` / `<FlowScaleEditor>`** — animated-flow authoring for edges (style, direction,
  data-driven color scales).
- **`<CloudIconPicker>`** — searchable AWS/Azure/GCP glyph picker (backed by `@nodus-dev/icons-cloud`);
  `filterCatalog` is the underlying query helper.
- **`showToast(...)`** — transient action feedback.

## Design system

Tokens and primitives are sourced from the core `Theme` atom, so the DOM chrome re-skins with the
canvas. `Theme.appearance` drives light/dark; `modeOfTheme(theme)` resolves the current mode.

```tsx
import { UiTokensProvider, Panel, Button, useUiTokens } from '@nodus-dev/react';

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
`uiTokens`, `uiTokensFor`, `useUiTokens`, `modeOfTheme`.

`injectGlobalStyles()` installs the chrome's cross-cutting rules — `:focus-visible` rings, the
`prefers-reduced-motion` block, and minimal `[data-nodus-ui]` resets. It is idempotent, and the
panels call it themselves on mount, so you rarely call it directly. **It makes no network request:**
text falls back to the system UI font via the `--nodus-font` variable. Web fonts are opt-in — pass
`injectGlobalStyles({ webFonts: true })` to additionally load Space Grotesk / JetBrains Mono from
`fonts.googleapis.com`, or set `--nodus-font` to your own self-hosted family and leave it off.

## PNG export

The engine paints headlessly, so export is a canvas render — no DOM screenshot:

```ts
import { renderPngBlob, copyOrDownloadImage, downloadImage } from '@nodus-dev/react';

const blob = await renderPngBlob(editor, { pixelRatio: 2, padding: 24 });
await copyOrDownloadImage(editor); // clipboard where supported, else download
await downloadImage(editor, 'diagram.png');
```

`canCopyImage()` reports clipboard-image support; `copyImage` / `downloadImage` / `renderPngBlob`
give finer control. All accept `ImageExportOptions` (`pixelRatio`, `padding`, `background`, and
`selection` to export just the current selection's bounds).

## License

MIT.
