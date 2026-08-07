---
"@nodus-dev/core": minor
"@nodus-dev/cli": minor
"@nodus-dev/mcp": minor
"@nodus-dev/from-mermaid": minor
"@nodus-dev/import-infra": minor
"@nodus-dev/layout-dagre": minor
"@nodus-dev/layout-elk": minor
"@nodus-dev/layout-force": minor
"@nodus-dev/layout-tree": minor
"@nodus-dev/persistence": minor
"@nodus-dev/plugin-freehand": minor
"@nodus-dev/preset-diagrams": minor
"@nodus-dev/preset-draw": minor
"@nodus-dev/preset-infra": minor
"@nodus-dev/react": minor
"@nodus-dev/stencils": minor
"@nodus-dev/text-to-diagram": minor
---

Re-baseline all published packages onto a single synchronized pre-1.0 line: **0.3.0**.

Previously the scope shipped mixed majors (`core`/`cli`/`mcp` at 0.2.0, everything else at
1.0.0), which contradicted the "everything is pre-1.0" stability policy and left the
`react → core` peer semantics undefined. Every `@nodus-dev/*` package now shares version
`0.3.0`; internal peer/dependency ranges resolve to `^0.3.0` (minor-locked under 0.x).
`@nodus-dev/icons-cloud` is also re-based to `0.3.0` and unheld for its option-2 (placeholder
packs) publish.

No API changes — this is a version-coherence release. Under 0.x, a minor may break.

> Note: this file is a human-readable CHANGELOG record for the manual re-baseline. Do NOT run
> `changeset version` against it — changesets can only bump versions up, so it would push the
> 1.0.0 packages to 1.1.0 and re-introduce the mixed-version incoherence. The `version` fields
> were set manually to `0.3.0`; publish is `changeset publish` only.
