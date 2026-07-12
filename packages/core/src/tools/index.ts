/**
 * Interaction as a hierarchical state machine. Each tool owns an explicit sub-state (never ad-hoc
 * `isDragging` flags), so multi-step gestures (marquee, connect-drag, create-by-drag) compose
 * cleanly. The host converts raw DOM events to world coordinates once and dispatches here; only
 * the active tool receives them. Every mutating gesture runs through the editor's change channel.
 */

import { isEdge } from '../model.js';
import type { Box, Endpoint, Id, Vec2 } from '../model.js';
import type { RenderItem } from '../scene-index/index.js';
import type { Editor, ResizeHandle } from '../editor/index.js';

export interface PointerInfo {
  world: Vec2;
  screen: Vec2;
  button: number;
  shift: boolean;
  /** ctrl or cmd */
  meta: boolean;
  alt: boolean;
  target: RenderItem | null;
}

export interface KeyInfo {
  key: string;
  shift: boolean;
  meta: boolean;
  alt: boolean;
}

export abstract class ToolNode {
  abstract readonly id: string;
  protected editor!: Editor;

  bind(editor: Editor): void {
    this.editor = editor;
  }
  onEnter(): void {}
  onExit(): void {}
  onPointerDown(_p: PointerInfo): void {}
  onPointerMove(_p: PointerInfo): void {}
  onPointerUp(_p: PointerInfo): void {}
  onDoubleClick(_p: PointerInfo): void {}
  onKeyDown(_k: KeyInfo): void {}
  cursor(): string {
    return 'default';
  }
}

const DRAG_THRESHOLD = 3; // screen px

function boxFrom(a: Vec2, b: Vec2): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

// ============================================================================
// Select
// ============================================================================

type SelectState = 'idle' | 'pointing' | 'translating' | 'marquee' | 'resizing' | 'endpoint' | 'porting';

const MIN_SIZE = 8;

/** Compute a new box by dragging one handle; the opposite (non-dragged) edge stays fixed, and the
 *  min-size clamp preserves that fixed edge rather than letting it overshoot. */
