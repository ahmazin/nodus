import { describe, expect, it } from 'vitest';
import { Editor, Polygon2d, defaultTheme, resolveTokens, type EdgeRecord, type LayoutEngine, type NodeRecord } from '../index.js';

describe('per-element style bag', () => {
  it('overrides tokens for one element and round-trips', () => {
    const ed = new Editor();
    const n = ed.createNode({ type: 'rect', x: 0, y: 0 });
    ed.setStyle([n], { stroke: '#ef4444', dash: [4, 4] });
    const rec = ed.store.peek(n) as NodeRecord;
    const tokens = resolveTokens(defaultTheme, rec.visual, rec.type, rec.style);
    expect(tokens.stroke).toBe('#ef4444');
    expect(tokens.dash).toEqual([4, 4]);
    // style survives serialization
    const restored = new Editor();
    restored.loadSnapshot(ed.toJSON());
    expect((restored.store.peek(n) as NodeRecord).style?.stroke).toBe('#ef4444');
    // undoable
    ed.undo();
    expect((ed.store.peek(n) as NodeRecord).style?.stroke).toBeUndefined();
  });
});

describe('outline endpoints', () => {
  it('attach at the node boundary (not the center) and reflow on move', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 }); // center (50,50)
    const b = ed.createNode({ type: 'rect', x: 300, y: 0, w: 100, h: 100 }); // center (350,50)
    const e = ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b })!;
    const route = ed.sceneIndex.getItem(e)!.route!;
    expect(route[0]!.x).toBeCloseTo(100, 0); // right edge of A, not center (50)
    expect(route[0]!.y).toBeCloseTo(50, 0);
    const before = route[0]!.y;
    ed.moveBy([a], 0, 200); // A center -> (50,250)
    const after = ed.sceneIndex.getItem(e)!.route![0]!;
    expect(after.y).not.toBeCloseTo(before, 0); // the attachment slid along the outline
  });

  it('a floating (point) endpoint stays put when the other node moves', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const e = ed.connect({ kind: 'outline', nodeId: a }, { kind: 'point', x: 600, y: 50 })!;
    expect((ed.store.peek(e) as EdgeRecord).to.kind).toBe('point');
    const end = ed.sceneIndex.getItem(e)!.route!.at(-1)!;
    expect(end.x).toBeGreaterThan(580); // near the free point (minus arrow gap)
    ed.moveBy([a], 0, 120);
    expect((ed.store.peek(e) as EdgeRecord).to).toEqual({ kind: 'point', x: 600, y: 50 }); // unchanged
  });
});

describe('re-binding arrows', () => {
  it('dragging an edge endpoint onto a node binds it (outline); onto empty floats it', () => {
    const ed = new Editor({ viewport: { w: 900, h: 600 } });
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const c = ed.createNode({ type: 'rect', x: 550, y: 150, w: 100, h: 80 }); // center (600,190)
    const e = ed.connect({ kind: 'outline', nodeId: a }, { kind: 'point', x: 600, y: 40 })!;
    ed.select([e]);
    // grab the 'to' endpoint handle and drag onto node C
    const h = ed.edgeEndpointHandles(e)!;
    ed.pointerDown(h.to);
    ed.pointerMove({ x: 600, y: 190 }); // inside C
    ed.pointerUp({ x: 600, y: 190 });
    expect((ed.store.peek(e) as EdgeRecord).to).toEqual({ kind: 'outline', nodeId: c });
    // now drag it back to empty space -> floats
    const h2 = ed.edgeEndpointHandles(e)!;
    ed.pointerDown(h2.to);
    ed.pointerMove({ x: 800, y: 400 });
    ed.pointerUp({ x: 800, y: 400 });
    expect((ed.store.peek(e) as EdgeRecord).to.kind).toBe('point');
  });
});

