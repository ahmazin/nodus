---
layout: ../../layouts/DocsLayout.astro
title: React binding
description: Mount the engine with <Nodus>, own its lifecycle with useNodusEditor, read reactive state with useValue, and drop in the panel components.
---

`@nodus/react` is a thin binding over `@nodus/core`: a canvas host that wires pointer/wheel/keyboard to
the editor's tools and runs a signal-reactive render loop, a lifecycle hook, a reactive read hook, and
a set of panel components. The engine does the work; this package connects it to React.

> **Pre-1.0 (0.x): this API may change before 1.0.** See [Versioning](/docs/versioning).

## Mounting

`useNodusEditor` owns an `Editor` across the component's lifetime — it builds the editor once and
disposes it on unmount. Render it with `<Nodus>`:

```tsx
import { Nodus, useNodusEditor } from '@nodus/react';
import { Editor } from '@nodus/core';
import { installInfraPreset } from '@nodus/preset-infra';

export function App() {
  const editor = useNodusEditor(() => {
    const e = new Editor();
    installInfraPreset(e);
    return e;
  });
  return <Nodus editor={editor} style={{ height: '100vh' }} />;
}
```

`<Nodus>` gives you pan/zoom, select/multi-select, drag, create, connect, inline-rename, delete, and
delta-based undo/redo. It accepts `className` and `style`.

## Reading reactive state — `useValue`

`useValue(fn)` re-runs `fn` and re-renders when any signal it read via `.get()` changes. This is the
one rule the binding depends on: `.get()` subscribes, `.peek()` does not (see
[Concepts](/docs/concepts)). A component that must react to document mutations reads
`editor.sceneIndex.version.get()` inside `useValue`.

```tsx
const count = useValue(() => {
  editor.sceneIndex.version.get();      // subscribe to document changes
  return editor.selectedIdsArray().length;
});
```

> Selectors that return a fresh object/array each call need a stable snapshot (return a primitive, or
> a stably-keyed value) — otherwise React's `useSyncExternalStore` cache thrashes.

## Panels

The package ships ready-made panel components that take the `editor` and drive it through the same
public API — drop in the ones you need:

- **`<Properties>`** — edit the selected records' style and props.
- **`<Minimap>`** — a viewport-tracking overview.
- **`<CommandPalette>`** — ⌘K command launcher.
- **`<NodusContextMenu>`**, **`<LayersPanel>`**, **flow controls**, and the cloud-icon picker.

## Export & clipboard

The package includes PNG export and copy/paste helpers built on the core's `toPNG` and the canonical
serializer, so a React app can export the current view or round-trip selections through the clipboard.

## Server-side rendering

`@nodus/react` is a client component: the published build ships a `'use client'` banner, and its hooks
read engine signals through `useSyncExternalStore` **with a server snapshot** (`getServerSnapshot`), so
importing it never crashes a server render (Next.js App or Pages Router, Remix). The canvas itself is a
browser surface — `<Nodus>` only paints inside a layout effect that runs after hydration.

```tsx
// 1. Next.js App Router — a client-component boundary is enough (the banner marks the module):
'use client';
import { Nodus, useNodusEditor } from '@nodus/react';

// 2. Pages Router / any framework — skip SSR for the canvas entirely:
import dynamic from 'next/dynamic';
const Nodus = dynamic(() => import('@nodus/react').then((m) => m.Nodus), { ssr: false });
```

## Scoping keyboard & clipboard

By default (`keyboardScope="host"`) keyboard shortcuts — undo/redo, nudge, zoom, Tab traversal —
listen on the canvas **host element**, so they fire only while this editor (or its chrome) holds
focus. That is the safe default for embedding: mounting `<Nodus>` never steals undo/zoom/delete from
the host app's own inputs, and two editors on one page never cross-receive each other's shortcuts —
each responds only while it is focused.

Pass `keyboardScope="window"` for the legacy app-wide behavior (shortcuts fire regardless of focus).
The scope is read once at mount; changing the prop later has no effect until the `editor` prop changes.

```tsx
<Nodus editor={editor} />                        // default 'host' — scoped to focus, safe to embed
<Nodus editor={editor} keyboardScope="window" /> // app-wide shortcuts (a single full-page editor)
```

Paste always listens on `window` (the clipboard event only fires there), but in `'host'` scope a
paste is ignored unless this editor's host contains the focused element — so pasting into one of the
host app's own fields is never captured by the canvas.

## Fonts & injected styles

`injectGlobalStyles()` installs the chrome's cross-cutting rules — `:focus-visible` rings, the
`prefers-reduced-motion` block, and minimal `[data-nodus-ui]` resets. It is idempotent, and the panels
call it themselves on mount, so you rarely call it directly.

**It makes no network request by default:** text falls back to the system UI font via the
`--nodus-font` CSS variable, so mounting a component issues no undisclosed third-party request (no
CSP/GDPR surprise, works offline). Web fonts are **opt-in**:

```ts
import { injectGlobalStyles } from '@nodus/react';

// Opt in to Space Grotesk / JetBrains Mono from fonts.googleapis.com:
injectGlobalStyles({ webFonts: true });
// …or self-host: set --nodus-font to your own family and leave web fonts off.
```

## See also

- [Getting started](/docs) — install and the first diagram.
- [Concepts](/docs/concepts) — the `.get()`/`.peek()` reactivity rule `useValue` depends on.
- [Extending](/docs/extending) — custom node/edge types, layouts, and plugins.
