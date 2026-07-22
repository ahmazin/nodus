---
layout: ../../layouts/DocsLayout.astro
title: Getting started
description: Install Nodus and render your first diagram — as a React component or a headless engine.
---

## What is Nodus

Nodus is a **headless, framework-agnostic, extensible diagram engine** for TypeScript — an
Excalidraw-class editor built to be customized. It owns *model → layout → render → interact* on a
Canvas-2D surface and gets out of your way for everything else.

`@nodus/core` has **zero framework or DOM dependencies** and renders identically in the browser and
headless (Skia via `@napi-rs/canvas`). `@nodus/react` is a thin binding on top. The infra-architecture
preset (`@nodus/preset-infra`) is one preset among several built on the general core.

## Install

```bash
# the React binding + the infra node/edge types & theme
npm i @nodus/react @nodus/preset-infra
# or: pnpm add @nodus/react @nodus/preset-infra
```

`@nodus/react` pulls in `@nodus/core` as a dependency. If you only need the headless engine (no React),
install `@nodus/core` on its own.

## Quick start (React)

`useNodusEditor` owns an `Editor` instance across your component's lifetime — it builds the editor once
and disposes it on unmount. Render it with `<Nodus>`:

```tsx
import { Nodus, useNodusEditor } from '@nodus/react';
import { Editor } from '@nodus/core';
import { installInfraPreset } from '@nodus/preset-infra';

export function App() {
  const editor = useNodusEditor(() => {
    const e = new Editor();
    installInfraPreset(e); // registers infra node/edge types + the dark theme
    return e;
  });

  return <Nodus editor={editor} style={{ height: '100vh' }} />;
}
```

That gives you pan/zoom, select/multi-select, drag, create, connect, inline-rename, delete, and
delta-based undo/redo — where one gesture collapses to one undo entry.

> Prefer to pass a data model instead of driving the editor imperatively? `@nodus/preset-infra` also
> exports an `InfraCanvas` façade (`InfraCanvas({ model, mode, overlays })`) plus `modelToRecords` for
> turning a plain `InfraModel` into scene records.

## Headless / framework-agnostic

The core is pure — no React, no DOM. You can build, mutate, lay out, and **render** a scene with no
browser at all:

```ts
import { Editor } from '@nodus/core';
import { installInfraPreset } from '@nodus/preset-infra';

const editor = new Editor({ viewport: { w: 1200, h: 700 } });
installInfraPreset(editor);

// mutate through the one channel (undo + scene index + events stay in sync)
editor.createNode({ type: 'lambda', label: 'Auth', props: { x: 120, y: 80 } });

// paint to any Ctx2D surface (DOM canvas or Skia) via editor.paintRegion(...)
```

The same drawing code paints to a DOM canvas or a Skia canvas, so browser preview and server-side PNG
export share one path.

## Next steps

- **[Concepts →](/docs/concepts)** — the store, signals, scene index, and the four extension axes.
- **[CLI →](/docs/cli)** — `nodus fmt / render / diff` and diagrams-in-CI.
- **[MCP server →](/docs/mcp)** — drive the engine from an AI agent.
- **[Try the live demo →](/playground/)** — the full editor in your browser.
