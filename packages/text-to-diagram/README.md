# @nodus/text-to-diagram

Turn an LLM's structured output into a [Nodus](../../README.md) diagram. You give a model the exported
Anthropic tool definition (`diagramTool`) plus `diagramSystemPrompt`; the model returns a structured
`DiagramSpec`; you call `recordsFromSpec` to get a renderable diagram (via the
[infra preset](../preset-infra/README.md)). This package holds **zero LLM or network code** — the
actual model call stays in your app, so keys and prompts never live in the library.

## Install

```bash
pnpm add @nodus/text-to-diagram @nodus/core @nodus/preset-infra
```

## Usage

```ts
import Anthropic from '@anthropic-ai/sdk';
import { diagramTool, diagramSystemPrompt, recordsFromToolUse } from '@nodus/text-to-diagram';
import { installInfraPreset } from '@nodus/preset-infra';

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
`recordsFromToolUse(toolUse)`, `normalizeSpec(spec)`, and the `DiagramSpec` type.

## See also

- [`@nodus/preset-infra`](../preset-infra/README.md) — the node types the spec maps to.
- [`docs/EXTENDING.md`](../../docs/EXTENDING.md) · [`@nodus/core`](../core/README.md)

**Stability: pre-1.0 (0.x) — the public API may change before 1.0.**
</content>
