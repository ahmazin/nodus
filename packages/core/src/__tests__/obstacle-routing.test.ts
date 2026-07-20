import { describe, expect, it } from 'vitest';
import {
  Editor,
  orthogonalRouter,
  padBox,
  segmentHitsBoxInterior,
  type Box,
  type Vec2,
} from '../index.js';

/** Every consecutive pair of an orthogonal polyline must be horizontal or vertical. */
function assertAxisAligned(pts: Vec2[]): void {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const axisAligned = Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6;
    expect(axisAligned).toBe(true);
  }
}

/** Does any leg of the polyline pass through the interior of `box`? */
function anyLegHitsInterior(pts: Vec2[], box: Box): boolean {
  for (let i = 1; i < pts.length; i++) {
    if (segmentHitsBoxInterior(pts[i - 1]!, pts[i]!, box)) return true;
  }
  return false;
}

describe('orthogonal obstacle avoidance — fast path', () => {
  it('reproduces the midpoint-X elbow byte-for-byte when there are no obstacles', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 60 };
    // the exact elbow orthogonalRouter produced before obstacle support existed
    const elbow = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 60 },
      { x: 100, y: 60 },
    ];
    expect(orthogonalRouter.route({ from, to })).toEqual(elbow);
    // an obstacle nowhere near the corridor must not perturb the fast path
    const far: Box = { x: 200, y: 200, w: 50, h: 50 };
    expect(orthogonalRouter.route({ from, to, obstacles: [far] })).toEqual(elbow);
  });

  it('keeps the elbow longer than the straight route for offset endpoints (no collapse)', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 300, y: 160 };
    const ortho = orthogonalRouter.route({ from, to });
    const orthoLen = polylineLength(ortho);
    const straightLen = Math.hypot(to.x - from.x, to.y - from.y);
    expect(orthoLen).toBeGreaterThan(straightLen);
  });
});

describe('orthogonal obstacle avoidance — detour', () => {
  it('routes around a node sitting on the straight path', () => {
    const from = { x: 0, y: 50 };
    const to = { x: 200, y: 50 };
    const rawBox: Box = { x: 80, y: 0, w: 40, h: 100 };
    const obstacle = padBox(rawBox, 10);

    // Without the obstacle: a straight horizontal segment that slices through it.
    const naive = orthogonalRouter.route({ from, to });
    expect(anyLegHitsInterior(naive, obstacle)).toBe(true);

    // With the obstacle: a detour that clears the padded box.
    const routed = orthogonalRouter.route({ from, to, obstacles: [obstacle] });
    assertAxisAligned(routed);
    expect(routed[0]).toEqual(from);
    expect(routed.at(-1)).toEqual(to);
    expect(anyLegHitsInterior(routed, obstacle)).toBe(false);
    // it actually detoured (more than the naive 2-point straight run)
    expect(routed.length).toBeGreaterThan(naive.length);
  });

  it('every avoidance segment stays axis-aligned', () => {
    const routed = orthogonalRouter.route({
      from: { x: 0, y: 50 },
      to: { x: 300, y: 50 },
      obstacles: [padBox({ x: 120, y: 20, w: 60, h: 80 }, 10)],
    });
    assertAxisAligned(routed);
  });
});

describe('orthogonal obstacle avoidance — waypoints', () => {
  it('passes through a waypoint exactly while avoiding per sub-segment', () => {
    const from = { x: 0, y: 50 };
    const waypoint = { x: 150, y: 50 };
    const to = { x: 300, y: 50 };
    // the obstacle blocks only the second leg (waypoint -> to)
    const obstacle = padBox({ x: 200, y: 0, w: 40, h: 100 }, 10);
    const routed = orthogonalRouter.route({ from, to, waypoints: [waypoint], obstacles: [obstacle] });

    assertAxisAligned(routed);
    // the fixed waypoint is still visited
    expect(routed.some((p) => Math.abs(p.x - waypoint.x) < 1 && Math.abs(p.y - waypoint.y) < 1)).toBe(true);
    // and the blocked leg cleared the obstacle
    expect(anyLegHitsInterior(routed, obstacle)).toBe(false);
  });
});

describe('segmentHitsBoxInterior', () => {
  const box: Box = { x: 0, y: 0, w: 100, h: 100 };

  it('is true for a segment crossing the interior', () => {
    expect(segmentHitsBoxInterior({ x: -10, y: 50 }, { x: 110, y: 50 }, box)).toBe(true); // horizontal
    expect(segmentHitsBoxInterior({ x: 50, y: -10 }, { x: 50, y: 110 }, box)).toBe(true); // vertical
    expect(segmentHitsBoxInterior({ x: 50, y: 50 }, { x: 50, y: 50 }, box)).toBe(true); // interior point
    expect(segmentHitsBoxInterior({ x: -10, y: -10 }, { x: 110, y: 110 }, box)).toBe(true); // diagonal
  });

  it('is false for a segment hugging the boundary or outside', () => {
    expect(segmentHitsBoxInterior({ x: -10, y: 0 }, { x: 110, y: 0 }, box)).toBe(false); // along top edge
    expect(segmentHitsBoxInterior({ x: 0, y: -10 }, { x: 0, y: 110 }, box)).toBe(false); // along left edge
    expect(segmentHitsBoxInterior({ x: -10, y: 200 }, { x: 110, y: 200 }, box)).toBe(false); // outside
    expect(segmentHitsBoxInterior({ x: 200, y: 200 }, { x: 300, y: 300 }, box)).toBe(false); // diagonal outside
    expect(segmentHitsBoxInterior({ x: -10, y: 10 }, { x: 10, y: -10 }, box)).toBe(false); // only grazes corner (0,0)
  });
});

describe('orthogonal obstacle avoidance — graceful fallback', () => {
  it('does not throw and returns a valid axis-aligned polyline when an endpoint is boxed in', () => {
    const from = { x: 50, y: 50 };
    const to = { x: 300, y: 50 };
    const enclosing = padBox({ x: 0, y: 0, w: 100, h: 100 }, 0); // fully contains `from`
    let routed: Vec2[] = [];
    expect(() => {
      routed = orthogonalRouter.route({ from, to, obstacles: [enclosing] });
    }).not.toThrow();
    expect(routed.length).toBeGreaterThanOrEqual(2);
    assertAxisAligned(routed);
    expect(routed[0]).toEqual(from);
    expect(routed.at(-1)).toEqual(to);
  });
});

describe('orthogonal obstacle avoidance — via Editor + SceneIndex', () => {
  it('routes an edge around a third node placed directly between the endpoints', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 }); // 130x56 -> out port (130,28)
    const b = ed.createNode({ type: 'rect', x: 400, y: 0 }); // in port (400,28)
    const mid = ed.createNode({ type: 'rect', x: 200, y: 0 }); // box [200,330]x[0,56]
    const e = ed.connect(
      { kind: 'node', nodeId: a, portId: 'out' },
      { kind: 'node', nodeId: b, portId: 'in' },
    )!;
    ed.setEdgeRouter(e, 'orthogonal');

    const route = ed.sceneIndex.getItem(e)!.route!;
    const midRecord = ed.store.peek(mid) as { x: number; y: number; w: number; h: number };
    const midBox: Box = { x: midRecord.x, y: midRecord.y, w: midRecord.w, h: midRecord.h };

    assertAxisAligned(route);
    expect(anyLegHitsInterior(route, midBox)).toBe(false);
    // it genuinely bent around the node rather than cutting straight across
    expect(route.length).toBeGreaterThan(2);
  });
});

function polylineLength(pts: Vec2[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  }
  return total;
}
