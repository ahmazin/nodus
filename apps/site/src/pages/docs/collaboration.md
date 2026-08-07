---
layout: ../../layouts/DocsLayout.astro
title: Collaboration
description: How teams work together on Nodus diagrams — the git-native async-review model, why real-time multiplayer is a deliberate non-goal, and the extension point for those who want live sync.
---

**Nodus's collaboration model is git-native async review, not real-time multiplayer.** A Nodus
diagram is a canonical `*.nodus.json` text file, so teams collaborate on it the way they already
collaborate on code: branch, edit, open a pull request, review the diff, merge. Real-time cursors on a
shared canvas is a **deliberate non-goal** for the core — see [why](#why-not-real-time) below.

## How a team collaborates today

The whole workflow is the tooling you already have, plus the `nodus` CLI:

1. **Branch and edit.** Change a diagram in the editor (or via the [MCP server](/docs/mcp) from an
   agent) and save it as `*.nodus.json`. Because serialization is canonical, moving a node or adding
   an edge produces a **clean, minimal diff** — no coordinate churn, no re-serialization noise.
2. **Open a PR.** The diagram change is a normal file change on a normal branch.
3. **Review the diff.** `.github/workflows/diagrams.yml` enforces canonical form
   (`nodus fmt --check`) and posts a **rendered before/after preview** to the PR, so a reviewer sees
   the picture, not just JSON. `nodus diff a.nodus.json b.nodus.json` gives a **semantic** diff
   (which nodes/edges changed), and the in-app review modal shows the same. This is "diagrams you can
   code-review."
4. **Merge.** Git handles the merge. Conflicts resolve the same way code conflicts do, on canonical
   text.

See the [CLI reference](/docs/cli) for `fmt` / `diff` / `drift`, and
[Getting started](/docs) to produce the files.

## Why not real-time? {#why-not-real-time}

Real-time multiplayer and git-native async review are not two features on one axis — they are two
architectures that pull in opposite directions:

- **ID model.** Live sync wants globally-unique, distributed-creation IDs (or a CRDT) so two clients
  never collide. Git-native canonical text wants stable, minimal, human-diffable IDs. Optimizing for
  one degrades the other.
- **Merge model.** A CRDT merges *automatically and continuously*; git-native review merges
  *deliberately, with a human in the loop*. The entire value of "code-review your diagram" is the
  review step — which continuous auto-merge removes.
- **Source of truth.** Real-time makes a live server session authoritative; git-native makes the
  committed file authoritative. Nodus bets on the file.

Building both into the core would compromise both. So the core commits to the git-native model, and
leaves live sync as an **opt-in extension** (below) for teams that specifically need it.

## The extension point for live sync

Nodus does not ship real-time collaboration, but it is not closed to it. Every document mutation flows
through **one channel** (`store.apply`) and emits a **change-delta stream**. A live-sync adapter — for
example one backed by [Yjs](https://github.com/yjs/yjs) — subscribes to that stream, transports deltas
between clients, and applies remote deltas back through the same channel. That is the seam a
multiplayer layer would build on, without forking the engine. It is tracked under *Later* on the
[roadmap](https://github.com/ahmazin/nodus/blob/mainline/docs/ROADMAP.md), not committed to a date.

## FAQ

**Can two people edit the same diagram at once?**
Not on a live shared canvas. Two people edit on two branches and merge — the same as two people
editing the same source file.

**Is there presence / live cursors?**
No. That's the non-goal above.

**Can an AI agent and a human collaborate?**
Yes, asynchronously: the [MCP server](/docs/mcp) lets an agent author and export canonical
`.nodus.json`, which a human reviews in a PR like any other change.

**I really need live multiplayer. What are my options?**
Build a Yjs (or similar) adapter over the change-delta stream, or keep sessions single-writer and rely
on the git-native flow. If you build an adapter, we'd love to hear about it.

## See also

- [How Nodus compares](/docs/comparison) — the collaboration row in context.
- [CLI · nodus](/docs/cli) — `fmt` / `diff` / `drift`.
- [Roadmap](https://github.com/ahmazin/nodus/blob/mainline/docs/ROADMAP.md) — the *Later* extension
  point and the non-goals.
