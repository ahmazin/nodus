/**
 * @ahmazin/import-infra — turn live infrastructure into a Nodus diagram.
 *  - `fromTerraform(showJson)`: parses `terraform show -json` (state or plan) — resources become
 *    nodes; edges come from `depends_on` plus implicit interpolation references inferred from the
 *    `configuration` block (e.g. `subnet_id = aws_subnet.main.id`).
 *  - `fromKubernetes(input)`: accepts multi-doc YAML/JSON (a string), a `List`, an array, or one
 *    object; maps manifest kinds to node types; Ingress→Service→workload edges are inferred from
 *    backends and label selectors. `analyzeKubernetes` additionally reports skipped (unmapped) kinds.
 * Both return infra records ready to load or hand to `InfraCanvas`.
 */

import {
  isEdge,
  isNode,
  NodusError,
  type Change,
  type EdgeRecord,
  type Endpoint,
  type Id,
  type NodeRecord,
  type NodusRecord,
} from '@ahmazin/core';
import { modelToRecords, type InfraModel } from '@ahmazin/preset-infra';
import { parseAllDocuments } from 'yaml';

/** Namespaced failure codes for this importer (F34). `parse-failed` = input is not the right format;
 *  `input-too-large` = a resource-exhaustion guard (depth/element/byte cap) tripped. */
export type ImportErrorCode = 'import-infra/parse-failed' | 'import-infra/input-too-large';

/**
 * A structured, catchable error raised at the import trust boundary. Importers parse UNTRUSTED
 * shared files (Terraform JSON, Kubernetes manifests); a malformed or hostile input surfaces as an
 * `ImportError` with a clean message rather than a raw parser exception or a stack overflow.
 *
 * It is a {@link NodusError} subclass, so it carries a machine-readable `code` and matches
 * `isNodusError(e)` across the dual-package seam — branch on `e.code`, never `instanceof` across
 * package copies.
 */
export class ImportError extends NodusError<ImportErrorCode> {
  constructor(message: string, opts: { code?: ImportErrorCode; context?: Record<string, unknown>; cause?: unknown } = {}) {
    super(opts.code ?? 'import-infra/parse-failed', message, { context: opts.context, cause: opts.cause });
    this.name = 'ImportError';
  }
}

/**
 * Recursion-depth cap for walking nested Terraform structures (child modules, expression trees).
 * Legitimate nesting is a handful of levels; anything beyond this indicates malformed or adversarial
 * input crafted to exhaust the call stack, so the walk stops with an `ImportError` instead of a crash.
 */
const MAX_DEPTH = 1000;

/**
 * Resource-exhaustion guards at the import trust boundary (pre-publication audit M2). `MAX_DEPTH` caps
 * recursion; these cap *breadth*: a large-but-linear input (Lane A measured 2,000,000 flat Terraform
 * resources → ~7s of synchronous main-thread work) still freezes the browser importer. A byte ceiling
 * on raw text and an element ceiling on the parsed model keep that bounded, throwing a catchable
 * `ImportError` instead of a silent multi-second hang. Both are far above any real infra graph.
 */
export const MAX_IMPORT_BYTES = 8_000_000;
export const MAX_IMPORT_ELEMENTS = 50_000;

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

function collectResources(mod: TfModule | undefined, out: TfResource[], depth = 0): void {
  if (!mod) return;
  if (depth > MAX_DEPTH)
    throw new ImportError(`Terraform module nesting exceeds ${MAX_DEPTH} levels — aborting import (malformed or malicious input).`, {
      code: 'import-infra/input-too-large',
      context: { reason: 'module-nesting', limit: MAX_DEPTH },
    });
  for (const r of mod.resources ?? []) out.push(r);
  for (const c of mod.child_modules ?? []) collectResources(c, out, depth + 1);
}

interface TfConfigResource {
  address: string; // module-qualified, non-indexed, e.g. "aws_instance.web" or "module.data.aws_subnet.db"
  expressions?: Record<string, unknown>;
}

interface TfConfigModule {
  resources?: Array<{ address?: string; type?: string; name?: string; expressions?: Record<string, unknown> }>;
  module_calls?: Record<string, { module?: TfConfigModule }>;
}

