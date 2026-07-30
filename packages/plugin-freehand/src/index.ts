/**
 * @ahmazin/plugin-freehand — freehand sketching for Nodus. Adds a `freehand` stroke node type and a
 * pen `FreehandTool`, registered through the public plugin API only (proof that a whole new
 * interaction + type needs zero core changes). Each stroke is one undoable node; strokes are stored
 * relative to the node origin so they move/undo like any other node.
 */

import {
  Polyline2d,
  ToolNode,
  type Dispose,
  type DrawApi,
  type Editor,
  type EngineHost,
  type Geometry2d,
  type Id,
  type NodeRecord,
  type NodeUtil,
  type Plugin,
  type PointerInfo,
  type ResolvedTokens,
  type Vec2,
} from '@ahmazin/core';

function absPoints(node: NodeRecord): Vec2[] {
  const rel = (node.props.points as Vec2[]) ?? [];
  return rel.map((p) => ({ x: node.x + p.x, y: node.y + p.y }));
}
function strokeWidth(node: NodeRecord): number {
  return (node.props.width as number) ?? 3;
}

export const freehandNodeUtil: NodeUtil = {
  type: 'freehand',
  getDefaultProps: () => ({ points: [], width: 3 }),
  capabilities: { canConnect: false, canEdit: false, canResize: false, canRotate: false },
  getGeometry(node: NodeRecord): Geometry2d {
    const pts = absPoints(node);
    return new Polyline2d(pts.length ? pts : [{ x: node.x, y: node.y }], Math.max(6, strokeWidth(node)));
  },
  draw(api: DrawApi, node: NodeRecord, tokens: ResolvedTokens): void {
    const pts = absPoints(node);
    const w = strokeWidth(node);
    if (pts.length >= 2) {
      api.strokePolyline(pts, tokens.stroke, { width: w, glow: tokens.glow ?? undefined, glowBlur: 6, cap: 'round', join: 'round' });
    } else if (pts.length === 1) {
      api.ctx.save();
      api.ctx.fillStyle = tokens.stroke;
      api.ctx.beginPath();
      api.ctx.arc(pts[0]!.x, pts[0]!.y, w / 2, 0, Math.PI * 2);
      api.ctx.fill();
      api.ctx.restore();
    }
  },
};

/** Pen tool: drag to draw a stroke; each stroke commits as one undoable node. */
export class FreehandTool extends ToolNode {
  readonly id = 'freehand';
  private raw: Vec2[] = [];
  private nodeId: Id<'node'> | null = null;
  private width = 3;

  configure(opts: { width?: number }): void {
    if (opts.width) this.width = opts.width;
  }

  override onPointerDown(p: PointerInfo): void {
    this.raw = [p.world];
    this.nodeId = this.editor.createNode(
      { type: 'freehand', x: p.world.x, y: p.world.y, w: 1, h: 1, visual: { state: 'accent' }, props: { points: [{ x: 0, y: 0 }], width: this.width } },
      { capture: 'later' },
    );
  }
  override onPointerMove(p: PointerInfo): void {
    if (!this.nodeId) return;
    const last = this.raw[this.raw.length - 1]!;
    if (Math.hypot(p.world.x - last.x, p.world.y - last.y) < 2) return;
    this.raw.push(p.world);
    this.commit();
  }
  override onPointerUp(): void {
    if (this.nodeId) {
      this.commit();
      this.editor.mark();
    }
    this.nodeId = null;
    this.raw = [];
  }
  private commit(): void {
    if (!this.nodeId || this.raw.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of this.raw) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const rel = this.raw.map((p) => ({ x: p.x - minX, y: p.y - minY }));
    this.editor.updateRecord(
      this.nodeId,
      { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY), props: { points: rel, width: this.width } },
      { capture: 'later' },
    );
  }
  override cursor(): string {
    return 'crosshair';
  }
}

export const freehandPlugin: Plugin = {
  id: 'freehand',
  register(host: EngineHost): Dispose {
    host.registerNodeType(freehandNodeUtil);
    host.registerTool(new FreehandTool());
    return () => {};
  },
};

/** Convenience: install the freehand plugin on an editor. Switch on with `editor.setTool('freehand')`. */
export function installFreehand(editor: Editor): void {
  editor.use(freehandPlugin);
}
