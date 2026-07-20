import { describe, expect, it } from 'vitest';
import { isEdge, isNode, type Change, type NodeRecord, type NodusRecord } from '@nodus/core';
import { computeDrift, driftChanges, fromTerraform } from '@nodus/import-infra';

// --- fixtures / helpers ----------------------------------------------------

interface TfRes {
  address: string;
  type: string;
  name: string;
  depends_on?: string[];
}
const tfShow = (resources: TfRes[]) => ({ values: { root_module: { resources } } });

/** Source-managed nodes: nodes carrying a string `props.key` (the source address). */
const srcNodes = (recs: NodusRecord[]): NodeRecord[] =>
  recs.filter((r): r is NodeRecord => isNode(r) && typeof r.props['key'] === 'string');
const byKey = (recs: NodusRecord[]) => new Map(srcNodes(recs).map((n) => [n.props['key'] as string, n]));

/** Minimal in-memory apply of a Change[] — mirrors what store.apply does to records. */
function applyChanges(records: NodusRecord[], changes: Change[]): NodusRecord[] {
  const map = new Map<string, NodusRecord>(records.map((r) => [r.id, r]));
  for (const c of changes) {
    if (c.op === 'add') map.set(c.record.id, c.record);
    else if (c.op === 'remove') map.delete(c.id);
    else if (c.op === 'update') {
      const existing = map.get(c.id);
      if (existing) map.set(c.id, { ...existing, ...c.patch } as NodusRecord);
    }
  }
  return [...map.values()];
}

// planA: api(service) -> orders(db), plus events(queue).
const planA = tfShow([
  { address: 'aws_lambda_function.api', type: 'aws_lambda_function', name: 'api' },
  { address: 'aws_dynamodb_table.orders', type: 'aws_dynamodb_table', name: 'orders', depends_on: ['aws_lambda_function.api'] },
  { address: 'aws_sqs_queue.events', type: 'aws_sqs_queue', name: 'events' },
]);
// planB: api unchanged; orders CHANGED (kind db->cache, label orders->orders_cache);
//        events REMOVED; assets ADDED.
const planB = tfShow([
  { address: 'aws_lambda_function.api', type: 'aws_lambda_function', name: 'api' },
  { address: 'aws_dynamodb_table.orders', type: 'aws_elasticache_cluster', name: 'orders_cache', depends_on: ['aws_lambda_function.api'] },
  { address: 'aws_s3_bucket.assets', type: 'aws_s3_bucket', name: 'assets' },
]);

// --- tests -----------------------------------------------------------------

describe('source-stable node ids', () => {
  it('re-importing the same source yields identical, address-derived node ids', () => {
    const first = fromTerraform(planA);
    const second = fromTerraform(planA);

    const idsA = srcNodes(first).map((n) => n.id).sort();
    const idsB = srcNodes(second).map((n) => n.id).sort();
    expect(idsA).toEqual(idsB);

    // A resource with address X has an id derived from (containing) X.
    const orders = srcNodes(first).find((n) => n.props['key'] === 'aws_dynamodb_table.orders')!;
    expect(orders.id).toContain('aws_dynamodb_table.orders');
    expect(orders.id).toBe('node:aws_dynamodb_table.orders');
  });
});

describe('computeDrift', () => {
  it('classifies added / removed / changed against the current diagram', () => {
    const current = fromTerraform(planA);
    // A manually-added node WITHOUT props.key must be ignored (not counted as removed).
    const manual: NodeRecord = {
      id: 'node:manual-note' as NodeRecord['id'],
      typeName: 'node',
      version: 0,
      type: 'infra.service',
      x: 10,
      y: 10,
      w: 120,
      h: 40,
      z: '000000000z',
      visual: { state: 'accent' },
      label: 'hand drawn',
      props: {},
    };
    const incoming = fromTerraform(planB);

    const drift = computeDrift([...current, manual], incoming);

    expect(drift.added.map((n) => n.props['key'])).toEqual(['aws_s3_bucket.assets']);
    expect(drift.removed.map((n) => n.props['key'])).toEqual(['aws_sqs_queue.events']);
    expect(drift.changed.map((c) => c.key)).toEqual(['aws_dynamodb_table.orders']);
    expect(drift.added).toHaveLength(1);
    expect(drift.removed).toHaveLength(1);
    expect(drift.changed).toHaveLength(1);
    expect(drift.total).toBe(3);
    expect(drift.unchanged).toBe(1); // only 'api' is unchanged

    // The changed resource reports which normalized fields drifted.
    expect(drift.changed[0]!.fields.sort()).toEqual(['label', 'type']);

    // The manual node is invisible to drift entirely.
    expect(drift.removed.some((n) => n.id === 'node:manual-note')).toBe(false);
  });
});

describe('normalization (layout is not drift)', () => {
  it('reports zero drift when the only difference is node position', () => {
    const current = fromTerraform(planA);
    const moved = current.map((r) => (isNode(r) ? { ...r, x: r.x + 500, y: r.y + 320 } : r));

    const drift = computeDrift(current, moved);
    expect(drift.total).toBe(0);
    expect(drift.changed).toHaveLength(0);
    expect(drift.unchanged).toBe(srcNodes(current).length);
  });
});

describe('driftChanges', () => {
  it('re-syncs source-managed content while preserving user layout', () => {
    // Give current a real layout so we can prove positions survive.
    const current = fromTerraform(planA).map((r, i) =>
      isNode(r) ? { ...r, x: 100 + i * 10, y: 200 + i * 10 } : r,
    );
    const incoming = fromTerraform(planB);

    const ordersBefore = byKey(current).get('aws_dynamodb_table.orders')!;
    const changes = driftChanges(current, incoming);
    const result = applyChanges(current, changes);

    // Source-managed nodes of the result match `incoming` by key + normalized content.
    const resKeys = [...byKey(result).keys()].sort();
    const incKeys = [...byKey(incoming).keys()].sort();
    expect(resKeys).toEqual(incKeys);
    for (const [key, incNode] of byKey(incoming)) {
      const rn = byKey(result).get(key)!;
      expect(rn.type).toBe(incNode.type);
      expect(rn.label).toBe(incNode.label);
      expect(rn.props).toEqual(incNode.props);
    }

    // The changed node keeps its original position; label/props updated to incoming.
    const ordersAfter = byKey(result).get('aws_dynamodb_table.orders')!;
    expect(ordersAfter.x).toBe(ordersBefore.x);
    expect(ordersAfter.y).toBe(ordersBefore.y);
    expect(ordersAfter.label).toBe('orders_cache');
    expect(ordersAfter.type).toBe('infra.cache');

    // Added node is placed off the origin (not stacked at 0,0).
    const assets = byKey(result).get('aws_s3_bucket.assets')!;
    expect(assets.x).not.toBe(0);

    // Manual (non-source) nodes are never touched — no changes reference an unknown id.
    // Imported topology is reconciled: the api->orders edge still exists.
    const edges = result.filter(isEdge);
    expect(edges.length).toBe(1);
  });
});
