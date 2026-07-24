import { describe, expect, it } from 'vitest';
import { Editor, Rectangle2d, type NodeRecord } from '../index.js';

/** Edit-lock: a locked node stays selectable (so it can be unlocked) but the interaction tools
 *  refuse to move / resize / rotate / delete it. Default camera is identity, so screen == world. */
describe('edit-lock enforcement', () => {
  const drag = (ed: Editor, from: { x: number; y: number }, to: { x: number; y: number }): void => {
    ed.pointerDown(from, {});
    ed.pointerMove(to, {});
    ed.pointerUp(to, {});
  };

  it('lock() / unlock() / isLocked() toggle the record flag via the store', () => {
    const ed = new Editor();
    const id = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
    expect(ed.isLocked(id)).toBe(false);
    ed.lock([id]);
    expect(ed.isLocked(id)).toBe(true);
    expect((ed.store.peek(id) as NodeRecord).locked).toBe(true);
    ed.unlock([id]);
    expect(ed.isLocked(id)).toBe(false);
    // cleared (not set to `false`) so serialization stays canonical
    expect('locked' in (ed.store.peek(id) as NodeRecord)).toBe(false);
  });

  it('a locked node cannot be dragged; unlocking restores dragging', () => {
    const ed = new Editor();
    ed.snap.toObjects = false; // deterministic drag deltas
    const id = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
    ed.select([id]);
    ed.lock([id]);

    drag(ed, { x: 50, y: 50 }, { x: 90, y: 50 });
    const locked = ed.store.peek(id) as NodeRecord;
    expect(locked.x).toBe(0); // no movement while locked
    expect(locked.y).toBe(0);

    ed.unlock([id]);
    ed.select([id]);
    drag(ed, { x: 50, y: 50 }, { x: 90, y: 50 });
    const moved = ed.store.peek(id) as NodeRecord;
    expect(moved.x).toBe(40); // dx = 90 - 50 at z=1
  });

  it('a locked node is protected from keyboard delete, then deletable after unlock', () => {
    const ed = new Editor();
    const id = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
    ed.select([id]);
    ed.lock([id]);
    ed.keyDown({ key: 'Delete', shift: false, meta: false, alt: false });
    expect(ed.store.has(id)).toBe(true); // protected

    ed.unlock([id]);
    ed.keyDown({ key: 'Delete', shift: false, meta: false, alt: false });
    expect(ed.store.has(id)).toBe(false);
  });

  it('rotate() and canResizeNode() respect the lock', () => {
    const ed = new Editor();
    // E3: rect opts out of rotation by default; use a type that opts in so rotate() is exercised.
    ed.registerNodeType({
      type: 'rot',
      getDefaultProps: () => ({}),
      getGeometry: (n) => new Rectangle2d({ x: n.x, y: n.y, w: n.w, h: n.h }),
      draw: () => {},
      capabilities: { canRotate: true },
    });
    const id = ed.createNode({ type: 'rot', x: 0, y: 0, w: 100, h: 100 });
    expect(ed.canResizeNode(id)).toBe(true);

    ed.lock([id]);
    expect(ed.canResizeNode(id)).toBe(false);
    ed.rotate([id], Math.PI / 4);
    expect((ed.store.peek(id) as NodeRecord).rotation ?? 0).toBe(0); // rotation skipped (locked)

    ed.unlock([id]);
    expect(ed.canResizeNode(id)).toBe(true);
    ed.rotate([id], Math.PI / 4);
    expect((ed.store.peek(id) as NodeRecord).rotation).toBeCloseTo(Math.PI / 4);
  });

  it('a mixed selection drags only its unlocked members', () => {
    const ed = new Editor();
    ed.snap.toObjects = false; // deterministic drag deltas
    const locked = ed.createNode({ type: 'rect', x: 0, y: 0, w: 40, h: 40 });
    const free = ed.createNode({ type: 'rect', x: 200, y: 0, w: 40, h: 40 });
    ed.lock([locked]);
    ed.select([locked, free]);
    // grab the unlocked node and drag right
    drag(ed, { x: 220, y: 20 }, { x: 260, y: 20 });
    expect((ed.store.peek(locked) as NodeRecord).x).toBe(0); // stayed put
    expect((ed.store.peek(free) as NodeRecord).x).toBe(240); // moved by 40
  });
});
