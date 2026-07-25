/**
 * Interaction as a hierarchical state machine. Each tool owns an explicit sub-state (never ad-hoc
 * `isDragging` flags), so multi-step gestures (marquee, connect-drag, create-by-drag) compose
 * cleanly. The host converts raw DOM events to world coordinates once and dispatches here; only
 * the active tool receives them. Every mutating gesture runs through the editor's change channel.
 */

import { isEdge, isNode } from '../model.js';
import { NodusError } from '../errors/index.js';
import type { Box, Endpoint, Id, NodeRecord, Vec2 } from '../model.js';
import type { RenderItem } from '../scene-index/index.js';
import type { Editor, ResizeHandle } from '../editor/index.js';
import { easeOutCubic } from '../editor/animation.js';

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

/** Base class for an interaction tool (select/hand/create/connect, or a plugin's own). The tool
 * manager routes pointer/key events to the active tool; override the on* handlers. `onEnter`/`onExit`
 * bracket activation. Registered via `editor.registerTool` / a plugin. */
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

/** Grab-lift scale applied to a dragged node while it's held (presentation-only; springs back to 1
 *  on release — the committed position is never touched). */
const LIFT = 1.03;

/** Grab radius (screen px) for the rotate / waypoint handles, matching the endpoint-handle tolerance. */
const HANDLE_TOL = 8;
/** Screen-px offset of the rotation handle above the selection's top edge. */
const ROTATE_HANDLE_OFFSET = 24;
/** Shift-snap step for rotation (15°). */
const ROTATE_SNAP = Math.PI / 12;

function boxFrom(a: Vec2, b: Vec2): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

// ============================================================================
// Select
// ============================================================================

