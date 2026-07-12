import { describe, expect, it } from 'vitest';
import { Editor, bezierRouter, orthogonalRouter, straightRouter, type EdgeRecord } from '../index.js';

describe('routers', () => {
  const ctx = { from: { x: 0, y: 0 }, to: { x: 100, y: 60 } };

  it('straight passes through endpoints (+ waypoints)', () => {
    expect(straightRouter.route(ctx)).toEqual([ctx.from, ctx.to]);
    const wp = { x: 50, y: 50 };
    expect(straightRouter.route({ ...ctx, waypoints: [wp] })).toEqual([ctx.from, wp, ctx.to]);
  });

  it('orthogonal produces only axis-aligned segments', () => {
    const pts = orthogonalRouter.route(ctx);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const axisAligned = Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6;
      expect(axisAligned).toBe(true);
    }
  });

  it('bezier samples a smooth multi-point curve', () => {
    const pts = bezierRouter.route(ctx);
    expect(pts.length).toBeGreaterThan(5);
    expect(pts[0]).toEqual(ctx.from);
    expect(pts.at(-1)).toEqual(ctx.to);
  });

  it('endGap trims the final segment for an arrow gap', () => {
    const pts = straightRouter.route({ from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, endGap: 6 });
    expect(pts.at(-1)!.x).toBeCloseTo(94);
  });
});

describe('editor edge routing + labels', () => {
  it('switching the router reshapes an edge route via the scene index', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const b = ed.createNode({ type: 'rect', x: 300, y: 160 });
    const e = ed.connect({ kind: 'node', nodeId: a, portId: 'out' }, { kind: 'node', nodeId: b, portId: 'in' })!;
    const straightLen = ed.sceneIndex.getItem(e)!.route!.length;
    ed.setEdgeRouter(e, 'orthogonal');
    expect(ed.sceneIndex.getItem(e)!.route!.length).toBeGreaterThan(straightLen);
    ed.setEdgeRouter(e, 'bezier');
    expect(ed.sceneIndex.getItem(e)!.route!.length).toBeGreaterThan(straightLen);
  });

  it('waypoints are inserted into the route', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const b = ed.createNode({ type: 'rect', x: 300, y: 0 });
    const e = ed.connect({ kind: 'node', nodeId: a, portId: 'out' }, { kind: 'node', nodeId: b, portId: 'in' })!;
    ed.addWaypoint(e, { x: 150, y: 120 });
    const route = ed.sceneIndex.getItem(e)!.route!;
    expect(route.some((p) => Math.abs(p.y - 120) < 1)).toBe(true);
  });

  it('edges are label-editable', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const b = ed.createNode({ type: 'rect', x: 200, y: 0 });
    const e = ed.connect({ kind: 'node', nodeId: a, portId: 'out' }, { kind: 'node', nodeId: b, portId: 'in' })!;
    expect(ed.canEdit(e)).toBe(true);
    ed.setEdgeLabel(e, 'depends on');
    expect((ed.store.peek(e) as EdgeRecord).label).toBe('depends on');
  });
});
