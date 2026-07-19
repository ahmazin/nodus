/**
 * Rotation must be REAL in the scene index, not just a serialized field: a rotated node has to
 * hit-test against its rotated footprint (narrow phase maps the pointer into the node's local frame)
 * and be broad-phase-indexed by the AABB that contains that rotated footprint. Each rotation-specific
 * assertion below fails on the pre-fix code (which ignored `rotation` and used axis-aligned geometry).
 *
 * Contract under test (shared with the renderer + select tool): `rotation` is radians, clockwise,
 * about the node's bounding-box center `(x + w/2, y + h/2)`.
 */
import { describe, expect, it } from 'vitest';
import {
  Rectangle2d,
  type EdgeRegistry,
  type Geometry2d,
  type Id,
  type NodeRecord,
  type NodeRegistry,
  type NodeUtil,
  type NodusRecord,
} from '../index.js';
import { SceneIndex } from './index.js';

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

function mkNode(
  id: string,
  box: { x: number; y: number; w: number; h: number },
  rotation?: number,
): NodeRecord {
  return {
    id: `node:${id}` as Id<'node'>,
    typeName: 'node',
    version: 0,
    type: 'rect',
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    ...(rotation === undefined ? {} : { rotation }),
    z: '0',
    visual: { state: 'solid' },
    props: {},
  } as NodeRecord;
}

function indexWith(node: NodeRecord): SceneIndex {
  const records = new Map<Id, NodusRecord>([[node.id, node]]);
  const idx = new SceneIndex({
    getRecord: (id: Id) => records.get(id),
    nodes: nodesRegistry(rectUtil),
    edges: noEdges,
  });
  idx.rebuild(records.values());
  return idx;
}

describe('SceneIndex — node rotation', () => {
  it('unrotated node: pointer inside its box hits, outside misses (control)', () => {
    const idx = indexWith(mkNode('a', { x: 0, y: 0, w: 100, h: 20 }));
    expect(idx.hitTest({ x: 50, y: 10 }, 4)?.id).toBe('node:a');
    expect(idx.hitTest({ x: 50, y: 55 }, 4)).toBeNull();
  });

  it('90°-rotated node hits its rotated footprint, not its axis-aligned one', () => {
    // 100×20 box at the origin, rotated a quarter turn about its center (50, 10): the visible
    // footprint becomes a 20×100 column, x∈[40,60], y∈[-40,60].
    const idx = indexWith(mkNode('a', { x: 0, y: 0, w: 100, h: 20 }, Math.PI / 2));

    // (a) inside the ROTATED column but OUTSIDE the axis-aligned 100×20 box -> now HITS.
    // (Pre-fix, rotation was ignored, so this missed.)
    expect(idx.hitTest({ x: 50, y: 55 }, 4)?.id).toBe('node:a');

    // (b) inside the axis-aligned box but OUTSIDE the rotated column -> now MISSES.
    // (Pre-fix, this wrongly hit the axis-aligned geometry.)
    expect(idx.hitTest({ x: 10, y: 10 }, 4)).toBeNull();
  });

  it('broad-phase AABB grows to the rotated footprint', () => {
    const idx = indexWith(mkNode('a', { x: 0, y: 0, w: 100, h: 20 }, Math.PI / 2));
    const aabb = idx.getItem('node:a' as Id)!.aabb;
    // 100×20 about center (50,10) rotated 90° -> a 20×100 box: x∈[40,60], y∈[-40,60].
    expect(aabb.x).toBeCloseTo(40, 6);
    expect(aabb.y).toBeCloseTo(-40, 6);
    expect(aabb.w).toBeCloseTo(20, 6);
    expect(aabb.h).toBeCloseTo(100, 6);
  });
});
