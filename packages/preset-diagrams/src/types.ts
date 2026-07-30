/**
 * General diagram node/edge types: flowchart (pill/process/decision), state-machine (state),
 * ERD (table), and org-chart (card), plus a labeled orthogonal flow edge. All registered through
 * the public registry — the engine stays domain-agnostic.
 */

import {
  Ellipse2d,
  Polygon2d,
  Rectangle2d,
  STENCIL,
  drawStencil,
  measureStencil,
  orthogonalRouter,
  type DrawApi,
  type EdgeRecord,
  type EdgeRouteContext,
  type EdgeUtil,
  type Geometry2d,
  type NodeRecord,
  type NodeUtil,
  type Port,
  type ResolvedTokens,
  type Vec2,
} from '@ahmazin/core';
import { imageNode } from './image.js';

const rectPorts = (): Port[] => [
  { id: 'in', kind: 'target', anchor: { x: 0.5, y: 0 } },
  { id: 'out', kind: 'source', anchor: { x: 0.5, y: 1 } },
  { id: 'l', kind: 'both', anchor: { x: 0, y: 0.5 } },
  { id: 'r', kind: 'both', anchor: { x: 1, y: 0.5 } },
];

export const pillNode: NodeUtil = {
  type: 'pill',
  getDefaultProps: () => ({}),
  getDefaultSize: () => ({ w: 120, h: 44 }),
  getGeometry: (n) => new Rectangle2d({ x: n.x, y: n.y, w: n.w, h: n.h }),
  getPorts: rectPorts,
  draw: (api, n, t) => {
    const box = { x: n.x, y: n.y, w: n.w, h: n.h };
    api.fillRoundRect(box, n.h / 2, t.fill, { glow: t.glow ?? undefined });
    api.strokeRoundRect(box, n.h / 2, t.stroke, { width: t.strokeWidth });
    api.label(n.label ?? '', { x: n.x + n.w / 2, y: n.y + n.h / 2 }, { weight: '600' });
  },
};

export const processNode: NodeUtil = {
  type: 'process',
  getDefaultProps: () => ({}),
  getDefaultSize: () => ({ w: 150, h: 56 }),
  getGeometry: (n) => new Rectangle2d({ x: n.x, y: n.y, w: n.w, h: n.h }),
  getPorts: rectPorts,
  draw: (api, n, t) => {
    const box = { x: n.x, y: n.y, w: n.w, h: n.h };
    api.fillRoundRect(box, 8, t.fill, { glow: t.glow ?? undefined });
    api.strokeRoundRect(box, 8, t.stroke, { width: t.strokeWidth });
    api.label(n.label ?? '', { x: n.x + n.w / 2, y: n.y + n.h / 2 });
  },
};

function diamondPoints(n: NodeRecord): Vec2[] {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  return [
    { x: cx, y: n.y },
    { x: n.x + n.w, y: cy },
    { x: cx, y: n.y + n.h },
    { x: n.x, y: cy },
  ];
}
export const decisionNode: NodeUtil = {
  type: 'decision',
  getDefaultProps: () => ({}),
  getDefaultSize: () => ({ w: 150, h: 92 }),
  getGeometry: (n): Geometry2d => new Polygon2d(diamondPoints(n)),
  getPorts: () => [
    { id: 'in', kind: 'target', anchor: { x: 0.5, y: 0 } },
    { id: 'yes', kind: 'source', anchor: { x: 1, y: 0.5 } },
    { id: 'no', kind: 'source', anchor: { x: 0.5, y: 1 } },
  ],
  draw: (api, n, t) => {
    const pts = diamondPoints(n);
    api.fillPolygon(pts, t.fill, { glow: t.glow ?? undefined });
    api.strokePolyline([...pts, pts[0]!], t.stroke, { width: t.strokeWidth });
    api.label(n.label ?? '', { x: n.x + n.w / 2, y: n.y + n.h / 2 });
  },
};

export const stateNode: NodeUtil = {
  type: 'state',
  getDefaultProps: () => ({}),
  getDefaultSize: () => ({ w: 120, h: 64 }),
  getGeometry: (n) => new Ellipse2d({ x: n.x, y: n.y, w: n.w, h: n.h }),
  getPorts: () => [
    { id: 'l', kind: 'both', anchor: { x: 0, y: 0.5 } },
    { id: 'r', kind: 'both', anchor: { x: 1, y: 0.5 } },
    { id: 't', kind: 'both', anchor: { x: 0.5, y: 0 } },
    { id: 'b', kind: 'both', anchor: { x: 0.5, y: 1 } },
  ],
  draw: (api, n, t) => {
    const box = { x: n.x, y: n.y, w: n.w, h: n.h };
    api.fillEllipse(box, t.fill, { glow: t.glow ?? undefined });
    api.strokeEllipse(box, t.stroke, { width: t.strokeWidth });
    api.label(n.label ?? '', { x: n.x + n.w / 2, y: n.y + n.h / 2 }, { weight: '600' });
  },
};