/** Recursively collect configuration resources, qualifying each address with its module path. */
function collectConfigResources(mod: TfConfigModule | undefined, modulePrefix: string, out: TfConfigResource[], depth = 0): void {
  if (!mod) return;
  if (depth > MAX_DEPTH)
    throw new ImportError(`Terraform configuration nesting exceeds ${MAX_DEPTH} levels — aborting import (malformed or malicious input).`, {
      code: 'import-infra/input-too-large',
      context: { reason: 'configuration-nesting', limit: MAX_DEPTH },
    });
  for (const r of mod.resources ?? []) {
    const base = r.address ?? (r.type && r.name ? `${r.type}.${r.name}` : undefined);
    if (!base) continue;
    out.push({ address: modulePrefix ? `${modulePrefix}.${base}` : base, expressions: r.expressions });
  }
  for (const [name, call] of Object.entries(mod.module_calls ?? {})) {
    collectConfigResources(call.module, modulePrefix ? `${modulePrefix}.module.${name}` : `module.${name}`, out, depth + 1);
  }
}

/** Recursively gather every `references: string[]` under an expressions tree (blocks nest arrays/objects). */
function collectReferences(expr: unknown, out: string[], depth = 0): void {
  if (!expr || typeof expr !== 'object') return;
  if (depth > MAX_DEPTH)
    throw new ImportError(`Terraform expression nesting exceeds ${MAX_DEPTH} levels — aborting import (malformed or malicious input).`, {
      code: 'import-infra/input-too-large',
      context: { reason: 'expression-nesting', limit: MAX_DEPTH },
    });
  if (Array.isArray(expr)) {
    for (const v of expr) collectReferences(v, out, depth + 1);
    return;
  }
  const o = expr as Record<string, unknown>;
  if (Array.isArray(o['references'])) for (const ref of o['references']) if (typeof ref === 'string') out.push(ref);
  for (const [k, v] of Object.entries(o)) {
    if (k === 'references' || k === 'constant_value') continue;
    collectReferences(v, out, depth + 1);
  }
}

// References that never point at a managed resource node.
const IGNORED_REF = /^(var|local|data|each|count|path|self|terraform|module)\./;

/** Resolve a reference to a known managed-resource address (module-relative first, then root), or null. */
function resolveRef(ref: string, modulePrefix: string, known: Set<string>): string | null {
  if (IGNORED_REF.test(ref)) return null;
  const candidates = modulePrefix ? [`${modulePrefix}.${ref}`, ref] : [ref];
  for (const cand of candidates) {
    const segs = cand.split('.');
    for (let len = segs.length; len >= 2; len--) {
      const prefix = segs.slice(0, len).join('.');
      if (known.has(prefix)) return prefix;
    }
  }
  return null;
}

/**
 * Index node keys (values addresses) by the config address they belong to — a node key matches its
 * exact address and, for a `count`/`for_each` instance like `aws_x.y[0]`, its base address `aws_x.y`.
 * Precomputed once so reference resolution is a Map lookup, not an O(n) scan of every key per
 * reference (which made large states O(n²)).
 */
function indexNodeKeysByConfigAddr(nodeKeys: string[]): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  const add = (addr: string, key: string): void => {
    const bucket = idx.get(addr);
    if (bucket) bucket.push(key);
    else idx.set(addr, [key]);
  };
  for (const k of nodeKeys) {
    add(k, k);
    const br = k.indexOf('[');
    if (br >= 0) add(k.slice(0, br), k);
  }
  return idx;
}

export interface TerraformAnalysis {
  records: NodusRecord[];
  skipped: { label: string; count: number }[];
  notes: string[];
}

