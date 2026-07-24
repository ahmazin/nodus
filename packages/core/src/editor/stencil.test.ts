import { describe, expect, it } from 'vitest';
import { Editor, isEdge, isNode, type Endpoint, type Id, type NodeRecord } from '../index.js';

/** The node id an endpoint references, or null for a free `point` endpoint. */
const epNodeId = (ep: Endpoint): Id<'node'> | null => (ep.kind === 'point' ? null : ep.nodeId);

describe('captureStencil', () => {
  it('normalizes 2 nodes + 1 edge into an id-stable, origin-anchored fragment', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 100, y: 50, label: 'A' });
    const b = ed.createNode({ type: 'rect', x: 300, y: 90, label: 'B' });
    ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b });

    const frag = ed.captureStencil([a, b]);
    const nodes = frag.filter(isNode);
    const edges = frag.filter(isEdge);

    // (1) ids renumbered deterministically: node:n0/n1, edge:e0
    expect(nodes.map((n) => n.id).sort()).toEqual(['node:n0', 'node:n1']);
    expect(edges.map((e) => e.id)).toEqual(['edge:e0']);

    // every record's churny version counter is zeroed so a serialized library diffs cleanly
    expect(frag.every((r) => r.version === 0)).toBe(true);

    // (2) the edge's endpoints reference the normalized node ids
    const nodeIds = new Set<Id>(nodes.map((n) => n.id));
    const e0 = edges[0]!;
    expect(nodeIds.has(epNodeId(e0.from)!)).toBe(true);
    expect(nodeIds.has(epNodeId(e0.to)!)).toBe(true);

    // (3) positions are bbox-relative — min corner sits at the origin, spacing preserved
    expect(Math.min(...nodes.map((n) => n.x))).toBe(0);
    expect(Math.min(...nodes.map((n) => n.y))).toBe(0);
    expect(nodes.map((n) => n.x).sort((p, q) => p - q)).toEqual([0, 200]);
    expect(nodes.map((n) => n.y).sort((p, q) => p - q)).toEqual([0, 40]);

    // the store and the originals are untouched (capture is a pure read)
    expect(ed.store.nodes()).toHaveLength(2);
    expect((ed.store.peek(a) as NodeRecord).x).toBe(100);
  });

  it('drops an edge whose endpoint is outside the captured selection', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const b = ed.createNode({ type: 'rect', x: 100, y: 0 });
    const c = ed.createNode({ type: 'rect', x: 200, y: 0 });
    ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b }); // both captured
    ed.connect({ kind: 'outline', nodeId: b }, { kind: 'outline', nodeId: c }); // c is NOT captured

    const frag = ed.captureStencil([a, b]);
    const edges = frag.filter(isEdge);
    expect(edges).toHaveLength(1); // only the a-b edge survives

    // no dangling refs: every endpoint resolves to a node inside the fragment
    const nodeIds = new Set<Id>(frag.filter(isNode).map((n) => n.id));
    for (const e of edges) {
      expect(nodeIds.has(epNodeId(e.from)!)).toBe(true);
      expect(nodeIds.has(epNodeId(e.to)!)).toBe(true);
    }
  });
});

describe('placeStencil', () => {
  it('clones a fragment into the doc with fresh ids at the target, as one undo', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 10, y: 20, label: 'A' });
    const b = ed.createNode({ type: 'rect', x: 210, y: 60, label: 'B' });
    ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b });
    const frag = ed.captureStencil([a, b]);

    const newIds = ed.placeStencil(frag, { x: 200, y: 120 });
    const newNodeIds = newIds.filter((id) => id.startsWith('node:'));
    expect(newNodeIds).toHaveLength(2); // placeStencil now also returns the placed edge id

    // fresh ids — neither the normalized fragment ids nor any pre-existing id (checks edges too)
    const preIds = new Set<Id>([a, b]);
    for (const id of newIds) {
      expect(['node:n0', 'node:n1']).not.toContain(id);
      expect(preIds.has(id)).toBe(false);
    }
    expect(ed.store.nodes()).toHaveLength(4);
    expect(ed.store.edges()).toHaveLength(2);

    // fragment origin (0,0) lands the top-left node at the target point
    const placed = newNodeIds.map((id) => ed.store.peek(id) as NodeRecord);
    expect(Math.min(...placed.map((n) => n.x))).toBe(200);
    expect(Math.min(...placed.map((n) => n.y))).toBe(120);

    // the placed edge is rewired to the new nodes, not the originals
    const newSet = new Set<Id>(newNodeIds);
    const placedEdge = ed.store.edges().find((e) => {
      const f = epNodeId(e.from);
      return f !== null && newSet.has(f);
    });
    expect(placedEdge).toBeTruthy();
    expect(newSet.has(epNodeId(placedEdge!.from)!)).toBe(true);
    expect(newSet.has(epNodeId(placedEdge!.to)!)).toBe(true);

    // one undo entry removes the whole placement
    ed.undo();
    expect(ed.store.nodes()).toHaveLength(2);
    expect(ed.store.edges()).toHaveLength(1);
  });

  it('round-trips capture -> place, preserving subgraph shape at the new location', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const b = ed.createNode({ type: 'rect', x: 100, y: 0 });
    const c = ed.createNode({ type: 'rect', x: 200, y: 0 });
    ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b });
    ed.connect({ kind: 'outline', nodeId: b }, { kind: 'outline', nodeId: c });

    const frag = ed.captureStencil([a, b, c]);
    const newIds = ed.placeStencil(frag, { x: 500, y: 500 });
    const newNodeIds = newIds.filter((id) => id.startsWith('node:'));
    expect(newNodeIds).toHaveLength(3); // same node count (placeStencil now also returns edge ids)

    const newSet = new Set<Id>(newNodeIds);
    const placedEdges = ed.store.edges().filter((e) => {
      const f = epNodeId(e.from);
      const t = epNodeId(e.to);
      return f !== null && t !== null && newSet.has(f) && newSet.has(t);
    });
    expect(placedEdges).toHaveLength(2); // same edge count within the placed copy

    // same connectivity: a path a-b-c has node degrees [1, 1, 2]
    const deg = new Map<Id, number>();
    for (const e of placedEdges) {
      const f = epNodeId(e.from)!;
      const t = epNodeId(e.to)!;
      deg.set(f, (deg.get(f) ?? 0) + 1);
      deg.set(t, (deg.get(t) ?? 0) + 1);
    }
    expect([...deg.values()].sort()).toEqual([1, 1, 2]);

    // the copy sits at the new location
    const placed = newNodeIds.map((id) => ed.store.peek(id) as NodeRecord);
    expect(Math.min(...placed.map((n) => n.x))).toBe(500);
    expect(Math.min(...placed.map((n) => n.y))).toBe(500);
  });
});