export const ROW_H = 22;
export const tableNode: NodeUtil = {
  type: 'table',
  getDefaultProps: () => ({ columns: [] }),
  getGeometry: (n) => new Rectangle2d({ x: n.x, y: n.y, w: n.w, h: n.h }),
  getPorts: () => [
    { id: 'l', kind: 'both', anchor: { x: 0, y: 0.5 } },
    { id: 'r', kind: 'both', anchor: { x: 1, y: 0.5 } },
  ],
  draw: (api, n, t) => {
    const cols = (n.props.columns as string[]) ?? [];
    const { ctx } = api;
    const box = { x: n.x, y: n.y, w: n.w, h: n.h };
    api.fillRoundRect(box, 8, t.fill, { glow: t.glow ?? undefined });
    ctx.save();
    ctx.fillStyle = t.stroke;
    ctx.globalAlpha *= 0.18;
    ctx.beginPath();
    ctx.rect(n.x, n.y, n.w, 26);
    ctx.fill();
    ctx.restore();
    api.strokeRoundRect(box, 8, t.stroke, { width: t.strokeWidth });
    api.label(n.label ?? '', { x: n.x + n.w / 2, y: n.y + 13 }, { weight: '700', color: t.stroke });
    ctx.save();
    ctx.font = `${t.fontSize}px ${t.fontFamily}`;
    ctx.fillStyle = t.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    cols.forEach((c, i) => ctx.fillText(c, n.x + 12, n.y + 26 + i * ROW_H + ROW_H / 2));
    ctx.restore();
  },
};

export const cardNode: NodeUtil = {
  type: 'card',
  getDefaultProps: () => ({}),
  getDefaultSize: () => ({ w: 150, h: 48 }),
  getGeometry: (n) => new Rectangle2d({ x: n.x, y: n.y, w: n.w, h: n.h }),
  getPorts: rectPorts,
  draw: (api, n, t) => {
    const box = { x: n.x, y: n.y, w: n.w, h: n.h };
    api.fillRoundRect(box, 8, t.fill, { glow: t.glow ?? undefined });
    api.ctx.save();
    api.ctx.fillStyle = t.stroke;
    api.ctx.beginPath();
    api.ctx.rect(n.x, n.y + 6, 4, n.h - 12);
    api.ctx.fill();
    api.ctx.restore();
    api.strokeRoundRect(box, 8, t.stroke, { width: t.strokeWidth });
    api.label(n.label ?? '', { x: n.x + n.w / 2 + 3, y: n.y + n.h / 2 });
  },
};

/** A generic node that renders an icon glyph (`props.icon`) symbol-forward — a large glyph on an
 * accent tile with the label below. Great for cloud/service architecture diagrams. */
export const iconNode: NodeUtil = {
  type: 'icon',
  getDefaultProps: () => ({ icon: 'box' }),
  getDefaultSize: () => ({ w: STENCIL.DEFAULT_W, h: STENCIL.NODE_H }),
  getGeometry: (n) => new Rectangle2d({ x: n.x, y: n.y, w: n.w, h: n.h }),
  getPorts: rectPorts,
  draw: (api, n, t) => {
    drawStencil(api, n, t, { icon: (n.props.icon as string) ?? 'box', label: n.label ?? '' });
  },
};

/** A labeled orthogonal connector for flowcharts / state machines. */
export const flowEdge: EdgeUtil = {
  type: 'flow',
  hitWidth: 8,
  getRoute(_edge: EdgeRecord, ctx: EdgeRouteContext): Vec2[] {
    const router = ctx.router ?? orthogonalRouter;
    return router.route({
      from: ctx.from,
      to: ctx.to,
      ...(ctx.waypoints ? { waypoints: ctx.waypoints } : {}),
      ...(ctx.fromBox ? { fromBox: ctx.fromBox } : {}),
      ...(ctx.toBox ? { toBox: ctx.toBox } : {}),
      ...(ctx.obstacles ? { obstacles: ctx.obstacles } : {}),
      endGap: 7,
    });
  },
  draw(api: DrawApi, edge: EdgeRecord, t: ResolvedTokens, route: Vec2[]): void {
    api.strokePolyline(route, t.stroke, { width: Math.max(1.3, t.strokeWidth), dash: t.dash });
    const a = route[route.length - 2];
    const b = route[route.length - 1];
    if (a && b) api.arrowhead(b, Math.atan2(b.y - a.y, b.x - a.x), 8, t.stroke);
    if (edge.label) {
      const mid = route[Math.floor(route.length / 2)]!;
      const w = api.measureLabel(edge.label, 10) + 10;
      api.ctx.save();
      api.ctx.globalAlpha *= 0.94;
      api.fillRoundRect({ x: mid.x - w / 2, y: mid.y - 9, w, h: 18 }, 5, t.fill);
      api.ctx.restore();
      api.label(edge.label, { x: mid.x, y: mid.y }, { fontSize: 10, color: t.text });
    }
  },
};

export const diagramNodeUtils: NodeUtil[] = [pillNode, processNode, decisionNode, stateNode, tableNode, cardNode, iconNode, imageNode];
export const diagramEdgeUtils: EdgeUtil[] = [flowEdge];
