---
layout: ../../layouts/DocsLayout.astro
title: How Nodus compares
description: Where Nodus sits next to Excalidraw, tldraw, React Flow, and Mermaid — the headless, git-native, MIT-licensed niche it was built for.
---

Nodus is a **headless, framework-agnostic, extensible diagram engine** with a **git-native** document
model, shipped under **MIT**. That combination is the gap it fills. The tools below are all excellent
at what they do — this page is about where each one's design puts it, so you can pick the right one.

## At a glance

| | **Nodus** | Excalidraw | tldraw | React Flow (xyflow) | Mermaid |
|---|---|---|---|---|---|
| **License** | MIT | MIT | tldraw license — free tier with watermark, paid to remove¹ | MIT | MIT |
| **What it is** | Diagram **engine** + editor | Whiteboard **app** / React component | Canvas **SDK** (React) | Node-graph **component library** (React) | Text-to-diagram **renderer** |
| **Headless / framework-agnostic core** | Yes — zero DOM in `@nodus-dev/core` | No | SDK, React-only | React-only | N/A (no interactive core) |
| **Interactive editor out of the box** | Yes | Yes | Yes | You compose it from primitives | No (render-only) |
| **Git-native canonical diff / drift** | Yes — canonical `*.nodus.json`, `nodus fmt/diff/drift` | No | No | No | Source is text, but no semantic/structured diff |
| **Deterministic serialization** | Yes — stable key order, normalized numbers | JSON (not canonicalized) | JSON | Your app state | Text |
| **AI / MCP authoring channel** | Yes — `@nodus-dev/mcp` (21 tools) | No | No | No | LLMs can emit Mermaid text |
| **Import path in** | Terraform, Kubernetes, Mermaid | — | — | — | — (it *is* the source) |
| **Real-time collaboration** | Not built — [git-native async review](/docs/collaboration) is the model | Yes | Yes | You build it | N/A |
| **Touch** | Basic two-finger pan + pinch (0.3) | Full | Full | Depends on your build | N/A |
| **Render targets** | Canvas · SVG · Skia (headless PNG) | Canvas | Canvas | SVG / DOM | SVG |

¹ tldraw moved to a paid production license with a free-tier watermark in **September 2025** — the
licensing shift Nodus's MIT positioning was built for.

## The wedge: SDK power without the license tax

The short version of the table: **Nodus aims for the SDK ceiling of tldraw with the permissive
license and framework independence of Excalidraw** — while adding a git-native document model neither
of them has.

- **vs. Excalidraw** — Excalidraw is a superb whiteboard app (and MIT), but it is a React application,
  not a headless engine: there is no framework-free core to embed, no canonical serialization, and no
  diagrams-as-code review workflow. Nodus is structured-first and headless — the same code renders in
  the browser and in Node (Skia).
- **vs. tldraw** — tldraw is the closest architectural peer: a real canvas SDK with an extension
  model. The differences are the license (MIT vs. paid-to-remove-watermark since 4.0), the
  framework boundary (tldraw's editing is React-only; Nodus's core is DOM-free with a thin React
  binding), and the git-native moat.
- **vs. React Flow (xyflow)** — React Flow is a React library for *building* node-based UIs; you
  assemble the editor from its primitives. Nodus ships the editor and the headless engine, is not
  tied to React for the model/render/layout, and treats the document as a diffable artifact.
- **vs. Mermaid** — Mermaid renders diagrams from a text DSL; it is not an interactive editor. Nodus
  can **import** Mermaid (`@nodus-dev/from-mermaid`) into an editable, git-native document — so Mermaid
  is an input to Nodus, not a competitor to it.

## Where Nodus is deliberately behind

Honest gaps, not hidden ones:

- **No real-time multiplayer.** This is a [deliberate non-goal](/docs/collaboration): the
  collaboration model is git-native async review. Excalidraw and tldraw have live collaboration; Nodus
  does not, and leaves live sync as an extension point over its change-delta stream.
- **Touch is basic.** Two-finger pan and pinch-zoom work as of 0.3; the incumbents' touch stories are
  more mature. See the [support matrix](/docs/support-matrix).
- **React is the only shipped interactive binding** today. The engine is framework-agnostic, but the
  input/paint wiring ships as `@nodus-dev/react`; a framework-free host and other bindings are on the
  [roadmap](https://github.com/ahmazin/nodus/blob/mainline/docs/ROADMAP.md).

## See also

- [Collaboration](/docs/collaboration) — the git-native async-review position in full.
- [Getting started](/docs) — install and render your first diagram.
- [CLI · nodus](/docs/cli) — the `fmt` / `diff` / `drift` tooling behind the git-native column.
