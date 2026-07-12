/**
 * Built-in types so the core is usable on its own: a generic rounded-`rect` node and a straight
 * `line` edge. Presets register richer types through the same public interfaces.
 */

import { Rectangle2d, type Geometry2d } from '../geometry/index.js';
import type { EdgeRecord, NodeRecord, Vec2 } from '../model.js';
import type { DrawApi } from '../renderer/draw-api.js';
import type {
  EdgeRouteContext,
  EdgeUtil,
  NodeUtil,
  Port,
} from '../registries/index.js';
import { straightRouter } from '../routing/index.js';
import type { ResolvedTokens } from '../theme/index.js';

export const rectNodeUtil: NodeUtil = {
  type: 'rect',
  getDefaultProps: () => ({}),
  getDefaultSize: () => ({ w: 130, h: 56 }),
  getGeometry(node: NodeRecord): Geometry2d {
    return new Rectangle2d({ x: node.x, y: node.y, w: node.w, h: node.h });
  },
  getPorts(): Port[] {
    return [
      { id: 'in', kind: 'target', anchor: { x: 0, y: 0.5 } },
      { id: 'out', kind: 'source', anchor: { x: 1, y: 0.5 } },
      { id: 'top', kind: 'both', anchor: { x: 0.5, y: 0 } },
      { id: 'bottom', kind: 'both', anchor: { x: 0.5, y: 1 } },
    ];
  },
  draw(api: DrawApi, node: NodeRecord, tokens: ResolvedTokens): void {
    const box = { x: node.x, y: node.y, w: node.w, h: node.h };
    api.fillRoundRect(box, tokens.radius, tokens.fill, { glow: tokens.glow, glowBlur: 12 });
    api.strokeRoundRect(box, tokens.radius, tokens.stroke, {
      width: tokens.strokeWidth,
      dash: tokens.dash,
    });
    const label = tokens.labelOverride ?? node.label ?? '';
    if (label) api.label(label, { x: node.x + node.w / 2, y: node.y + node.h / 2 });
  },
};

const ARROW_GAP = 6;
const ARROW_SIZE = 8;

/** Draw an edge's optional label as a chip at the route midpoint. Shared by edge types. */
export function drawEdgeLabel(api: DrawApi, edge: EdgeRecord, tokens: ResolvedTokens, route: Vec2[]): void {
  if (!edge.label || route.length === 0) return;
  const mid = route[Math.floor(route.length / 2)] ?? route[0]!;
  const w = api.measureLabel(edge.label, 10) + 10;
  api.ctx.save();
  api.ctx.globalAlpha *= 0.94;
  api.fillRoundRect({ x: mid.x - w / 2, y: mid.y - 9, w, h: 18 }, 5, tokens.fill);
  api.ctx.restore();
  api.label(edge.label, { x: mid.x, y: mid.y }, { fontSize: 10, color: tokens.text });
}

/** A frame/group: a low-z container that visually encloses its children (linked by `parentId`). */
export const groupNodeUtil: NodeUtil = {
  type: 'group',
  getDefaultProps: () => ({}),
  getDefaultSize: () => ({ w: 240, h: 160 }),
  getGeometry(node: NodeRecord): Geometry2d {
    return new Rectangle2d({ x: node.x, y: node.y, w: node.w, h: node.h });
  },
  capabilities: { canConnect: false, canResize: true, canEdit: true, canRotate: false },
  draw(api: DrawApi, node: NodeRecord, tokens: ResolvedTokens): void {
    const box = { x: node.x, y: node.y, w: node.w, h: node.h };
    api.ctx.save();
    api.ctx.globalAlpha *= 0.3;
    api.fillRoundRect(box, 10, tokens.fill);
    api.ctx.restore();
    api.strokeRoundRect(box, 10, tokens.stroke, { width: 1, dash: [6, 5] });
    const label = tokens.labelOverride ?? node.label ?? 'Group';
    if (label) {
      const w = api.measureLabel(label, 10) + 14;
      api.fillRoundRect({ x: node.x + 8, y: node.y - 9, w, h: 18 }, 5, tokens.stroke);
      api.label(label, { x: node.x + 8 + w / 2, y: node.y }, { fontSize: 10, color: tokens.fill });
    }
  },
};

export const lineEdgeUtil: EdgeUtil = {
  type: 'line',
  hitWidth: 8,
  getRoute(_edge: EdgeRecord, ctx: EdgeRouteContext): Vec2[] {
    const router = ctx.router ?? straightRouter;
    return router.route({
      from: ctx.from,
      to: ctx.to,
      ...(ctx.waypoints ? { waypoints: ctx.waypoints } : {}),
      ...(ctx.fromBox ? { fromBox: ctx.fromBox } : {}),
      ...(ctx.toBox ? { toBox: ctx.toBox } : {}),
      endGap: ARROW_GAP,
    });
  },
  draw(api: DrawApi, edge: EdgeRecord, tokens: ResolvedTokens, route: Vec2[]): void {
    api.strokePolyline(route, tokens.stroke, { width: tokens.strokeWidth, dash: tokens.dash });
    const a = route[route.length - 2];
    const b = route[route.length - 1];
    if (a && b) api.arrowhead(b, Math.atan2(b.y - a.y, b.x - a.x), ARROW_SIZE, tokens.stroke);
    drawEdgeLabel(api, edge, tokens, route);
  },
};
