/**
 * @nodus-dev/preset-draw — the "dumb shapes" whiteboard preset: rectangle / ellipse / diamond, multi-line
 * text, and line / arrow edges, plus a `LineTool` and `R/E/L/A/T` tool shortcuts. Everything styles
 * off the per-element style bag (right-click → Style, or a properties panel), so shapes are neutral
 * by default and coloured per element.
 */

import {
  Ellipse2d,
  Polygon2d,
  Rectangle2d,
  ToolNode,
  drawEdgeLabel,
  straightRouter,
  type DrawApi,
  type EdgeRecord,
  type EdgeRouteContext,
  type EdgeUtil,
  type Editor,
  type Endpoint,
  type Geometry2d,
  type NodeRecord,
  type NodeUtil,
  type PointerInfo,
  type Port,
  type ResolvedTokens,
  type Vec2,
} from '@nodus-dev/core';

const shapePorts = (): Port[] => [
  { id: 'l', kind: 'both', anchor: { x: 0, y: 0.5 } },
  { id: 'r', kind: 'both', anchor: { x: 1, y: 0.5 } },
  { id: 't', kind: 'both', anchor: { x: 0.5, y: 0 } },
  { id: 'b', kind: 'both', anchor: { x: 0.5, y: 1 } },
];

// Freeform whiteboard shapes are meant to rotate — that's core to this "dumb shapes" preset (its
// `draw.text` deliberately opts OUT with canRotate:false, which only reads as an exception because its
// siblings rotate). Declare it EXPLICITLY: core's E3 change resolves an unset canRotate through
// `capabilitiesOf` to the DEFAULT_CAPABILITIES value (false), so relying on the old accidental-true
// would silently drop the rotate handle from every whiteboard shape. Partial merge keeps the other
// capabilities (connect/resize/edit) at their default-true.
const WHITEBOARD_CAPS: NonNullable<NodeUtil['capabilities']> = { canRotate: true };

export const rectShape: NodeUtil = {
  type: 'draw.rect',
  getDefaultProps: () => ({}),
  getDefaultSize: () => ({ w: 140, h: 90 }),
  capabilities: WHITEBOARD_CAPS,
  getGeometry: (n) => new Rectangle2d({ x: n.x, y: n.y, w: n.w, h: n.h }),
  getPorts: shapePorts,
  draw: (api, n, t) => {
    const box = { x: n.x, y: n.y, w: n.w, h: n.h };
    api.fillRoundRect(box, t.radius, t.fill, { glow: t.glow ?? undefined });
    api.strokeRoundRect(box, t.radius, t.stroke, { width: t.strokeWidth, dash: t.dash });
    if (n.label) api.label(n.label, { x: n.x + n.w / 2, y: n.y + n.h / 2 });
  },
};

