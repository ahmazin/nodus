# @ahmazin/text-to-diagram

Turn an LLM's structured output into a [Nodus](https://github.com/ahmazin/nodus) diagram. You give a model the exported
Anthropic tool definition (`diagramTool`) plus `diagramSystemPrompt`; the model returns a structured
`DiagramSpec`; you call `recordsFromSpec` to get a renderable diagram (via the
[infra preset](https://github.com/ahmazin/nodus/tree/main/packages/preset-infra)). This package holds **zero LLM or network code** — the
actual model call stays in your app, so keys and prompts never live in the library.

## Install

```bash
pnpm add @ahmazin/text-to-diagram @ahmazin/core @ahmazin/preset-infra
```

> `@ahmazin/core` is a **peer dependency** — install it alongside so the importer shares your app's single
> engine instance.

## Usage

```ts
import Anthropic from '@anthropic-ai/sdk';
import { diagramTool, diagramSystemPrompt, recordsFromToolUse } from '@ahmazin/text-to-diagram';
import { installInfraPreset } from '@ahmazin/preset-infra';

const client = new Anthropic();
const res = await client.messages.create({
  model: 'claude-sonnet-4-5',
  max_tokens: 1024,
  system: diagramSystemPrompt,
  tools: [diagramTool],
  messages: [{ role: 'user', content: 'A web app: an API service behind a load balancer, backed by Postgres and Redis.' }],
});

const toolUse = res.content.find((b) => b.type === 'tool_use');
const records = recordsFromToolUse(toolUse);   // NodusRecord[]

installInfraPreset(editor);
editor.addRecords(records);
// await editor.layout('elk');   // records are unpositioned — run a registered layout
```

The node `type` the model emits is one of the infra kinds (`service` / `db` / `cache` / `queue` /
`lb` / `edge`); unknown types fall back to `service`.

## Exports

`diagramTool` (the Anthropic tool schema), `diagramSystemPrompt`, `recordsFromSpec(spec)`,
`recordsFromToolUse(toolUse)`, `analyzeSpec(spec)`, `normalizeSpec(spec)`, `DiagramSpecError`, and the
`DiagramSpec` / `SpecIssue` types.

## Errors

The spec is **untrusted** model output, so failure is explicit and coded:

- **A wholly-unusable payload throws** a `DiagramSpecError` — a subclass of `NodusError` (from
  `@ahmazin/core`) — with a namespaced `code`: `'text-to-diagram/invalid-spec'` (not an object with a
  `nodes` array, or the wrong tool passed to `recordsFromToolUse`) or `'text-to-diagram/spec-too-large'`
  (over the element cap). Match with `isNodusError(e)`, never `instanceof`.
- **Partial success is not silent.** A model that emits one malformed node or a dangling edge no longer
  loses it invisibly: use `analyzeSpec(spec)` → `{ records, issues }`, where each `SpecIssue { code,
  message, ref? }` names what was dropped (`'dropped-node'` / `'dropped-edge'`) or coerced
  (`'coerced-type'`, e.g. an unknown type folded to `service`). `recordsFromSpec` returns just the
  records when you don't need the issues.

```ts
import { isNodusError } from '@ahmazin/core';
import { analyzeSpec } from '@ahmazin/text-to-diagram';

try {
  const { records, issues } = analyzeSpec(toolUse.input);
  for (const issue of issues) console.warn(issue.code, issue.message, issue.ref);
} catch (e) {
  if (isNodusError(e) && e.code === 'text-to-diagram/invalid-spec') {
    // the model returned something we can't build — show e.message / e.context
  }
}
```

## See also

- [`@ahmazin/preset-infra`](https://github.com/ahmazin/nodus/tree/main/packages/preset-infra) — the node types the spec maps to.
- [Extending Nodus](https://nodus.dev/docs/extending) · [`@ahmazin/core`](https://github.com/ahmazin/nodus/tree/main/packages/core)

**Stability: pre-1.0 (0.x) — the public API may change before 1.0.**
</content>
