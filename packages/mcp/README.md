# @nodus/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server around a headless Nodus `Editor`.
It lets an agent **build, lay out, and export diagrams** — the fastest path being `import_mermaid`,
with hand-authoring (`add_node`/`connect_nodes`/`layout`) and PNG/JSON export on top.

Dependency-free: it speaks newline-delimited JSON-RPC 2.0 over stdio directly (no MCP SDK), and
renders PNGs with Skia via `@napi-rs/canvas`.

## Tools

| Tool | What it does |
|------|--------------|
| `new_diagram` | Start fresh with a preset: `diagrams` (flowchart/state/ER shapes), `infra`, or `draw`. |
| `import_mermaid` | Replace the diagram with one parsed from a Mermaid string (flowchart / stateDiagram / erDiagram) and lay it out. **The fastest way to author.** |
| `add_node` | Add a node (`label`, `type`, optional `x`/`y`). |
| `connect_nodes` | Connect two nodes — `from`/`to` may be ids **or labels** — with an optional edge label. |
| `update_node` | Rename, move, or set the visual state of a node. |
| `delete_elements` | Delete nodes/edges by id or node label (edges cascade). |
| `layout` | Auto-layout the whole graph with `dagre` (default) or `elk`. |
| `list_elements` | Inspect the current nodes and edges. |
| `set_flow` | Animate flow (traveling packets) along edges. For **data-driven** flow, give a `scale` mapping a metric → speed/color. |
| `set_flow_metric` | Push live metric values (throughput/health) that drive data-driven flow. Ephemeral — never touches the saved document. |
| `export_png` | Render to PNG (a **traffic snapshot** with flow packets when flow is set) — saves a file and returns the image inline so the agent can see it. |
| `export_json` | Return the versioned, git-trackable Nodus JSON snapshot. |
| `save_doc` / `load_doc` | Persist/restore named diagrams under the server data dir. |

## Run it

```bash
pnpm --filter @nodus/mcp build
# then run the stdio server (an MCP client launches this for you):
node packages/mcp/dist/bin.js
```

`NODUS_MCP_DATA=<dir>` sets where exports and saved docs land (default `./.nodus-mcp`).

## Configure an MCP client

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nodus": {
      "command": "node",
      "args": ["/absolute/path/to/InfraCanvas/packages/mcp/dist/bin.js"],
      "env": { "NODUS_MCP_DATA": "/absolute/path/to/diagrams" }
    }
  }
}
```

**Claude Code** — `claude mcp add nodus -- node /absolute/path/to/InfraCanvas/packages/mcp/dist/bin.js`

Then ask the agent to draw something:

> "Make a flowchart of a login flow and show me the PNG."

The agent calls `import_mermaid` (or builds it node-by-node), `layout`, and `export_png`, and the
rendered image comes back inline.

Or drive a live view from real metrics:

> "Diagram my services, then colour each link by its error rate and show me the traffic."

The agent builds the graph, calls `set_flow` with a `scale` (e.g. green→amber→red thresholds), pushes
`set_flow_metric` values as it observes them, and `export_png` returns a snapshot with the packets
coloured by each link's health — congested links red and slow, healthy links green and fast.

## Embed it

The transport and the tool logic are separable — drive `DiagramSession` from your own transport:

```ts
import { DiagramSession, dispatch } from '@nodus/mcp';

const session = new DiagramSession({ dataDir: './diagrams' });
const result = await dispatch(session, 'import_mermaid', { source: 'graph LR\n A --> B' });
```