type SelectState =
  | 'idle'
  | 'pointing'
  | 'translating'
  | 'marquee'
  | 'resizing'
  | 'endpoint'
  | 'porting'
  | 'rotating'
  | 'waypoint';

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
  // grab-lift: cancel fns for the in-flight "scale up" tween per dragged id, so a re-grab (or the
  // release spring-back) can cancel a still-running lift before starting the next tween.
  private liftCancels = new Map<Id, () => void>();
  private dragBox: { x: number; y: number; w: number; h: number } | null = null;
  private resizeId: Id | null = null;
  private resizeHandle: ResizeHandle = 'se';
  private resizeOrig: Box = { x: 0, y: 0, w: 0, h: 0 };
  private resizeGrab: Vec2 = { x: 0, y: 0 };
  private epEdge: Id | null = null;
  private epWhich: 'from' | 'to' = 'from';
  private portFrom: { nodeId: Id; portId: string; point: Vec2 } | null = null;
  // rotation gesture (single rotatable node): pivot + starting angles are captured at grab so the
  // pivot stays fixed for the whole drag and we can drive an absolute (Shift-snappable) target angle
  // through the delta-based editor.rotate().
  private rotateNodeId: Id | null = null;
  private rotateCenter: Vec2 = { x: 0, y: 0 };
  private rotateStartAngle = 0;
  private rotateStartRotation = 0;
  // waypoint gesture (single edge): the edge being bent and the index of the waypoint we inserted+drag.
  private wpEdge: Id | null = null;
  private wpIndex = 0;

  override onPointerDown(p: PointerInfo): void {
    this.downScreen = p.screen;
    this.downWorld = p.world;
    this.additive = p.shift;

    // resize takes priority when a single resizable node is selected and a handle is grabbed
    const sel = this.editor.selectedIdsArray();
    if (sel.length === 1) {
      const item = this.editor.sceneIndex.getItem(sel[0]!);
      // rotation handle (above top-center) sits outside the box, clear of the resize handles, so it
      // is checked first: grab it to spin the node about its bounding-box center.
      const rh = this.rotateHandle();
      if (rh && Math.hypot(p.world.x - rh.handle.x, p.world.y - rh.handle.y) < HANDLE_TOL / this.editor.camera.z) {
        this.rotateNodeId = rh.id;
        this.rotateCenter = rh.center;
        this.rotateStartRotation = rh.rotation;
        this.rotateStartAngle = Math.atan2(p.world.y - rh.center.y, p.world.x - rh.center.x);
        this.state = 'rotating';
        return;
      }
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
        // segment-midpoint handles: grab one to bend the edge — insert a waypoint at the grab, drag it.
        const wtol = HANDLE_TOL / this.editor.camera.z;
        for (const wh of this.waypointHandles()) {
          if (Math.hypot(p.world.x - wh.point.x, p.world.y - wh.point.y) < wtol) {
            const rec = this.editor.store.peek(sel[0]!);
            if (rec && isEdge(rec)) {
              const wps = [...((rec.props.waypoints as Vec2[] | undefined) ?? [])];
              wps.splice(wh.insertIndex, 0, { x: p.world.x, y: p.world.y });
              this.editor.setWaypoints(sel[0]!, wps, { capture: 'later' });
              this.wpEdge = sel[0]!;
              this.wpIndex = wh.insertIndex;
              this.state = 'waypoint';
              return;
            }
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

  /** Begin a drag-translate of the current selection. Edit-locked nodes are excluded, so a mixed
   *  selection drags only its unlocked members (and can snap to the stationary locked ones). Returns
   *  false — and does NOT enter the 'translating' state — when nothing is draggable (e.g. the whole
   *  selection is locked), so a click-drag on a locked node is a no-op rather than a phantom gesture. */
  private beginTranslate(): boolean {
    const ids = [...this.editor.expandWithDescendants(this.editor.selectedIdsArray())].filter(
      (id) => !this.editor.isLocked(id),
    );
    this.origPos = new Map();
    for (const id of ids) {
      const r = this.editor.store.peek(id);
      if (r && r.typeName === 'node') this.origPos.set(id, { x: r.x, y: r.y });
    }
    if (this.origPos.size === 0) return false;
    this.dragIds = ids;
    // grab-lift: each dragged NODE scales up to LIFT over 120ms, presentation-only (committed
    // position is untouched — see setPositionsAbsolute in onPointerMove below). Scoped to node ids
    // (this.origPos.keys()) rather than `ids`, which can include a co-selected edge that never moves
    // and shouldn't get a scale pulse.
    for (const id of this.origPos.keys()) {
      this.liftCancels.get(id)?.();
      this.liftCancels.set(
        id,
        this.editor.animate({
          from: this.editor.presentationFor(id)?.scale ?? 1,
          to: LIFT,
          durationMs: 120,
          easing: easeOutCubic,
          onTick: (v) => this.editor.setPresentation(id, { scale: v }),
        }),
      );
    }
    this.dragBox = this.editor.selectionBounds();
    this.state = 'translating';
    return true;
  }

  /** Spring each currently-lifted node's grab-lift back to scale 1 (~180ms), clearing the
   *  presentation once the tween settles. Called on release (`onPointerUp`) and on an aborted drag
   *  (`onExit`) — the committed position is never touched, only the presentation.
   *
   *  The spring-back's own cancel fn is stored back into `liftCancels` (keyed by id), so a re-grab
   *  before the spring settles (`beginTranslate`'s `this.liftCancels.get(id)?.()`) cancels the still-
   *  running spring instead of finding nothing — otherwise the stale spring keeps ticking mid-drag and
   *  craters the scale back to 1 / clears the presentation out from under the new grab. `onDone` both
   *  clears the presentation AND removes the (by-then-settled) entry, so a spring that runs to
   *  completion leaves no stale cancel behind. */
  private releaseLift(): void {
    for (const id of [...this.liftCancels.keys()]) {
      this.liftCancels.get(id)?.(); // cancel the running grab tween
      const cancel = this.editor.animate({
        from: this.editor.presentationFor(id)?.scale ?? LIFT,
        to: 1,
        durationMs: 180,
        easing: easeOutCubic,
        onTick: (v) => this.editor.setPresentation(id, { scale: v }),
        onDone: () => {
          this.editor.clearPresentation(id);
          this.liftCancels.delete(id);
        },
      });
      this.liftCancels.set(id, cancel); // so a re-grab can cancel THIS spring
    }
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
      const from = this.portFrom;
      const fromEp: Endpoint = { kind: 'node', nodeId: from.nodeId as Id<'node'>, portId: from.portId };
      const hit = this.editor.sceneIndex.hitTest(p.world, 3 / this.editor.camera.z);
      const onSame = !!hit && hit.kind === 'node' && hit.record.id === from.nodeId;
      // mid-drag drop-target affordance: a real port under the cursor (excluding the source node),
      // flagged valid/invalid by the same rules the drop enforces.
      const cand = this.editor.portHandleAt(p.world);
      let targetPort: { point: Vec2; valid: boolean } | undefined;
      if (cand && cand.nodeId !== from.nodeId) {
        const toEp: Endpoint = { kind: 'node', nodeId: cand.nodeId as Id<'node'>, portId: cand.portId };
        targetPort = { point: cand.point, valid: this.editor.connectAllowed(fromEp, toEp) };
      }
      this.editor.setConnectDraft({
        from: from.point,
        to: p.world,
        valid: !onSame,
        ...(targetPort ? { targetPort } : {}),
      });
      return;
    }
    if (this.state === 'rotating' && this.rotateNodeId) {
      const rec = this.editor.store.peek(this.rotateNodeId);
      if (rec && isNode(rec)) {
        const a = Math.atan2(p.world.y - this.rotateCenter.y, p.world.x - this.rotateCenter.x);
        let target = this.rotateStartRotation + (a - this.rotateStartAngle);
        if (p.shift) target = Math.round(target / ROTATE_SNAP) * ROTATE_SNAP;
        // editor.rotate is a DELTA API (adds to each node's rotation), so feed it the delta from the
        // current angle — an absolute, Shift-snappable target lands correctly across many moves.
        this.editor.rotate([this.rotateNodeId], target - (rec.rotation ?? 0), { capture: 'later' });
      }
      return;
    }
    if (this.state === 'waypoint' && this.wpEdge) {
      const rec = this.editor.store.peek(this.wpEdge);
      if (rec && isEdge(rec)) {
        const wps = [...((rec.props.waypoints as Vec2[] | undefined) ?? [])];
        if (this.wpIndex < wps.length) {
          wps[this.wpIndex] = { x: p.world.x, y: p.world.y };
          this.editor.setWaypoints(this.wpEdge, wps, { capture: 'later' });
        }
      }
      return;
    }
    if (this.state === 'pointing') {
      const moved = Math.hypot(p.screen.x - this.downScreen.x, p.screen.y - this.downScreen.y);
      // beginTranslate returns false for a wholly-locked selection → stay put (locked = immovable)
      if (moved > DRAG_THRESHOLD && !this.beginTranslate()) this.state = 'idle';
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
    if (this.state === 'rotating') {
      this.editor.mark(); // collapse the whole spin into one undo entry
      this.rotateNodeId = null;
      this.state = 'idle';
      return;
    }
    if (this.state === 'waypoint') {
      this.editor.mark(); // insert + drag collapse into one undo entry
      this.wpEdge = null;
      this.state = 'idle';
      return;
    }
    if (this.state === 'translating') {
      this.editor.mark();
      this.releaseLift();
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
    // Enforce connection validity at the interaction layer: reject a target that isn't connectable
    // (capabilities.canConnect) or that the source port's isValidConnection rejects. A rejected drop
    // creates no edge — and unwinds any node we speculatively quick-created — so it's a clean no-op.
    if (toEp && this.editor.connectAllowed(fromEp, toEp)) {
      this.editor.connect(fromEp, toEp, undefined, { capture: 'later' });
      this.editor.mark(); // create + connect collapse into one undo entry
      if (created) this.editor.select([created]);
    } else if (created) {
      this.editor.deleteRecords([created], { capture: 'later' });
      this.editor.mark(); // collapse the speculative create+delete so the canvas is unchanged
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
    if (
      this.state === 'translating' ||
      this.state === 'resizing' ||
      this.state === 'endpoint' ||
      this.state === 'porting' ||
      this.state === 'rotating' ||
      this.state === 'waypoint'
    ) {
      this.editor.mark();
      if (this.state === 'translating') this.releaseLift();
    }
    this.editor.snapGuidesAtom.set([]);
    this.editor.setConnectDraft(null);
    this.editor.setMarquee(null);
    this.portFrom = null;
    this.resizeId = null;
    this.epEdge = null;
    this.rotateNodeId = null;
    this.wpEdge = null;
    this.dragIds = [];
    this.state = 'idle';
  }

  /** Rotation-handle geometry for the current selection when it's a single rotatable node: the handle
   *  point (above top-center) and the pivot (bounding-box center), plus the node id and its current
   *  angle. Null otherwise. A pure function of the selection's bounding box, so the renderer can
   *  reproduce the handle position from the same inputs without a bespoke editor API. */
  private rotateHandle(): { handle: Vec2; center: Vec2; id: Id; rotation: number } | null {
    const sel = this.editor.selectedIdsArray();
    if (sel.length !== 1) return null;
    const id = sel[0]!;
    const item = this.editor.sceneIndex.getItem(id);
    if (!item || item.kind !== 'node') return null;
    const node = item.record as NodeRecord;
    if (node.locked === true) return null; // edit-locked: not rotatable (editor.rotate skips it too)
    if (!this.editor.capabilitiesOf(node.type).canRotate) return null;
    const b = item.aabb;
    return {
      handle: { x: b.x + b.w / 2, y: b.y - ROTATE_HANDLE_OFFSET / this.editor.camera.z },
      center: { x: b.x + b.w / 2, y: b.y + b.h / 2 },
      id,
      rotation: node.rotation ?? 0,
    };
  }

  /** Segment-midpoint handles for a selected single edge, using the engine's already-routed polyline.
   *  Each handle carries the index in the edge's `waypoints` array that grabbing it inserts at —
   *  exact for the straight router (route = [from, ...waypoints, to]); clamped for others. Empty when
   *  the selection isn't a single edge with a resolvable route. */
  private waypointHandles(): { point: Vec2; insertIndex: number }[] {
    const sel = this.editor.selectedIdsArray();
    if (sel.length !== 1) return [];
    const item = this.editor.sceneIndex.getItem(sel[0]!);
    if (!item || item.kind !== 'edge' || !item.route || item.route.length < 2) return [];
    const rec = this.editor.store.peek(sel[0]!);
    const wpCount = rec && isEdge(rec) ? ((rec.props.waypoints as Vec2[] | undefined)?.length ?? 0) : 0;
    const route = item.route;
    const handles: { point: Vec2; insertIndex: number }[] = [];
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i]!;
      const b = route[i + 1]!;
      handles.push({ point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, insertIndex: Math.min(i, wpCount) });
    }
    return handles;
  }

  override onKeyDown(k: KeyInfo): void {
    if (k.key === 'Delete' || k.key === 'Backspace') {
      // edit-locked nodes are protected from keyboard delete (unlock first)
      this.editor.deleteRecords(this.editor.selectedIdsArray().filter((id) => !this.editor.isLocked(id)));
    } else if (k.key === 'Escape') {
      this.editor.clearSelection();
    } else if (k.meta && (k.key === 'a' || k.key === 'A')) {
      this.editor.selectAll();
    } else if (k.meta && (k.key === 'x' || k.key === 'X')) {
      // Cut = copy + delete as ONE undo entry. copy() only snapshots to the in-memory clipboard (no
      // store mutation, no history), so the single deleteRecords() below is the lone undo entry and
      // undo restores everything. Edit-locked nodes can't be deleted, so they're excluded from both.
      const cut = this.editor.selectedIdsArray().filter((id) => !this.editor.isLocked(id));
      if (cut.length > 0) {
        this.editor.copy(cut);
        this.editor.deleteRecords(cut);
      }
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
    if (id) this.editor.animateEntrance([id]); // single node, no stagger
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
      // same connection-validity rules as the port-drag path (canConnect + isValidConnection)
      if (!sameNode && this.editor.connectAllowed(fromEp, toEp)) {
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
// Eraser
// ============================================================================

/** Click or drag over items to delete them. Edit-locked nodes are protected (skipped). A whole
 *  drag-erase collapses into ONE undo entry: each hit is removed with `capture: 'later'` and the
 *  gesture is closed with `editor.mark()` on release / tool-exit. */
export class EraserTool extends ToolNode {
  readonly id = 'eraser';
  private erasing = false;
  private erased = 0;

  override onPointerDown(p: PointerInfo): void {
    this.erasing = true;
    this.erased = 0;
    this.eraseAt(p);
  }
  override onPointerMove(p: PointerInfo): void {
    if (this.erasing) this.eraseAt(p);
  }
  override onPointerUp(): void {
    this.finish();
  }
  override onExit(): void {
    this.finish();
  }

  /** Delete the topmost item under the cursor (respecting edit-locks). Uses the pointer's pre-hit
   *  `target` so the erase tolerance matches selection/hover. */
  private eraseAt(p: PointerInfo): void {
    const hit = p.target;
    if (!hit) return;
    if (hit.kind === 'node' && this.editor.isLocked(hit.id)) return; // locked: protected from erase
    this.editor.deleteRecords([hit.id], { capture: 'later' });
    this.erased++;
  }

  private finish(): void {
    if (this.erasing && this.erased > 0) this.editor.mark(); // one undo entry for the whole gesture
    this.erasing = false;
    this.erased = 0;
  }

  override onKeyDown(k: KeyInfo): void {
    if (k.key === 'Escape') this.editor.setTool('select'); // dismiss back to the select tool
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

  /** Notified when a registration overrides an existing tool id (soft warning, same contract as the
   *  type/router registries — two plugins colliding on a tool id must be observable, not silent). */
  onOverride?: (id: string) => void;

  register(tool: ToolNode): void {
    if (!tool || typeof tool.id !== 'string' || tool.id.length === 0 || typeof tool.bind !== 'function') {
      throw new NodusError('invalid-util', `Cannot register tool: expected a ToolNode with a non-empty string 'id'.`, {
        context: { got: tool === null ? 'null' : typeof tool },
      });
    }
    if (this.tools.has(tool.id)) this.onOverride?.(tool.id);
    tool.bind(this.editor);
    this.tools.set(tool.id, tool);
  }

  /** Remove a registered tool. If it was the active tool, reset to `select` first (running its
   *  onExit + select's onEnter). Never removes `select` itself. */
  unregister(id: string): void {
    if (id === 'select' || !this.tools.has(id)) return;
    if (this.currentId === id) this.setTool('select');
    this.tools.delete(id);
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

  /** Run the active tool's `onExit()` (releasing any mid-gesture state) without switching tools.
   *  Called by `Editor.dispose()` so a tool torn down mid-drag doesn't leave dangling handlers. */
  exitActiveTool(): void {
    this.current.onExit();
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
  return [new SelectTool(), new HandTool(), new CreateNodeTool(), new ConnectTool(), new EraserTool()];
}