function resizeBox(o: Box, handle: ResizeHandle, p: Vec2): Box {
  let x1 = o.x;
  let y1 = o.y;
  let x2 = o.x + o.w;
  let y2 = o.y + o.h;
  if (handle.includes('n')) y1 = p.y;
  if (handle.includes('s')) y2 = p.y;
  if (handle.includes('w')) x1 = p.x;
  if (handle.includes('e')) x2 = p.x;
  if (x2 - x1 < MIN_SIZE) {
    if (handle.includes('w')) x1 = x2 - MIN_SIZE; // right edge fixed
    else x2 = x1 + MIN_SIZE; // left edge fixed (incl. 'e' / no-x handles)
  }
  if (y2 - y1 < MIN_SIZE) {
    if (handle.includes('n')) y1 = y2 - MIN_SIZE; // bottom edge fixed
    else y2 = y1 + MIN_SIZE; // top edge fixed (incl. 's' / no-y handles)
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export class SelectTool extends ToolNode {
  readonly id = 'select';
  private state: SelectState = 'idle';
  private downScreen: Vec2 = { x: 0, y: 0 };
  private downWorld: Vec2 = { x: 0, y: 0 };
  private marqueeStart: Vec2 = { x: 0, y: 0 };
  private additive = false;
  private origPos = new Map<Id, Vec2>();
  private dragIds: Id[] = [];
  private dragBox: { x: number; y: number; w: number; h: number } | null = null;
  private resizeId: Id | null = null;
  private resizeHandle: ResizeHandle = 'se';
  private resizeOrig: Box = { x: 0, y: 0, w: 0, h: 0 };
  private resizeGrab: Vec2 = { x: 0, y: 0 };
  private epEdge: Id | null = null;
  private epWhich: 'from' | 'to' = 'from';
  private portFrom: { nodeId: Id; portId: string; point: Vec2 } | null = null;

  override onPointerDown(p: PointerInfo): void {
    this.downScreen = p.screen;
    this.downWorld = p.world;
    this.additive = p.shift;

    // resize takes priority when a single resizable node is selected and a handle is grabbed
    const sel = this.editor.selectedIdsArray();
    if (sel.length === 1) {
      const item = this.editor.sceneIndex.getItem(sel[0]!);
      if (item && item.kind === 'node' && this.editor.canResizeNode(sel[0]!)) {
        const handle = this.editor.hitResizeHandle(item.aabb, p.world);
        if (handle) {
          this.resizeId = sel[0]!;
          this.resizeHandle = handle;
          this.resizeOrig = item.aabb;
          const hp = this.editor.resizeHandlePoints(item.aabb)[handle];
          this.resizeGrab = { x: hp.x - p.world.x, y: hp.y - p.world.y }; // so the edge tracks the grab, not the raw pointer
          this.state = 'resizing';
          return;
        }
      }
      // grabbing a selected edge's endpoint handle re-binds it (floating arrows)
      if (item && item.kind === 'edge') {
        const h = this.editor.edgeEndpointHandles(sel[0]!);
        if (h) {
          const tol = 8 / this.editor.camera.z;
          if (Math.hypot(p.world.x - h.from.x, p.world.y - h.from.y) < tol) {
            this.epEdge = sel[0]!;
            this.epWhich = 'from';
            this.state = 'endpoint';
            return;
          }
          if (Math.hypot(p.world.x - h.to.x, p.world.y - h.to.y) < tol) {
            this.epEdge = sel[0]!;
            this.epWhich = 'to';
            this.state = 'endpoint';
            return;
          }
        }
      }
    }

    // drag out of a port handle → connect (and quick-create a node if dropped in empty space)
    const ph = this.editor.portHandleAt(p.world);
    if (ph) {
      this.portFrom = ph;
      this.editor.setConnectDraft({ from: ph.point, to: p.world, valid: false });
      this.state = 'porting';
      return;
    }

    if (p.target && p.target.kind === 'node') {
      if (p.shift) this.editor.toggleSelect(p.target.id);
      else if (!this.editor.isSelected(p.target.id)) this.editor.select([p.target.id]);
      this.state = 'pointing';
    } else if (p.target && p.target.kind === 'edge') {
      if (p.shift) this.editor.toggleSelect(p.target.id);
      else this.editor.select([p.target.id]);
      this.state = 'idle';
    } else {
      if (!p.shift) this.editor.clearSelection();
      this.marqueeStart = p.world;
      this.state = 'marquee';
    }
  }

  private beginTranslate(): void {
    this.dragIds = [...this.editor.expandWithDescendants(this.editor.selectedIdsArray())];
    this.origPos = new Map();
    for (const id of this.dragIds) {
      const r = this.editor.store.peek(id);
      if (r && r.typeName === 'node') this.origPos.set(id, { x: r.x, y: r.y });
    }
    this.dragBox = this.editor.selectionBounds();
    this.state = 'translating';
  }

  override onPointerMove(p: PointerInfo): void {
    if (this.state === 'resizing' && this.resizeId) {
      const grabbed = { x: p.world.x + this.resizeGrab.x, y: p.world.y + this.resizeGrab.y };
      const box = resizeBox(this.resizeOrig, this.resizeHandle, grabbed);
      this.editor.updateNode(this.resizeId, box, { capture: 'later' });
      return;
    }
    if (this.state === 'endpoint' && this.epEdge) {
      let ep = this.editor.endpointAt(p.world);
      const rec = this.editor.store.peek(this.epEdge);
      if (rec && isEdge(rec) && ep.kind !== 'point') {
        // guard against a self-loop: if we'd bind to the node the other end is on, float instead
        const other = this.epWhich === 'from' ? rec.to : rec.from;
        if (other.kind !== 'point' && other.nodeId === ep.nodeId) {
          ep = { kind: 'point', x: p.world.x, y: p.world.y };
        }
      }
      this.editor.setEdgeEndpoint(this.epEdge, this.epWhich, ep, { capture: 'later' });
      return;
    }
    if (this.state === 'porting' && this.portFrom) {
      const hit = this.editor.sceneIndex.hitTest(p.world, 3 / this.editor.camera.z);
      const onSame = !!hit && hit.kind === 'node' && hit.record.id === this.portFrom.nodeId;
      this.editor.setConnectDraft({ from: this.portFrom.point, to: p.world, valid: !onSame });
      return;
    }
    if (this.state === 'pointing') {
      const moved = Math.hypot(p.screen.x - this.downScreen.x, p.screen.y - this.downScreen.y);
      if (moved > DRAG_THRESHOLD) this.beginTranslate();
    }
    if (this.state === 'translating') {
      let dx = p.world.x - this.downWorld.x;
      let dy = p.world.y - this.downWorld.y;
      if (this.dragBox) {
        const moved = { x: this.dragBox.x + dx, y: this.dragBox.y + dy, w: this.dragBox.w, h: this.dragBox.h };
        const snap = this.editor.computeSnap(moved, new Set(this.dragIds));
        dx += snap.dx;
        dy += snap.dy;
        this.editor.snapGuidesAtom.set(snap.guides);
      }
      const positions = new Map<Id, Vec2>();
      for (const [id, o] of this.origPos) positions.set(id, { x: o.x + dx, y: o.y + dy });
      this.editor.setPositionsAbsolute(positions, { capture: 'later' });
    } else if (this.state === 'marquee') {
      this.editor.setMarquee(boxFrom(this.marqueeStart, p.world));
    }
  }

  override onPointerUp(p: PointerInfo): void {
    if (this.state === 'porting' && this.portFrom) {
      this.finishPorting(p);
      return;
    }
    if (this.state === 'resizing') {
      this.editor.mark();
      this.resizeId = null;
      this.state = 'idle';
      return;
    }
    if (this.state === 'endpoint') {
      this.editor.mark();
      this.epEdge = null;
      this.state = 'idle';
      return;
    }
    if (this.state === 'translating') {
      this.editor.mark();
      this.editor.snapGuidesAtom.set([]);
    } else if (this.state === 'marquee') {
      const box = boxFrom(this.marqueeStart, p.world);
      const ids = this.editor.sceneIndex.enclosedNodes(box);
      this.editor.select(ids, this.additive);
      this.editor.setMarquee(null);
    }
    this.state = 'idle';
  }

  /** Finish a drag-from-port gesture: connect to a dropped-on node, or quick-create one in empty space. */
  private finishPorting(p: PointerInfo): void {
    const from = this.portFrom!;
    const fromEp: Endpoint = { kind: 'node', nodeId: from.nodeId as Id<'node'>, portId: from.portId };
    const target = this.editor.portHandleAt(p.world);
    const hit = this.editor.sceneIndex.hitTest(p.world, 3 / this.editor.camera.z);
    const moved = Math.hypot(p.screen.x - this.downScreen.x, p.screen.y - this.downScreen.y);
    let toEp: Endpoint | null = null;
    let created: Id<'node'> | null = null;
    if (target && target.nodeId !== from.nodeId) {
      toEp = { kind: 'node', nodeId: target.nodeId as Id<'node'>, portId: target.portId };
    } else if (hit && hit.kind === 'node' && hit.record.id !== from.nodeId) {
      toEp = { kind: 'outline', nodeId: hit.record.id as Id<'node'> };
    } else if (!hit && moved > DRAG_THRESHOLD) {
      created = this.editor.quickCreateNode(p.world, { capture: 'later' });
      if (created) toEp = { kind: 'outline', nodeId: created };
    }
    if (toEp) {
      this.editor.connect(fromEp, toEp, undefined, { capture: 'later' });
      this.editor.mark(); // create + connect collapse into one undo entry
      if (created) this.editor.select([created]);
    }
    this.portFrom = null;
    this.editor.setConnectDraft(null);
    this.state = 'idle';
  }

  override onDoubleClick(p: PointerInfo): void {
    if (p.target && this.editor.canEdit(p.target.id)) {
      this.editor.select([p.target.id]);
      this.editor.beginEdit(p.target.id);
      return;
    }
    // double-click empty canvas → quick-create a node there and start editing its label
    if (!p.target) {
      const id = this.editor.quickCreateNode(p.world);
      if (id) {
        this.editor.select([id]);
        if (this.editor.canEdit(id)) this.editor.beginEdit(id);
      }
    }
  }

  override onExit(): void {
    // Aborting mid-gesture (tool switch while dragging): close any open history group so the drag
    // isn't merged into the next undo entry, and clear all ephemeral overlays + gesture state.
    if (this.state === 'translating' || this.state === 'resizing' || this.state === 'endpoint' || this.state === 'porting') {
      this.editor.mark();
    }
    this.editor.snapGuidesAtom.set([]);
    this.editor.setConnectDraft(null);
    this.editor.setMarquee(null);
    this.portFrom = null;
    this.resizeId = null;
    this.epEdge = null;
    this.dragIds = [];
    this.state = 'idle';
  }

  override onKeyDown(k: KeyInfo): void {
    if (k.key === 'Delete' || k.key === 'Backspace') {
      this.editor.deleteRecords(this.editor.selectedIdsArray());
    } else if (k.key === 'Escape') {
      this.editor.clearSelection();
    } else if (k.meta && (k.key === 'a' || k.key === 'A')) {
      this.editor.selectAll();
    } else if (k.meta && (k.key === 'c' || k.key === 'C')) {
      this.editor.copy();
    } else if (k.meta && (k.key === 'v' || k.key === 'V')) {
      this.editor.paste();
    } else if (k.meta && (k.key === 'd' || k.key === 'D')) {
      this.editor.duplicate();
    } else if (k.meta && (k.key === 'g' || k.key === 'G')) {
      if (k.shift) {
        for (const id of this.editor.selectedIdsArray()) this.editor.ungroup(id);
      } else {
        this.editor.group(this.editor.selectedIdsArray());
      }
    }
  }
}

// ============================================================================
// Hand (pan)
// ============================================================================

export class HandTool extends ToolNode {
  readonly id = 'hand';
  private last: Vec2 | null = null;

  override onPointerDown(p: PointerInfo): void {
    this.last = p.screen;
  }
  override onPointerMove(p: PointerInfo): void {
    if (!this.last) return;
    this.editor.panByScreen(p.screen.x - this.last.x, p.screen.y - this.last.y);
    this.last = p.screen;
  }
  override onPointerUp(): void {
    this.last = null;
  }
  override cursor(): string {
    return 'grab';
  }
}

// ============================================================================
// Create node
// ============================================================================

export class CreateNodeTool extends ToolNode {
  readonly id = 'create';
  /** Node type to create; set via `editor.setTool('create', { type })`. */
  type = 'rect';
  private start: Vec2 | null = null;
  private downScreen: Vec2 = { x: 0, y: 0 };

  configure(opts: { type?: string }): void {
    if (opts.type) this.type = opts.type;
  }

  override onPointerDown(p: PointerInfo): void {
    this.start = p.world;
    this.downScreen = p.screen;
  }
  override onPointerMove(p: PointerInfo): void {
    if (!this.start) return;
    this.editor.setCreatePreview(boxFrom(this.start, p.world));
  }
  override onPointerUp(p: PointerInfo): void {
    if (!this.start) return;
    const moved = Math.hypot(p.screen.x - this.downScreen.x, p.screen.y - this.downScreen.y);
    const box = moved > DRAG_THRESHOLD ? boxFrom(this.start, p.world) : null;
    const id = this.editor.createNodeAt(this.type, box ?? { x: this.start.x, y: this.start.y, w: 0, h: 0 });
    this.editor.setCreatePreview(null);
    this.start = null;
    this.editor.select(id ? [id] : []);
    this.editor.setTool('select');
  }
  override onExit(): void {
    this.start = null;
    this.editor.setCreatePreview(null);
  }
  override cursor(): string {
    return 'crosshair';
  }
}

// ============================================================================
// Connect
// ============================================================================

export class ConnectTool extends ToolNode {
  readonly id = 'connect';
  private from: { nodeId: Id; portId?: string; point: Vec2 } | null = null;

  override onPointerDown(p: PointerInfo): void {
    const port = this.editor.nearestPort(p.world, 'source');
    if (port) {
      this.from = port;
      this.editor.setConnectDraft({ from: port.point, to: p.world, valid: false });
    }
  }
  override onPointerMove(p: PointerInfo): void {
    if (!this.from) return;
    const target = this.editor.nearestPort(p.world, 'target');
    this.editor.setConnectDraft({
      from: this.from.point,
      to: target ? target.point : p.world,
      valid: !!target && target.nodeId !== this.from.nodeId,
    });
  }
  override onPointerUp(p: PointerInfo): void {
    if (this.from) {
      const port = this.editor.nearestPort(p.world, 'target');
      // snap to a real PORT if near one; otherwise bind to the outline under the drop (or float)
      const toEp: Endpoint =
        port && port.portId && port.nodeId !== this.from.nodeId
          ? { kind: 'node', nodeId: port.nodeId as Id<'node'>, portId: port.portId }
          : this.editor.endpointAt(p.world);
      // from-side mirrors the drop side: a real port if we grabbed one, else the node outline
      const fromEp: Endpoint = this.from.portId
        ? { kind: 'node', nodeId: this.from.nodeId as Id<'node'>, portId: this.from.portId }
        : { kind: 'outline', nodeId: this.from.nodeId as Id<'node'> };
      const sameNode = toEp.kind !== 'point' && toEp.nodeId === this.from.nodeId;
      if (!sameNode) {
        this.editor.connect(fromEp, toEp);
      }
    }
    this.from = null;
    this.editor.setConnectDraft(null);
  }
  override onExit(): void {
    this.from = null;
    this.editor.setConnectDraft(null);
  }
  override cursor(): string {
    return 'crosshair';
  }
}

// ============================================================================
// Manager
// ============================================================================

export class ToolManager {
  private readonly tools = new Map<string, ToolNode>();
  private currentId = 'select';

  constructor(
    private readonly editor: Editor,
    tools: ToolNode[],
  ) {
    for (const t of tools) this.register(t);
  }

  register(tool: ToolNode): void {
    tool.bind(this.editor);
    this.tools.set(tool.id, tool);
  }

  get current(): ToolNode {
    return this.tools.get(this.currentId)!;
  }

  get currentToolId(): string {
    return this.currentId;
  }

  has(id: string): boolean {
    return this.tools.has(id);
  }

  setTool(id: string, config?: Record<string, unknown>): void {
    if (!this.tools.has(id)) return;
    this.current.onExit();
    this.currentId = id;
    const tool = this.current as ToolNode & { configure?: (c: Record<string, unknown>) => void };
    if (config && typeof tool.configure === 'function') tool.configure(config);
    tool.onEnter();
  }

  pointerDown(p: PointerInfo): void {
    this.current.onPointerDown(p);
  }
  pointerMove(p: PointerInfo): void {
    this.current.onPointerMove(p);
  }
  pointerUp(p: PointerInfo): void {
    this.current.onPointerUp(p);
  }
  doubleClick(p: PointerInfo): void {
    this.current.onDoubleClick(p);
  }
  keyDown(k: KeyInfo): void {
    this.current.onKeyDown(k);
  }
}

export function defaultTools(): ToolNode[] {
  return [new SelectTool(), new HandTool(), new CreateNodeTool(), new ConnectTool()];
}
