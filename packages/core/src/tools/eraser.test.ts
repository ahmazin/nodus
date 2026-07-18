import { describe, expect, it } from 'vitest';
import { Editor } from '../index.js';

/** The eraser deletes the item under the cursor on click or drag, respects edit-locks, and collapses
 *  a whole drag into one undo entry. Default camera is identity, so screen == world. */
describe('EraserTool', () => {
  it('deletes the item under the cursor on a click', () => {
    const ed = new Editor();
    const id = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
    ed.setTool('eraser');
    ed.pointerDown({ x: 50, y: 50 }, {});
    ed.pointerUp({ x: 50, y: 50 }, {});
    expect(ed.store.has(id)).toBe(false);
  });

  it('erases every item a drag passes over, as ONE undo entry', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 40, h: 40 });
    const b = ed.createNode({ type: 'rect', x: 100, y: 0, w: 40, h: 40 });
    ed.setTool('eraser');
    ed.pointerDown({ x: 20, y: 20 }, {}); // over a
    ed.pointerMove({ x: 120, y: 20 }, {}); // dragged over b
    ed.pointerUp({ x: 120, y: 20 }, {});
    expect(ed.store.has(a)).toBe(false);
    expect(ed.store.has(b)).toBe(false);

    ed.undo(); // one entry restores the whole gesture
    expect(ed.store.has(a)).toBe(true);
    expect(ed.store.has(b)).toBe(true);
  });

  it('does not erase edit-locked nodes', () => {
    const ed = new Editor();
    const id = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
    ed.lock([id]);
    ed.setTool('eraser');
    ed.pointerDown({ x: 50, y: 50 }, {});
    ed.pointerUp({ x: 50, y: 50 }, {});
    expect(ed.store.has(id)).toBe(true);
  });

  it('a click over empty space erases nothing (no phantom history entry)', () => {
    const ed = new Editor();
    const id = ed.createNode({ type: 'rect', x: 0, y: 0, w: 40, h: 40 });
    ed.setTool('eraser');
    ed.pointerDown({ x: 500, y: 500 }, {}); // empty
    ed.pointerUp({ x: 500, y: 500 }, {});
    expect(ed.store.has(id)).toBe(true);
  });

  it('Escape dismisses the eraser back to the select tool', () => {
    const ed = new Editor();
    ed.setTool('eraser');
    expect(ed.currentToolId).toBe('eraser');
    ed.keyDown({ key: 'Escape', shift: false, meta: false, alt: false });
    expect(ed.currentToolId).toBe('select');
  });
});
