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

> **TODO(C2)** — SSR safety (a `getServerSnapshot` for `useValue`, an isomorphic layout effect, and a
> `'use client'` banner in the published build) is in progress. Until it lands, render `<Nodus>` and
> the panels client-only (e.g. Next.js `dynamic(..., { ssr: false })`). This section will document the
> supported SSR/RSC path once it lands.

## Scoping keyboard & clipboard

> **TODO(C3)** — A `keyboard` scope option to bind shortcuts to the host element (rather than
> `window`), so mounting `<Nodus>` never intercepts undo/zoom/delete from the embedding app's inputs
> and two instances don't cross-receive shortcuts, is in progress. This section will document the
> scoping API once it lands.

## Fonts & injected styles

> **TODO(C4)** — The remote web-font fetch is being removed from the injected global styles, and an
> opt-out for style injection added, so mounting a component issues no undisclosed third-party network
> request. This section will document exactly what is injected and how to self-host or opt out once it
> lands.

## See also

- [Getting started](/docs) — install and the first diagram.
- [Concepts](/docs/concepts) — the `.get()`/`.peek()` reactivity rule `useValue` depends on.
- [Extending](/docs/extending) — custom node/edge types, layouts, and plugins.