export function analyzeTerraform(showJson: unknown): TerraformAnalysis {
  // Malformed input must be distinguishable from an empty diagram: refuse anything that is not a
  // `terraform show -json` object rather than silently returning zero records (F34).
  if (showJson === null || typeof showJson !== 'object' || Array.isArray(showJson))
    throw new ImportError('Terraform input must be a `terraform show -json` object.', {
      code: 'import-infra/parse-failed',
      context: { received: showJson === null ? 'null' : Array.isArray(showJson) ? 'array' : typeof showJson },
    });
  const root = showJson as {
    values?: { root_module?: TfModule };
    planned_values?: { root_module?: TfModule };
    configuration?: { root_module?: TfConfigModule };
  };
  if (root.values === undefined && root.planned_values === undefined && root.configuration === undefined)
    throw new ImportError('Not `terraform show -json` output — expected a `values`, `planned_values`, or `configuration` block.', {
      code: 'import-infra/parse-failed',
      context: { keys: Object.keys(root).slice(0, 20) },
    });
  const rootModule = root.values?.root_module ?? root.planned_values?.root_module;
  const resources: TfResource[] = [];
  collectResources(rootModule, resources);
  if (resources.length > MAX_IMPORT_ELEMENTS)
    throw new ImportError(`Terraform state has ${resources.length} resources (> ${MAX_IMPORT_ELEMENTS} cap) — aborting import to avoid a main-thread freeze.`, {
      code: 'import-infra/input-too-large',
      context: { reason: 'elements', count: resources.length, limit: MAX_IMPORT_ELEMENTS },
    });

  const nodeKeys = resources.map((r) => r.address);
  const addresses = new Set(nodeKeys);
  const keysByConfigAddr = indexNodeKeysByConfigAddr(nodeKeys);
  const nodeKeysFor = (configAddr: string): string[] => keysByConfigAddr.get(configAddr) ?? [];
  const model: InfraModel = {
    nodes: resources.map((r) => ({ key: r.address, type: terraformKind(r.type), label: r.name, x: 0, y: 0 })),
    edges: [],
  };

  const seen = new Set<string>();
  const addEdge = (from: string, to: string): void => {
    if (from === to) return;
    const sig = `${from} ${to}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    model.edges!.push({ from, to });
  };

  // (1) explicit depends_on — resolve each dep to a managed address via set/boundary lookup (O(1) per
  // dep), never a linear scan of every resource (which made large states O(n²)).
  const resolveDep = (dep: string): string | null => {
    if (addresses.has(dep)) return dep;
    // `dep` may be more specific than a managed address (an indexed instance or an attribute path);
    // walk its boundary-aligned prefixes and return the longest that names a known resource.
    let i = dep.length;
    while (i > 0) {
      const cut = Math.max(dep.lastIndexOf('.', i - 1), dep.lastIndexOf('[', i - 1));
      if (cut <= 0) break;
      const prefix = dep.slice(0, cut);
      if (addresses.has(prefix)) return prefix;
      i = cut;
    }
    return null;
  };
  for (const r of resources) {
    for (const dep of r.depends_on ?? []) {
      const target = resolveDep(dep);
      if (target) addEdge(target, r.address);
    }
  }

  // (2) implicit interpolation references from the configuration block
  const notes: string[] = [];
  if (root.configuration?.root_module) {
    const configResources: TfConfigResource[] = [];
    collectConfigResources(root.configuration.root_module, '', configResources);
    const known = new Set(configResources.map((c) => c.address));
    for (const c of configResources) {
      const prefix = c.address.split('.').slice(0, -2).join('.'); // strip the trailing type.name
      const refs: string[] = [];
      collectReferences(c.expressions, refs);
      for (const ref of refs) {
        const targetAddr = resolveRef(ref, prefix, known);
        if (!targetAddr) continue;
        for (const fromKey of nodeKeysFor(targetAddr))
          for (const toKey of nodeKeysFor(c.address)) addEdge(fromKey, toKey);
      }
    }
  } else {
    notes.push('state JSON — edges limited to depends_on; import a plan (terraform show -json <plan>) for full topology.');
  }

  return { records: modelToRecords(model), skipped: [], notes };
}

export function fromTerraform(showJson: unknown): NodusRecord[] {
  return analyzeTerraform(showJson).records;
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

/** Normalize string (YAML/JSON, multi-doc) or a pre-parsed array into a flat list of manifest objects. */
function toK8sObjects(input: string | K8sObject[]): K8sObject[] {
  let raw: unknown[];
  if (typeof input === 'string') {
    try {
      raw = parseAllDocuments(input).map((d) => d.toJS()).filter((v) => v != null);
    } catch (e) {
      // The YAML parser throws on adversarial input (e.g. the alias bomb it caps at maxAliasCount).
      // Surface it as a structured ImportError at the trust boundary, not a raw parser exception.
      throw new ImportError(`Invalid Kubernetes YAML: ${e instanceof Error ? e.message : String(e)}`, {
        code: 'import-infra/parse-failed',
        context: { format: 'kubernetes-yaml' },
        cause: e,
      });
    }
  } else {
    raw = input;
  }
  const objs: K8sObject[] = [];
  for (const doc of raw) {
    if (Array.isArray(doc)) objs.push(...(doc as K8sObject[]));
    else if (doc && (doc as { kind?: string }).kind === 'List' && Array.isArray((doc as { items?: unknown[] }).items))
      objs.push(...((doc as { items: K8sObject[] }).items));
    else if (doc) objs.push(doc as K8sObject);
  }
  return objs.filter((o) => o && typeof o === 'object' && typeof o.kind === 'string');
}

export interface KubernetesAnalysis {
  records: NodusRecord[];
  skipped: { label: string; count: number }[];
  notes: string[];
}

export function analyzeKubernetes(input: string | K8sObject[]): KubernetesAnalysis {
  if (typeof input === 'string' && input.length > MAX_IMPORT_BYTES)
    throw new ImportError(`Kubernetes manifest is ${input.length} bytes (> ${MAX_IMPORT_BYTES} cap) — aborting import to avoid a main-thread freeze.`, {
      code: 'import-infra/input-too-large',
      context: { reason: 'bytes', bytes: input.length, limit: MAX_IMPORT_BYTES },
    });
  const objects = toK8sObjects(input);
  if (objects.length > MAX_IMPORT_ELEMENTS)
    throw new ImportError(`Kubernetes input has ${objects.length} objects (> ${MAX_IMPORT_ELEMENTS} cap) — aborting import to avoid a main-thread freeze.`, {
      code: 'import-infra/input-too-large',
      context: { reason: 'elements', count: objects.length, limit: MAX_IMPORT_ELEMENTS },
    });
  const nodes: InfraModel['nodes'] = [];
  const edges: NonNullable<InfraModel['edges']> = [];
  const byName = new Map<string, K8sObject>();
  const skipCounts = new Map<string, number>();
  const keyOf = (o: K8sObject) => `${o.kind}/${o.metadata?.name ?? '?'}`;

  for (const o of objects) {
    const type = kubernetesKind(o.kind);
    if (!type) {
      skipCounts.set(o.kind, (skipCounts.get(o.kind) ?? 0) + 1);
      continue;
    }
    nodes.push({ key: keyOf(o), type, label: o.metadata?.name ?? o.kind, x: 0, y: 0 });
    byName.set(o.metadata?.name ?? '', o);
  }
  const included = new Set(nodes.map((n) => n.key));

  // Precompute the workload set and a `label=value` -> workloads index ONCE, so each Service resolves
  // its selector by Map lookup instead of re-scanning every object (previously O(services × objects)).
  const workloads = objects.filter(
    (w) => kubernetesKind(w.kind) !== null && w.kind !== 'Service' && w.kind !== 'Ingress',
  );
  const workloadOrder = new Map<K8sObject, number>(workloads.map((w, i) => [w, i]));
  const workloadsByLabel = new Map<string, K8sObject[]>();
  for (const w of workloads) {
    for (const [k, v] of Object.entries(workloadLabels(w))) {
      const key = `${k}\u0000${v}`;
      const bucket = workloadsByLabel.get(key);
      if (bucket) bucket.push(w);
      else workloadsByLabel.set(key, [w]);
    }
  }

  for (const o of objects) {
    if (o.kind === 'Ingress') {
      const rules = (o.spec?.rules as Array<{ http?: { paths?: Array<{ backend?: { serviceName?: string; service?: { name?: string } } }> } }>) ?? [];
      for (const rule of rules)
        for (const path of rule.http?.paths ?? []) {
          const svc = path.backend?.serviceName ?? path.backend?.service?.name;
          const target = svc && byName.get(svc);
          if (target && included.has(keyOf(o)) && included.has(keyOf(target))) edges.push({ from: keyOf(o), to: keyOf(target) });
        }
    } else if (o.kind === 'Service') {
      const selector = (o.spec?.selector as Record<string, string>) ?? {};
      const selEntries = Object.entries(selector);
      if (selEntries.length === 0) continue;
      // A full match must carry EVERY selector label, so it is guaranteed to appear in the bucket of
      // the rarest label=value pair — scan only that (smallest) candidate set, then confirm the match.
      let candidates: K8sObject[] | undefined;
      for (const [k, v] of selEntries) {
        const bucket = workloadsByLabel.get(`${k}\u0000${v}`) ?? [];
        if (candidates === undefined || bucket.length < candidates.length) candidates = bucket;
      }
      const matched = (candidates ?? []).filter(
        (w) => labelsMatch(selector, workloadLabels(w)) && included.has(keyOf(w)),
      );
      matched.sort((a, b) => (workloadOrder.get(a) ?? 0) - (workloadOrder.get(b) ?? 0)); // preserve object order
      for (const w of matched) edges.push({ from: keyOf(o), to: keyOf(w) });
    }
  }

  const skipped = [...skipCounts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  const notes: string[] = [];
  if (nodes.length === 0) notes.push('No workloads, services, or ingress found to import.');
  return { records: modelToRecords({ nodes, edges }), skipped, notes };
}

export function fromKubernetes(input: string | K8sObject[]): NodusRecord[] {
  return analyzeKubernetes(input).records;
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