describe('connect tool binds to a node body (outline), not just ports', () => {
  it('dropping off a port binds to the outline', () => {
    const ed = new Editor({ viewport: { w: 900, h: 600 } });
    ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const b = ed.createNode({ type: 'rect', x: 300, y: 0, w: 100, h: 100 });
    ed.setTool('connect');
    ed.pointerDown({ x: 100, y: 50 }); // A's right (out) port
    ed.pointerUp({ x: 350, y: 50 }); // B's center — not near a port
    expect(ed.store.edges()).toHaveLength(1);
    expect(ed.store.edges()[0]!.to).toEqual({ kind: 'outline', nodeId: b });
  });

  it('dragging from a node body (no port) makes the from-side an outline too (review #7)', () => {
    const ed = new Editor({ viewport: { w: 900, h: 600 } });
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
    ed.createNode({ type: 'rect', x: 300, y: 0, w: 100, h: 100 });
    ed.setTool('connect');
    ed.pointerDown({ x: 50, y: 50 }); // A's body center (no port)
    ed.pointerUp({ x: 350, y: 50 }); // B's body center
    expect(ed.store.edges()[0]!.from).toEqual({ kind: 'outline', nodeId: a });
  });
});

describe('review-fix regressions', () => {
  it('duplicate preserves outline-bound edges and rebinds to the copies (review #1/#4)', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const b = ed.createNode({ type: 'rect', x: 200, y: 0 });
    ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b });
    const created = ed.duplicate([a, b]);
    expect(ed.store.edges()).toHaveLength(2); // outline edge duplicated (was silently dropped before)
    const newSet = new Set(created);
    const dup = ed.store.edges().find((e) => e.from.kind === 'outline' && newSet.has((e.from as { nodeId: NodeRecord['id'] }).nodeId));
    expect(dup).toBeTruthy(); // rebinds to a copied node, not the original
  });

  it('boundaryToward finds a real boundary point on a concave shape whose center is outside (review #2)', () => {
    // an L-shape: bbox center (50,50) is OUTSIDE the fill
    const l = new Polygon2d([
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 100 }, { x: 0, y: 100 },
    ]);
    expect(l.distanceToPoint({ x: 50, y: 50 })).toBeGreaterThan(1); // center is outside
    // aim through the top bar (the ray from center at (50,50) upward crosses the fill y∈[0,40])
    const p = l.boundaryToward({ x: 50, y: -400 });
    expect(l.distanceToPoint(p)).toBeLessThan(0.5); // attaches ON the fill, not at the (outside) center
    expect(Math.hypot(p.x - 50, p.y - 50)).toBeGreaterThan(5); // not the center
  });

  it('layout sees outline-bound edges (review #3/#5)', async () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const b = ed.createNode({ type: 'rect', x: 0, y: 0 });
    ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b });
    let seenEdges = -1;
    const probe: LayoutEngine = {
      id: 'probe',
      async layout(graph) {
        seenEdges = graph.edges.length;
        const positions: Record<string, { x: number; y: number }> = {};
        graph.nodes.forEach((n, i) => (positions[n.id] = { x: i * 120, y: 0 }));
        return { positions };
      },
    };
    ed.registerLayout(probe);
    await ed.layout('probe');
    expect(seenEdges).toBe(1); // the outline edge is in the layout graph
  });

  it('dragging an endpoint onto the node the other end is on floats instead of self-looping (review #6)', () => {
    const ed = new Editor({ viewport: { w: 900, h: 600 } });
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const b = ed.createNode({ type: 'rect', x: 300, y: 0, w: 100, h: 100 });
    const e = ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b })!;
    ed.select([e]);
    const h = ed.edgeEndpointHandles(e)!;
    ed.pointerDown(h.to); // grab the B end
    ed.pointerMove({ x: 50, y: 50 }); // drag it onto A (where the from end already is)
    ed.pointerUp({ x: 50, y: 50 });
    expect((ed.store.peek(e) as EdgeRecord).to.kind).toBe('point'); // guarded -> floats, no zero-length self-loop
  });
});
