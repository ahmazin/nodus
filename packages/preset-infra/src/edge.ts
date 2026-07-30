/**
 * The infra connector edge: an orthogonal route that exits the right of the source and enters the
 * left of the target, leaving a 6px gap for the arrowhead. Edges with a missing endpoint are
 * dropped by the scene index automatically.
 */

import { drawEdgeLabel, orthogonalRouter, type DrawApi, type EdgeRecord, type EdgeRouteContext, type EdgeUtil, type ResolvedTokens, type Vec2 } from '@ahmazin/core';

const GAP = 6;
const ARROW = 8;

export const infraConnectorUtil: EdgeUtil = {
  type: 'infra.connector',
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
      endGap: GAP,
    });
  },
  draw(api: DrawApi, edge: EdgeRecord, tokens: ResolvedTokens, route: Vec2[]): void {
    api.strokePolyline(route, tokens.stroke, {
      width: Math.max(1.2, tokens.strokeWidth),
      dash: tokens.dash,
      glow: tokens.glow ?? undefined,
      glowBlur: 8,
      ...(tokens.strokeGradient ? { gradient: tokens.strokeGradient } : {}),
    });
    // the arrowhead stays the flat (target-ish) `tokens.stroke` even when the line body is a
    // source→target gradient — a gradient-filled triangle would read as a smear, not a direction cue.
    const a = route[route.length - 2];
    const b = route[route.length - 1];
    if (a && b) {
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      api.arrowhead(b, angle, ARROW, tokens.stroke);
    }
    drawEdgeLabel(api, edge, tokens, route);
  },
};
