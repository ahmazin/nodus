/**
 * A single non-finite (NaN/Infinity) node coordinate must NOT poison the whole scene index. rbush
 * folds child boxes with Math.min/Math.max, so one NaN/Infinity box drives every ancestor bbox — up
 * to the root — non-finite, after which EVERY spatial query intersects against NaN and returns
 * nothing: a blank canvas, an empty marquee, and a non-finite `contentBounds()` that breaks
 * zoomToFit/export. The fix drops the unbuildable record (surfacing it via `onError`) so all healthy
 * records stay hit-testable and finite.
 *
 * Each assertion below fails on the pre-fix code, which inserted the bad box straight into the tree
 * (incremental `insert`) or into the bulk `load` — poisoning queries for every other node.
 */
import { describe, expect, it } from 'vitest';
import {
  Rectangle2d,
  type Change,
  type EdgeRegistry,
  type Geometry2d,
  type Id,
  type NodeRecord,
  type NodeRegistry,
  type NodeUtil,
  type NodusRecord,
} from '../index.js';
import { SceneIndex, type SceneIndexErrorContext } from './index.js';

const rectUtil: NodeUtil = {
  type: 'rect',
  getDefaultProps: () => ({}),
  getGeometry: (n: NodeRecord): Geometry2d => new Rectangle2d({ x: n.x, y: n.y, w: n.w, h: n.h }),
  draw: () => {},
};

function nodesRegistry(...utils: NodeUtil[]): NodeRegistry {
  const map = new Map(utils.map((u) => [u.type, u]));
  return { get: (t: string) => map.get(t) } as unknown as NodeRegistry;
}

const noEdges = { get: () => undefined } as unknown as EdgeRegistry;

function mkNode(id: string, box: { x: number; y: number; w: number; h: number }): NodeRecord {
  return {
    id: `node:${id}` as Id<'node'>,
    typeName: 'node',
    version: 0,
    type: 'rect',
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    z: '0',
    visual: { state: 'solid' },
    props: {},
  } as NodeRecord;
}

function makeIndex(onError?: (err: unknown, ctx: SceneIndexErrorContext) => void): {
  records: Map<Id, NodusRecord>;
  idx: SceneIndex;
} {
  const records = new Map<Id, NodusRecord>();
  const idx = new SceneIndex({
    getRecord: (id: Id) => records.get(id),
    nodes: nodesRegistry(rectUtil),
    edges: noEdges,
    ...(onError ? { onError } : {}),
  });
  return { records, idx };
}

function allFinite(box: { x: number; y: number; w: number; h: number }): boolean {
  return (
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.w) &&
    Number.isFinite(box.h)
  );
}

describe('SceneIndex — non-finite geometry guard', () => {
  it('an incremental NaN-coordinate add leaves every healthy node hit-testable and bounds finite', () => {
    const ctxs: SceneIndexErrorContext[] = [];
    const { records, idx } = makeIndex((_e, ctx) => ctxs.push(ctx));

    const a = mkNode('a', { x: 0, y: 0, w: 100, h: 100 });
    records.set(a.id, a);
    idx.rebuild(records.values());
    expect(idx.hitTest({ x: 50, y: 50 }, 4)?.id).toBe('node:a'); // sanity, pre-poison

    const bad = mkNode('bad', { x: NaN, y: 0, w: 40, h: 40 });
    records.set(bad.id, bad);
    idx.applyChanges([{ op: 'add', record: bad } as Change]);

    // the poison record is dropped (never indexed) and surfaced via onError
    expect(idx.getItem('node:bad' as Id)).toBeUndefined();
    expect(ctxs).toContainEqual({ phase: 'non-finite', kind: 'node', id: bad.id });

    // and the healthy node is UNTOUCHED: still hit-testable, still visible, bounds still finite
    expect(idx.hitTest({ x: 50, y: 50 }, 4)?.id).toBe('node:a');
    expect(idx.visible({ x: -10, y: -10, w: 200, h: 200 }).map((it) => it.id)).toEqual(['node:a']);
    const bounds = idx.contentBounds();
    expect(bounds).not.toBeNull();
    expect(allFinite(bounds!)).toBe(true);
    expect(bounds).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it('a bulk rebuild containing an Infinity-coordinate node still indexes the healthy nodes', () => {
    const ctxs: SceneIndexErrorContext[] = [];
    const { records, idx } = makeIndex((_e, ctx) => ctxs.push(ctx));

    const a = mkNode('a', { x: 0, y: 0, w: 100, h: 100 });
    const b = mkNode('b', { x: 300, y: 300, w: 50, h: 50 });
    const bad = mkNode('bad', { x: 0, y: 0, w: Infinity, h: 40 });
    for (const n of [a, b, bad]) records.set(n.id, n);
    idx.rebuild(records.values());

    expect(idx.getItem('node:bad' as Id)).toBeUndefined();
    expect(ctxs).toContainEqual({ phase: 'non-finite', kind: 'node', id: bad.id });

    // both healthy nodes remain hit-testable through the bulk-loaded tree
    expect(idx.hitTest({ x: 50, y: 50 }, 4)?.id).toBe('node:a');
    expect(idx.hitTest({ x: 325, y: 325 }, 4)?.id).toBe('node:b');

    const bounds = idx.contentBounds();
    expect(allFinite(bounds!)).toBe(true);
    expect(bounds).toEqual({ x: 0, y: 0, w: 350, h: 350 });

    // marquee over everything selects exactly the two healthy nodes (poison never enters the tree)
    expect(new Set(idx.enclosedNodes({ x: -10, y: -10, w: 400, h: 400 }))).toEqual(
      new Set(['node:a', 'node:b']),
    );
  });

  it('drops a non-finite record safely even when no onError channel is wired', () => {
    const { records, idx } = makeIndex(); // deps.onError absent -> reportError is a safe no-op
    const a = mkNode('a', { x: 0, y: 0, w: 100, h: 100 });
    const bad = mkNode('bad', { x: 0, y: NaN, w: 40, h: 40 });
    records.set(a.id, a);
    records.set(bad.id, bad);

    expect(() => idx.rebuild(records.values())).not.toThrow();
    expect(idx.getItem('node:bad' as Id)).toBeUndefined();
    expect(idx.hitTest({ x: 50, y: 50 }, 4)?.id).toBe('node:a');
  });
});
