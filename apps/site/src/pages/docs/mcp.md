---
layout: ../../layouts/DocsLayout.astro
title: MCP server
description: Drive the Nodus engine from an AI agent — build, mutate, lay out, and export diagrams as tool calls, over npx with no build step.
---

`@nodus-dev/mcp` exposes the engine as a [Model Context Protocol](https://modelcontextprotocol.io) server,
so an AI agent can build and edit diagrams through structured tool calls — then export a PNG or the
canonical `.nodus.json`.

## Tools

The server drives a live editor session. Tools group into authoring, layout/flow, and I/O:

| Area          | Tools                                                                              |
| ------------- | ---------------------------------------------------------------------------------- |
| **Author**    | `new_diagram`, `add_node`, `connect_nodes`, `update_node`, `update_edge`, `delete_elements`, `author_from_spec` |
| **Import**    | `import_mermaid`, `import_terraform`, `import_kubernetes`                           |
| **Inspect**   | `list_elements`, `diff_docs`                                                        |
| **Layout**    | `layout` (dagre · elk · tree · force)                                               |
| **Flow**      | `set_flow`, `set_flow_metric`                                                       |
| **Style**     | `set_theme`                                                                         |
| **Export/IO** | `export_png`, `export_svg`, `export_json`, `save_doc`, `load_doc`                   |

Because the underlying serialization is canonical, `export_json` / `save_doc` output is git-diffable —
an agent's edits review like any other change.

## Usage

`@nodus-dev/mcp` is published to npm, so wire it into any MCP-capable client as a stdio server with
`npx` — no clone, no build:

```json
{
  "mcpServers": {
    "nodus": {
      "command": "npx",
      "args": ["-y", "@nodus-dev/mcp"],
      "env": { "NODUS_MCP_DATA": "/absolute/path/to/diagrams" }
    }
  }
}
```

`npx -y @nodus-dev/mcp` runs the published `nodus-mcp` binary. That's the whole setup.

### Where files go — the data dir

The server keeps saved documents and exports under a **data directory**, and by default it will only
write there. This keeps a diagram-authoring agent from being tricked into overwriting arbitrary files
on your machine.

- **Default location:** a `.nodus-mcp/` folder in the process's working directory, with `exports/`
  (PNG/SVG) and `docs/` (saved `.nodus.json`) subfolders. Set **`NODUS_MCP_DATA`** to put it
  somewhere specific (recommended — point it at the repo where your diagrams live).
- **Writes are confined to the data dir.** `export_png` / `export_svg` refuse a `path` outside it,
  refuse a path whose extension doesn't match the tool, and refuse to overwrite a file the session
  didn't itself create.
- **Opt in to writing under the working directory** by setting **`NODUS_MCP_ALLOW_CWD`** (`1`, `true`,
  or `yes`). This adds the current working directory as an allowed write root — useful when you want
  the agent to drop a `diagram.png` straight into your project — while the extension and
  no-clobber guards still apply. Leave it unset for the safe default.

### From source (contributors)

If you're working on Nodus itself, point the client at the built entry instead of the published
package:

```bash
pnpm --filter @nodus-dev/mcp build   # produces packages/mcp/dist/bin.js
```

```json
{
  "mcpServers": {
    "nodus": {
      "command": "node",
      "args": ["/absolute/path/to/nodus/packages/mcp/dist/bin.js"],
      "env": { "NODUS_MCP_DATA": "/absolute/path/to/diagrams" }
    }
  }
}
```

## A typical agent flow

```text
new_diagram            → start a fresh scene
add_node × N           → place services
connect_nodes × M      → wire the edges
layout { engine: "dagre", direction: "LR" }
export_png             → hand back a rendered image
export_json            → hand back canonical .nodus.json for the repo
```

See **[Concepts →](/docs/concepts)** for how these map onto the one mutation channel, and the
**[CLI →](/docs/cli)** for turning the exported JSON into a code-reviewed diagram.
