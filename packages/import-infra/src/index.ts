/**
 * @nodus/import-infra — turn live infrastructure into a Nodus diagram.
 *  - `fromTerraform(showJson)`: parses `terraform show -json` (state or plan) — resources become
 *    nodes, `depends_on` becomes edges.
 *  - `fromKubernetes(objects)`: maps manifest kinds to node types; Ingress→Service→workload edges
 *    are inferred from backends and label selectors.
 * Both return infra records ready to load or hand to `InfraCanvas`.
 */

import {
  isEdge,
  isNode,
  type Change,
  type EdgeRecord,
  type Endpoint,
  type Id,
  type NodeRecord,
  type NodusRecord,
} from '@nodus/core';
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

// ---------------------------------------------------------------------------
// Drift — re-import a source and see what changed vs the current diagram.
//
// The foundation is source-stable ids: `modelToRecords` seeds a node's id on its
// `props.key` (the source address), so re-importing the SAME source yields identical
// node ids. Drift matches resources across the two record sets by `props.key`.
// ---------------------------------------------------------------------------

/** A source-managed resource whose normalized content differs between the two sets. */
export interface DriftChange {
  key: string;
  from: NodeRecord;
  to: NodeRecord;
  /** What differs, e.g. `'label'`, `'type'`, `'props.kind'`. */
  fields: string[];
}

export interface DriftResult {
  /** Source-managed nodes in `incoming` with a key not present in `current`. */
  added: NodeRecord[];
  /** Source-managed nodes in `current` with a key not present in `incoming`. */
  removed: NodeRecord[];
  /** Same key, differing normalized content. */
  changed: DriftChange[];
  /** Count of same-key resources whose normalized content is identical. */
  unchanged: number;
  /** added.length + removed.length + changed.length — "N resources changed". */
  total: number;
}

/** A record is source-managed iff it is a node carrying a string `props.key` (the source address). */
function sourceManagedNodes(records: NodusRecord[]): NodeRecord[] {
  return records.filter((r): r is NodeRecord => isNode(r) && typeof r.props?.['key'] === 'string');
}

function sourceKey(n: NodeRecord): string {
  return n.props['key'] as string;
}

/** Structural deep-equality for JSON-like `props` values (order-insensitive on object keys). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) if (!deepEqual(ao[k], bo[k])) return false;
  return true;
}

/**
 * Fields that differ between two source-managed nodes, comparing ONLY normalized content —
 * `type`, `typeName`, `label`, and each `props.*` key. Layout (`x,y,z,w,h`), `visual`, `version`
 * and `id` are ignored, so a laid-out node is never reported as drifted for having moved.
 */
function driftedFields(from: NodeRecord, to: NodeRecord): string[] {
  const fields: string[] = [];
  if (from.type !== to.type) fields.push('type');
  if (from.typeName !== to.typeName) fields.push('typeName');
  if (from.label !== to.label) fields.push('label');
  const keys = new Set([...Object.keys(from.props ?? {}), ...Object.keys(to.props ?? {})]);
  for (const k of keys) {
    if (!deepEqual(from.props?.[k], to.props?.[k])) fields.push(`props.${k}`);
  }
  return fields;
}

/** Node-level drift of the current diagram's source-managed records vs a freshly re-imported set. */
export function computeDrift(current: NodusRecord[], incoming: NodusRecord[]): DriftResult {
  const curByKey = new Map(sourceManagedNodes(current).map((n) => [sourceKey(n), n]));
  const incByKey = new Map(sourceManagedNodes(incoming).map((n) => [sourceKey(n), n]));

  const added: NodeRecord[] = [];
  const changed: DriftChange[] = [];
  let unchanged = 0;

  for (const [key, inc] of incByKey) {
    const cur = curByKey.get(key);
    if (!cur) {
      added.push(inc);
      continue;
    }
    const fields = driftedFields(cur, inc);
    if (fields.length > 0) changed.push({ key, from: cur, to: inc, fields });
    else unchanged++;
  }

  const removed: NodeRecord[] = [];
  for (const [key, cur] of curByKey) {
    if (!incByKey.has(key)) removed.push(cur);
  }

  const total = added.length + removed.length + changed.length;
  return { added, removed, changed, unchanged, total };
}

/** The bound node id of an endpoint, or null for a free (`point`) endpoint. */
function endpointNodeId(ep: Endpoint): Id<'node'> | null {
  return ep.kind === 'node' || ep.kind === 'outline' ? ep.nodeId : null;
}

/**
 * Minimal `Change[]` to re-sync the diagram's source-managed content to `incoming`. Apply as ONE
 * undo step via `editor.store.apply(driftChanges(current, incoming), { capture: 'immediately' })`:
 *
 *  - added source nodes  -> `add`, laid out in a small non-overlapping column (imported records sit at
 *    0,0, so a bare add would stack them all on the origin);
 *  - removed source nodes -> `remove`;
 *  - changed source nodes -> `update` with the incoming node's `{ type, typeName, label, props }` ONLY,
 *    PRESERVING the current node's `x,y,z,w,h,visual` so the user's layout survives;
 *  - edges: `remove` every current "imported-topology" edge (BOTH endpoints resolve to a current
 *    source-managed node), then `add` every edge from `incoming` — re-syncing the imported topology
 *    wholesale. Edges that touch a manual (non-source) node are left untouched.
 *
 * Manual (non-source) nodes are never touched.
 */
export function driftChanges(current: NodusRecord[], incoming: NodusRecord[]): Change[] {
  const drift = computeDrift(current, incoming);
  const changes: Change[] = [];

  // Added source nodes: place them in a column offset from the origin so they don't all stack at 0,0.
  drift.added.forEach((inc, i) => {
    changes.push({ op: 'add', record: { ...inc, x: 40, y: 40 + i * 90 } });
  });

  // Removed source nodes.
  for (const rec of drift.removed) changes.push({ op: 'remove', id: rec.id });

  // Changed source nodes: patch normalized content only, preserving the current node's layout/visual.
  for (const ch of drift.changed) {
    const patch: Record<string, unknown> = {
      type: ch.to.type,
      typeName: ch.to.typeName,
      props: ch.to.props,
    };
    if (ch.to.label !== undefined) patch.label = ch.to.label;
    changes.push({ op: 'update', id: ch.from.id, patch });
  }

  // Edges: drop the current imported topology, then re-add the incoming topology wholesale.
  const curSourceIds = new Set(sourceManagedNodes(current).map((n) => n.id));
  const bothEndpointsSourced = (e: EdgeRecord): boolean => {
    const a = endpointNodeId(e.from);
    const b = endpointNodeId(e.to);
    return a !== null && b !== null && curSourceIds.has(a) && curSourceIds.has(b);
  };
  for (const r of current) {
    if (isEdge(r) && bothEndpointsSourced(r)) changes.push({ op: 'remove', id: r.id });
  }
  for (const r of incoming) {
    if (isEdge(r)) changes.push({ op: 'add', record: r });
  }

  return changes;
}
