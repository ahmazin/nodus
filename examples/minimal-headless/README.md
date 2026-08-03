# @nodus-dev-examples/minimal-headless

Render a Nodus diagram to a PNG in Node — no browser, no DOM. The engine paints through a `Ctx2D`
abstraction, so the same drawing code that runs in the browser also drives native Skia via
[`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas).

```bash
pnpm install          # link the workspace packages
pnpm typecheck        # tsc --noEmit
pnpm start            # tsx src/index.ts — writes diagram.png
```

`src/index.ts` follows the [headless rendering guide](https://nodus.dev/docs/headless) exactly: load
system fonts (or text renders blank), register the node/edge types (or they draw as nothing), inject a
`CreateCanvas` factory, and call `editor.toPNG(create, opts)`.
