---
layout: ../../layouts/DocsLayout.astro
title: Troubleshooting & FAQ
description: Fixes for the common first-run snags — peer-dep installs, blank headless renders, Terraform import format, schema-version errors — and answers to the questions that come up most.
---

The problems that come up most, and how to fix them. If yours isn't here, open a
[discussion or issue on GitHub](https://github.com/ahmazin/nodus).

## Install & setup

### `Cannot find module '@nodus-dev/core'` after installing `@nodus-dev/react`

`@nodus-dev/core` is a **peer dependency** of `@nodus-dev/react` and `@nodus-dev/preset-infra`, so
install it explicitly:

```bash
npm i @nodus-dev/react @nodus-dev/core @nodus-dev/preset-infra
```

npm 7+ and pnpm auto-install peers, but listing `@nodus-dev/core` yourself is the portable fix. All
packages ship on the same [synchronized version line](/docs/versioning) (currently `0.3.x`) — keep
them at the same minor.

### Mixed versions / peer-range warnings

Don't mix lines (e.g. `core@0.3` with `react@0.2`). Upgrade the whole `@nodus-dev/*` set together to
the latest minor; that's the only supported configuration before 1.0.

## Headless rendering

### A headless render comes out blank or half-empty

Two prerequisites fail **silently** — the render succeeds but looks wrong — so check them first:

- **Load fonts before the first paint.** Call `GlobalFonts.loadSystemFonts()` (or
  `registerFromPath(...)`) from `@napi-rs/canvas` *before* rendering, or text draws blank while shapes
  draw fine.
- **Register the node/edge types the document uses.** A record whose `type` has no registered
  `NodeUtil`/`EdgeUtil` draws as **nothing**. Install the preset (or your custom types) before
  rendering.

Full recipe: [Headless rendering](/docs/headless).

### `NodusError: schema-too-new` when loading a document

The snapshot was written by a **newer** Nodus than the one reading it. A git-native format refuses to
downgrade rather than silently rewrite a file it can't round-trip. **Upgrade `@nodus-dev/core`** (and
the rest of the set) to open it:

```ts
import { isNodusError } from '@nodus-dev/core';
try {
  editor.loadSnapshot(snapshot);
} catch (e) {
  if (isNodusError(e) && e.code === 'schema-too-new') {
    console.error('Upgrade @nodus-dev/core to open this diagram.');
  } else throw e;
}
```

## Importers

### Terraform import does nothing / errors on my `.tf` files

The Terraform importer and the MCP `import_terraform` tool consume **`terraform show -json` output**,
not raw HCL. Nodus does not parse `.tf` source. Generate the JSON first:

```bash
terraform show -json > estate.json          # from current state
# or, for a plan:
terraform show -json plan.tfplan > plan.json
```

Then feed that JSON to the importer / MCP tool. HCL `.tf` files are rejected by design.

### Kubernetes import

`import_kubernetes` (and `fromKubernetes`) accept **YAML or JSON** manifests — one or many resources.
Point it at your manifests directly.

## Export

### "Export exceeds the maximum pixel budget"

PNG/SVG export is capped at **256 megapixels** (`MAX_EXPORT_PIXELS`) to prevent a runaway allocation.
If you hit it, lower `pixelRatio` or export a smaller `bounds` region. The cap is a catchable
`NodusError` — see the limits in `SECURITY.md`.

### MCP server won't write my file

By default the [MCP server](/docs/mcp) only writes inside its data dir (`.nodus-mcp/` or
`NODUS_MCP_DATA`). To let it write into your working directory, set `NODUS_MCP_ALLOW_CWD=1`. It still
refuses to overwrite files it didn't create, and enforces the file extension per tool.

## Interaction & accessibility

### Tab / keyboard "gets stuck" on the canvas, or authoring needs a mouse

The canvas is keyboard-navigable (Tab between nodes, arrows to nudge, Enter/F2 to edit, Escape to
release focus). Screen-reader coverage of canvas *content* is still limited. See the honest status and
the full keyboard model in the [accessibility statement](/docs/accessibility).

### Touch / pinch-zoom on a tablet or phone

Basic two-finger pan and pinch-zoom are supported as of 0.3; deeper multi-touch gestures are still
maturing. See the [support matrix](/docs/support-matrix) for exactly what's tested.

## Product questions

### Does Nodus have real-time collaboration?

No — that's a deliberate non-goal. The model is **git-native async review** (branch, diff, PR, merge).
Full rationale and the live-sync extension point: [Collaboration](/docs/collaboration).

### Does Nodus collect telemetry?

No. Zero analytics or error-reporting in any package or the playground. See
[Privacy & telemetry](/docs/privacy).

### Which browsers / Node / React versions are supported?

Evergreen desktop browsers, Node 20+ (22 tested), React 18. Details, including what's untested:
[support matrix](/docs/support-matrix).

## See also

- [Getting started](/docs) · [Headless rendering](/docs/headless) · [MCP server](/docs/mcp)
- [Support matrix](/docs/support-matrix) · [Accessibility](/docs/accessibility) · [Privacy](/docs/privacy)
