import { describe, expect, it } from 'vitest';
import { Editor } from '../index.js';
import type { EdgeRecord, Id, NodeRecord } from '../model.js';

/**
 * SelectTool interaction gaps: Cut (⌘X), the rotation handle, and waypoint (edge-bend) dragging.
 * Default camera is identity, so screen == world. Each gesture must collapse into ONE undo entry.
 */
describe('SelectTool — cut', () => {
  const cut = { key: 'x', shift: false, meta: true, alt: false };

  it('removes the selection, fills the clipboard, and is one undo entry', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 40, h: 40 });
    const b = ed.createNode({ type: 'rect', x: 100, y: 0, w: 40, h: 40 });
    ed.select([a, b]);
    expect(ed.hasClipboard()).toBe(false);

    ed.keyDown(cut);
    expect(ed.store.has(a)).toBe(false);
    expect(ed.store.has(b)).toBe(false);
    expect(ed.hasClipboard()).toBe(true);

    ed.undo(); // a single entry restores the whole cut
    expect(ed.store.has(a)).toBe(true);
    expect(ed.store.has(b)).toBe(true);
  });

  it('re-inserts the cut nodes on paste (clipboard round-trip)', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 40, h: 40 });
    ed.select([a]);
    ed.keyDown(cut);
    expect(ed.store.has(a)).toBe(false);

    const pasted = ed.paste();
    expect(pasted).toHaveLength(1);
    expect(ed.store.nodes()).toHaveLength(1);
  });

  it('does not cut edit-locked nodes, and leaves the clipboard untouched', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 40, h: 40 });
    ed.lock([a]);
    ed.select([a]);
    ed.keyDown(cut);
    expect(ed.store.has(a)).toBe(true);
    expect(ed.hasClipboard()).toBe(false);
  });
});

describe('SelectTool — rotation handle', () => {
  /** Select a fresh rect and return its bbox center + the world position of the rotation handle. */
  function setup(): { ed: Editor; id: Id; center: { x: number; y: number }; handle: { x: number; y: number } } {
    const ed = new Editor();
    const id = ed.createNode({ type: 'rect', x: 0, y: 0, w: 130, h: 56 });
    ed.select([id]);
    const b = ed.sceneIndex.getItem(id)!.aabb;
    const center = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const handle = { x: center.x, y: b.y - 24 }; // ROTATE_HANDLE_OFFSET at z=1
    return { ed, id, center, handle };
  }

  it('grabbing the handle and sweeping 90° about the bbox center sets rotation (one undo entry)', () => {
    const { ed, id, center, handle } = setup();
    ed.pointerDown(handle, {}); // handle points straight up from center → start angle -π/2
    ed.pointerMove({ x: center.x + 50, y: center.y }, {}); // sweep to +x (angle 0) → +90° clockwise
    ed.pointerUp({ x: center.x + 50, y: center.y }, {});

    const rec = ed.store.peek(id) as NodeRecord;
    expect(rec.rotation ?? 0).toBeCloseTo(Math.PI / 2, 5);

    ed.undo(); // one entry restores the original angle
    expect((ed.store.peek(id) as NodeRecord).rotation ?? 0).toBeCloseTo(0, 5);
  });

  it('Shift snaps the rotation to 15° increments', () => {
    const { ed, center, handle } = setup();
    const id2 = ed.selectedIdsArray()[0]!;
    ed.pointerDown(handle, {});
    // a point ~+80° from the start (start = straight up); Shift should snap the 80°-ish sweep to 75°
    const ang = -Math.PI / 2 + (80 * Math.PI) / 180;
    ed.pointerMove({ x: center.x + 50 * Math.cos(ang), y: center.y + 50 * Math.sin(ang) }, { shift: true });
    ed.pointerUp({ x: center.x + 50 * Math.cos(ang), y: center.y + 50 * Math.sin(ang) }, { shift: true });
    const rot = (ed.store.peek(id2) as NodeRecord).rotation ?? 0;
    expect(rot).toBeCloseTo((75 * Math.PI) / 180, 5);
  });

  it('a pointer-down away from the handle does not rotate', () => {
    const { ed, id, center, handle } = setup();
    ed.pointerDown({ x: handle.x + 60, y: handle.y }, {}); // empty space, clear of the handle
    ed.pointerMove({ x: center.x + 50, y: center.y }, {});
    ed.pointerUp({ x: center.x + 50, y: center.y }, {});
    expect((ed.store.peek(id) as NodeRecord).rotation ?? 0).toBe(0);
  });

  it('offers no rotation handle for a group (canRotate: false)', () => {
    const ed = new Editor();
    const child = ed.createNode({ type: 'rect', x: 20, y: 20, w: 40, h: 40 });
    const gid = ed.group([child])!;
    ed.select([gid]);
    const b = ed.sceneIndex.getItem(gid)!.aabb;
    const handle = { x: b.x + b.w / 2, y: b.y - 24 };
    ed.pointerDown(handle, {});
    ed.pointerMove({ x: b.x + b.w / 2 + 50, y: b.y + b.h / 2 }, {});
    ed.pointerUp({ x: b.x + b.w / 2 + 50, y: b.y + b.h / 2 }, {});
    expect((ed.store.peek(gid) as NodeRecord).rotation ?? 0).toBe(0);
  });
});

describe('SelectTool — waypoint drag', () => {
  /** Two nodes joined by an edge, with the edge selected; returns the edge id and its routed polyline. */
  function connected(): { ed: Editor; edge: Id; route: { x: number; y: number }[] } {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 40, h: 40 });
    const b = ed.createNode({ type: 'rect', x: 200, y: 0, w: 40, h: 40 });
    const edge = ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b })!;
    ed.select([edge]);
    return { ed, edge, route: ed.sceneIndex.getItem(edge)!.route! };
  }

  it('grabbing a segment midpoint inserts and drags a waypoint (one undo entry)', () => {
    const { ed, edge, route } = connected();
    expect(route.length).toBeGreaterThanOrEqual(2);
    const mid = { x: (route[0]!.x + route[1]!.x) / 2, y: (route[0]!.y + route[1]!.y) / 2 };

    ed.pointerDown(mid, {});
    ed.pointerMove({ x: mid.x, y: mid.y + 60 }, {});
    ed.pointerUp({ x: mid.x, y: mid.y + 60 }, {});

    const wps = (ed.store.peek(edge) as EdgeRecord).props.waypoints as { x: number; y: number }[];
    expect(wps).toHaveLength(1);
    expect(wps[0]!.y).toBeCloseTo(mid.y + 60, 3);

    ed.undo(); // insert + drag collapse into one entry
    const after = (ed.store.peek(edge) as EdgeRecord).props.waypoints as unknown[] | undefined;
    expect(after ?? []).toHaveLength(0);
  });

  it('a pointer-down off the routed polyline adds no waypoint', () => {
    const { ed, edge, route } = connected();
    const mid = { x: (route[0]!.x + route[1]!.x) / 2, y: (route[0]!.y + route[1]!.y) / 2 };
    ed.pointerDown({ x: mid.x, y: mid.y + 60 }, {}); // well off the line
    ed.pointerUp({ x: mid.x, y: mid.y + 60 }, {});
    const wps = (ed.store.peek(edge) as EdgeRecord).props.waypoints as unknown[] | undefined;
    expect(wps ?? []).toHaveLength(0);
  });
});