export const ellipseShape: NodeUtil = {
  type: 'draw.ellipse',
  getDefaultProps: () => ({}),
  getDefaultSize: () => ({ w: 140, h: 100 }),
  capabilities: WHITEBOARD_CAPS,
  getGeometry: (n) => new Ellipse2d({ x: n.x, y: n.y, w: n.w, h: n.h }),
  getPorts: shapePorts,
  draw: (api, n, t) => {
    const box = { x: n.x, y: n.y, w: n.w, h: n.h };
    api.fillEllipse(box, t.fill, { glow: t.glow ?? undefined });
    api.strokeEllipse(box, t.stroke, { width: t.strokeWidth, dash: t.dash });
    if (n.label) api.label(n.label, { x: n.x + n.w / 2, y: n.y + n.h / 2 });
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
export const diamondShape: NodeUtil = {
  type: 'draw.diamond',
  getDefaultProps: () => ({}),
  getDefaultSize: () => ({ w: 150, h: 100 }),
  capabilities: WHITEBOARD_CAPS,
  getGeometry: (n): Geometry2d => new Polygon2d(diamondPoints(n)),
  getPorts: shapePorts,
  draw: (api, n, t) => {
    const pts = diamondPoints(n);
    api.fillPolygon(pts, t.fill, { glow: t.glow ?? undefined });
    api.strokePolyline([...pts, pts[0]!], t.stroke, { width: t.strokeWidth, dash: t.dash });
    if (n.label) api.label(n.label, { x: n.x + n.w / 2, y: n.y + n.h / 2 });
  },
};

// ---- multi-line text ----
function wrapText(api: DrawApi, text: string, maxWidth: number, fontSize: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (para === '') {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (api.measureLabel(test, fontSize) > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    out.push(line);
  }
  return out;
}

export const textNode: NodeUtil = {
  type: 'draw.text',
  getDefaultProps: () => ({}),
  getDefaultSize: () => ({ w: 180, h: 40 }),
  capabilities: { canConnect: true, canResize: true, canEdit: true, canRotate: false, multiline: true },
  getGeometry: (n) => new Rectangle2d({ x: n.x, y: n.y, w: n.w, h: n.h }),
  draw: (api, n, t) => {
    const text = t.labelOverride ?? n.label ?? '';
    const lines = wrapText(api, text, n.w - 8, t.fontSize);
    const lh = t.fontSize * t.lineHeight;
    const { ctx } = api;
    ctx.save();
    ctx.font = `${t.fontSize}px ${t.fontFamily}`;
    ctx.fillStyle = t.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let y = n.y + lh / 2 + 4;
    for (const line of lines) {
      ctx.fillText(line, n.x + 4, y);
      y += lh;
    }
    ctx.restore();
  },
};

// ---- line / arrow edges ----
function edgeUtil(id: string, hasArrow: boolean): EdgeUtil {
  return {
    type: id,
    hitWidth: 8,
    getRoute(_e: EdgeRecord, ctx: EdgeRouteContext): Vec2[] {
      const router = ctx.router ?? straightRouter;
      return router.route({
        from: ctx.from,
        to: ctx.to,
        ...(ctx.waypoints ? { waypoints: ctx.waypoints } : {}),
        endGap: hasArrow ? 6 : 0,
      });
    },
    draw(api: DrawApi, edge: EdgeRecord, t: ResolvedTokens, route: Vec2[]): void {
      api.strokePolyline(route, t.stroke, { width: Math.max(1.4, t.strokeWidth), dash: t.dash });
      if (hasArrow) {
        const a = route[route.length - 2];
        const b = route[route.length - 1];
        if (a && b) api.arrowhead(b, Math.atan2(b.y - a.y, b.x - a.x), 9, t.stroke);
      }
      drawEdgeLabel(api, edge, t, route);
    },
  };
}
export const lineEdge = edgeUtil('draw.line', false);
export const arrowEdge = edgeUtil('draw.arrow', true);

// ---- the line/arrow drawing tool ----
export class LineTool extends ToolNode {
  readonly id = 'line';
  type = 'draw.arrow';
  private from: Endpoint | null = null;
  private fromWorld: Vec2 = { x: 0, y: 0 };

  configure(opts: { type?: string }): void {
    if (opts.type) this.type = opts.type;
  }
  override onPointerDown(p: PointerInfo): void {
    this.from = this.editor.endpointAt(p.world);
    this.fromWorld = p.world;
    this.editor.setConnectDraft({ from: p.world, to: p.world, valid: false });
  }
  override onPointerMove(p: PointerInfo): void {
    if (this.from) this.editor.setConnectDraft({ from: this.fromWorld, to: p.world, valid: true });
  }
  override onPointerUp(p: PointerInfo): void {
    // Require an actual drag: a stray click (from ≈ to) would otherwise inject a zero-length floating
    // edge, or an outline→outline self-loop when clicking on a node — invisible junk that autosaves.
    if (this.from && Math.hypot(p.world.x - this.fromWorld.x, p.world.y - this.fromWorld.y) >= 4) {
      const to = this.editor.endpointAt(p.world);
      const id = this.editor.connect(this.from, to, this.type);
      if (id) this.editor.select([id]);
    }
    this.from = null;
    this.editor.setConnectDraft(null);
    this.editor.setTool('select');
  }
  override cursor(): string {
    return 'crosshair';
  }
}

export const drawNodeUtils: NodeUtil[] = [rectShape, ellipseShape, diamondShape, textNode];
export const drawEdgeUtils: EdgeUtil[] = [lineEdge, arrowEdge];

/** Register the draw shapes, line/arrow edges, and the line tool. */
export function installDrawTools(editor: Editor): void {
  for (const u of drawNodeUtils) editor.nodes.register(u);
  for (const u of drawEdgeUtils) editor.edges.register(u);
  editor.registerTool(new LineTool());
  editor.sceneIndex.rebuild(editor.store.allRecords());
}

/** Map a keyboard shortcut to a draw tool. Returns true if the key was handled. */
export function drawShortcut(editor: Editor, key: string): boolean {
  switch (key.toLowerCase()) {
    case 'v':
      editor.setTool('select');
      return true;
    case 'r':
      editor.setTool('create', { type: 'draw.rect' });
      return true;
    case 'e':
      editor.setTool('create', { type: 'draw.ellipse' });
      return true;
    case 'd':
      editor.setTool('create', { type: 'draw.diamond' });
      return true;
    case 't':
      editor.setTool('create', { type: 'draw.text' });
      return true;
    case 'l':
      editor.setTool('line', { type: 'draw.line' });
      return true;
    case 'a':
      editor.setTool('line', { type: 'draw.arrow' });
      return true;
    default:
      return false;
  }
}
