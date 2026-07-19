# @nodus/import-infra

Import live infrastructure into a [Nodus](../../README.md) diagram. Two converters turn real infra
descriptions into [infra preset](../preset-infra/README.md) records:

- `fromTerraform(showJson)` — parses `terraform show -json` (state **or** plan); resources become
  nodes, `depends_on` becomes edges.
- `fromKubernetes(objects)` — maps manifest kinds to node types and infers Ingress → Service →
  workload edges from backends and label selectors.

## Install

```bash
pnpm add @nodus/import-infra @nodus/core @nodus/preset-infra
```

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

## See also

- [`@nodus/preset-infra`](../preset-infra/README.md) — the node types the records use.
- [`docs/EXTENDING.md`](../../docs/EXTENDING.md) · [`@nodus/core`](../core/README.md)

**Stability: pre-1.0 (0.x) — the public API may change before 1.0.**
</content>
