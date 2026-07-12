/**
 * @nodus/import-infra — turn live infrastructure into a Nodus diagram.
 *  - `fromTerraform(showJson)`: parses `terraform show -json` (state or plan) — resources become
 *    nodes, `depends_on` becomes edges.
 *  - `fromKubernetes(objects)`: maps manifest kinds to node types; Ingress→Service→workload edges
 *    are inferred from backends and label selectors.
 * Both return infra records ready to load or hand to `InfraCanvas`.
 */

import type { NodusRecord } from '@nodus/core';
import { modelToRecords, type InfraModel } from '@nodus/preset-infra';

// ---------------------------------------------------------------------------
// Terraform
// ---------------------------------------------------------------------------
export function terraformKind(type: string): string {
  const t = type.toLowerCase();
  if (/(rds|dynamodb|sql_database|spanner|bigtable|_db_instance|documentdb|mongo|postgres|mysql|cosmosdb)/.test(t)) return 'db';
  if (/(elasticache|redis|memcache|memorystore)/.test(t)) return 'cache';
  if (/(sqs|sns|pubsub|kafka|kinesis|eventbridge|servicebus|_mq|amqp|queue)/.test(t)) return 'queue';
  if (/(load_balancer|_alb|_elb|_lb\b|target_group|application_gateway|_nlb)/.test(t)) return 'lb';
  if (/(cloudfront|_cdn|api_gateway|apigateway|route53|_dns|frontdoor|dns_)/.test(t)) return 'edge';
  return 'service';
}

interface TfResource {
  address: string;
  type: string;
  name: string;
  depends_on?: string[];
  values?: Record<string, unknown>;
}
interface TfModule {
  resources?: TfResource[];
  child_modules?: TfModule[];
}

function collectResources(mod: TfModule | undefined, out: TfResource[]): void {
  if (!mod) return;
  for (const r of mod.resources ?? []) out.push(r);
  for (const c of mod.child_modules ?? []) collectResources(c, out);
}

export function fromTerraform(showJson: unknown): NodusRecord[] {
  const root = (showJson as { values?: { root_module?: TfModule }; planned_values?: { root_module?: TfModule } });
  const rootModule = root.values?.root_module ?? root.planned_values?.root_module;
  const resources: TfResource[] = [];
  collectResources(rootModule, resources);

  const addresses = new Set(resources.map((r) => r.address));
  const model: InfraModel = {
    nodes: resources.map((r) => ({ key: r.address, type: terraformKind(r.type), label: r.name, x: 0, y: 0 })),
    edges: [],
  };
  for (const r of resources) {
    for (const dep of r.depends_on ?? []) {
      // depends_on may be an address or a prefix; match to a known resource
      const target = addresses.has(dep) ? dep : resources.find((o) => dep.startsWith(o.address))?.address;
      if (target) model.edges!.push({ from: target, to: r.address });
    }
  }
  return modelToRecords(model);
}

// ---------------------------------------------------------------------------
// Kubernetes
// ---------------------------------------------------------------------------
export function kubernetesKind(kind: string): string | null {
  switch (kind) {
    case 'Deployment':
    case 'Pod':
    case 'DaemonSet':
    case 'ReplicaSet':
    case 'Job':
    case 'CronJob':
      return 'service';
    case 'StatefulSet':
      return 'db';
    case 'Service':
      return 'lb';
    case 'Ingress':
      return 'edge';
    default:
      return null; // ConfigMap, Secret, Namespace, etc. are skipped
  }
}

interface K8sObject {
  kind: string;
  metadata?: { name?: string; labels?: Record<string, string> };
  spec?: Record<string, unknown>;
}

function labelsMatch(selector: Record<string, string>, labels: Record<string, string>): boolean {
  return Object.entries(selector).every(([k, v]) => labels[k] === v);
}
function workloadLabels(obj: K8sObject): Record<string, string> {
  const tmpl = (obj.spec?.template as { metadata?: { labels?: Record<string, string> } } | undefined)?.metadata?.labels;
  return tmpl ?? obj.metadata?.labels ?? {};
}

export function fromKubernetes(objects: K8sObject[]): NodusRecord[] {
  const nodes: InfraModel['nodes'] = [];
  const edges: NonNullable<InfraModel['edges']> = [];
  const byName = new Map<string, K8sObject>(); // name -> object (for lookups)
  const keyOf = (o: K8sObject) => `${o.kind}/${o.metadata?.name ?? '?'}`;

  for (const o of objects) {
    const type = kubernetesKind(o.kind);
    if (!type) continue;
    nodes.push({ key: keyOf(o), type, label: o.metadata?.name ?? o.kind, x: 0, y: 0 });
    byName.set(o.metadata?.name ?? '', o);
  }
  const included = new Set(nodes.map((n) => n.key));

  for (const o of objects) {
    if (o.kind === 'Ingress') {
      // Ingress -> Service (extensions/v1 backend.serviceName OR networking.k8s.io backend.service.name)
      const rules = (o.spec?.rules as Array<{ http?: { paths?: Array<{ backend?: { serviceName?: string; service?: { name?: string } } }> } }>) ?? [];
      for (const rule of rules) {
        for (const path of rule.http?.paths ?? []) {
          const svc = path.backend?.serviceName ?? path.backend?.service?.name;
          const target = svc && byName.get(svc);
          if (target && included.has(keyOf(o)) && included.has(keyOf(target))) edges.push({ from: keyOf(o), to: keyOf(target) });
        }
      }
    } else if (o.kind === 'Service') {
      const selector = (o.spec?.selector as Record<string, string>) ?? {};
      if (Object.keys(selector).length === 0) continue;
      for (const w of objects) {
        if (kubernetesKind(w.kind) === null || w.kind === 'Service' || w.kind === 'Ingress') continue;
        if (labelsMatch(selector, workloadLabels(w)) && included.has(keyOf(w))) edges.push({ from: keyOf(o), to: keyOf(w) });
      }
    }
  }
  return modelToRecords({ nodes, edges });
}
