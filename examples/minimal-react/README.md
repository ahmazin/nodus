# @nodus-dev-examples/minimal-react

The smallest real Nodus UI: one `<Nodus>` canvas host, the `useNodusEditor` lifecycle hook, and one
custom node type registered on the editor. Pan/zoom, select, drag, connect, inline-rename, and
undo/redo all work out of the box.

```bash
pnpm install          # link the workspace packages + React
pnpm typecheck        # tsc --noEmit
pnpm start            # vite dev server → http://localhost:5190
```

`src/main.tsx` is the whole app: a `stickyNote` `NodeUtil` (geometry + a themed `draw`), then
`useNodusEditor(() => …)` to own the `Editor` across the component's lifetime, rendered with
`<Nodus editor={editor} />`. See the [React binding guide](https://nodus.dev/docs/react) for panels,
`useValue`, keyboard scoping, and SSR.
