# @nodus/import-infra

Import live infrastructure into a [Nodus](https://github.com/OWNER/nodus) diagram. Two converters turn real infra
descriptions into [infra preset](https://github.com/OWNER/nodus/tree/main/packages/preset-infra) records:

- `fromTerraform(showJson)` — parses `terraform show -json` (state **or** plan); resources become
  nodes, `depends_on` becomes edges.
- `fromKubernetes(objects)` — maps manifest kinds to node types and infers Ingress → Service →
  workload edges from backends and label selectors.

## Install

```bash
pnpm add @nodus/import-infra @nodus/core @nodus/preset-infra
```

> `@nodus/core` is a **peer dependency** — install it alongside so the importer shares your app's single
> engine instance.

## Usage

```ts
import { fromTerraform, fromKubernetes } from '@nodus/import-infra';
import { installInfraPreset } from '@nodus/preset-infra';

// Terraform: feed it the parsed JSON from `terraform show -json`
const tf = JSON.parse(await fs.readFile('tfstate.json', 'utf8'));
const records = fromTerraform(tf);

// Kubernetes: feed it an array of parsed manifest objects
// const records = fromKubernetes([deployment, service, ingress]);

installInfraPreset(editor);
editor.addRecords(records);      // records are unpositioned…
await editor.layout('dagre');    // …so run a registered layout to place them
```

Both converters return `NodusRecord[]`. `terraformKind(type)` and `kubernetesKind(kind)` — the
resource-to-node-type classifiers — are also exported if you want to inspect or override the mapping.

## Errors

Importers parse **untrusted** shared files, so failure is explicit and coded:

- **Malformed input throws** an `ImportError` — a subclass of `NodusError` (from `@nodus/core`) — with
  a namespaced `code`: `'import-infra/parse-failed'` (input that is not `terraform show -json` output,
  or unparseable Kubernetes YAML) or `'import-infra/input-too-large'` (a depth / element / byte
  resource-exhaustion guard tripped). `context` carries the specifics. Malformed input is **refused**,
  never returned as an empty diagram. Match with `isNodusError(e)`, never `instanceof` across package
  copies.
- **Partial success is reported.** `analyzeTerraform` / `analyzeKubernetes` return `{ records, skipped,
  notes }` — `skipped` is a typed `{ label, count }[]` of unmapped kinds and `notes` explains limits
  (e.g. state-only JSON has no configuration edges) — so nothing vanishes silently. (`fromTerraform` /
  `fromKubernetes` are the records-only convenience wrappers over these.)

```ts
import { isNodusError } from '@nodus/core';
import { analyzeKubernetes } from '@nodus/import-infra';

try {
  const { records, skipped } = analyzeKubernetes(manifestYaml);
  for (const s of skipped) console.info(`skipped ${s.count}× ${s.label}`);
} catch (e) {
  if (isNodusError(e) && e.code === 'import-infra/parse-failed') {
    // not valid Kubernetes / Terraform input — show e.message / e.context
  }
}
```

## See also

- [`@nodus/preset-infra`](https://github.com/OWNER/nodus/tree/main/packages/preset-infra) — the node types the records use.
- [Extending Nodus](https://nodus.dev/docs/extending) · [`@nodus/core`](https://github.com/OWNER/nodus/tree/main/packages/core)

**Stability: pre-1.0 (0.x) — the public API may change before 1.0.**
</content>
