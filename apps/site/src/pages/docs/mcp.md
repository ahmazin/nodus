---
layout: ../../layouts/DocsLayout.astro
title: MCP server
description: Drive the Nodus engine from an AI agent — build, mutate, lay out, and export diagrams as tool calls.
---

`@nodus/mcp` exposes the engine as a [Model Context Protocol](https://modelcontextprotocol.io) server,
so an AI agent can build and edit diagrams through structured tool calls — then export a PNG or the
canonical `.nodus.json`.

## Tools

The server drives a live editor session. Tools group into authoring, layout/flow, and I/O:

| Area          | Tools                                                                              |
| ------------- | ---------------------------------------------------------------------------------- |
| **Author**    | `new_diagram`, `add_node`, `connect_nodes`, `update_node`, `delete_elements`       |
| **Import**    | `import_mermaid`                                                                    |
| **Inspect**   | `list_elements`                                                                     |
| **Layout**    | `layout`                                                                            |
| **Flow**      | `set_flow`, `set_flow_metric`                                                       |
| **Export/IO** | `export_png`, `export_json`, `save_doc`, `load_doc`                                 |

Because the underlying serialization is canonical, `export_json` / `save_doc` output is git-diffable —
an agent's edits review like any other change.

## Usage

Wire it into any MCP-capable client as a stdio server. For example, in a client's MCP config:

```json
{
  "mcpServers": {
    "nodus": {
      "command": "npx",
      "args": ["-y", "@nodus/mcp"]
    }
  }
}
```

A typical agent flow:

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
