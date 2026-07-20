import { describe, expect, it } from 'vitest';
import { Editor } from '../index.js';
import type { Id, NodeRecord } from '../index.js';

/**
 * Multi-select gestures (marquee, shift-click) and the align/distribute helpers. Default camera is
 * identity, so screen == world.
 */
describe('SelectTool — marquee selection', () => {
  it('drag-encloses exactly the fully-contained nodes', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 40, h: 40 });
    const b = ed.createNode({ type: 'rect', x: 60, y: 0, w: 40, h: 40 });
    ed.createNode({ type: 'rect', x: 300, y: 300, w: 40, h: 40 }); // far away, excluded

    ed.pointerDown({ x: -20, y: -20 }, {}); // empty space → begin marquee
    ed.pointerMove({ x: 110, y: 50 }, {});
    ed.pointerUp({ x: 110, y: 50 }, {});

    expect(new Set(ed.selectedIdsArray())).toEqual(new Set([a, b]));
  });

  it('shift-marquee is additive to the prior selection', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 40, h: 40 });
    const b = ed.createNode({ type: 'rect', x: 60, y: 0, w: 40, h: 40 });
    const c = ed.createNode({ type: 'rect', x: 300, y: 300, w: 40, h: 40 });
    ed.select([c]);

    ed.pointerDown({ x: -20, y: -20 }, { shift: true });
    ed.pointerMove({ x: 110, y: 50 }, { shift: true });
    ed.pointerUp({ x: 110, y: 50 }, { shift: true });

    expect(new Set(ed.selectedIdsArray())).toEqual(new Set([a, b, c]));
  });
});

describe('SelectTool — shift-click toggle', () => {
  it('toggles a node in and out of the selection', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 40, h: 40 });

    // plain click selects
    ed.pointerDown({ x: 20, y: 20 }, {});
    ed.pointerUp({ x: 20, y: 20 }, {});
    expect(ed.selectedIdsArray()).toEqual([a]);

    // shift-click removes it
    ed.pointerDown({ x: 20, y: 20 }, { shift: true });
    ed.pointerUp({ x: 20, y: 20 }, { shift: true });
    expect(ed.selectedIdsArray()).toEqual([]);

    // shift-click adds it back
    ed.pointerDown({ x: 20, y: 20 }, { shift: true });
    ed.pointerUp({ x: 20, y: 20 }, { shift: true });
    expect(ed.selectedIdsArray()).toEqual([a]);
  });
});

describe('Editor.align / Editor.distribute', () => {
  const x = (ed: Editor, id: Id): number => (ed.store.peek(id) as NodeRecord).x;

  it("align('left') snaps every node's left edge to the leftmost", () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 40, h: 40 });
    const b = ed.createNode({ type: 'rect', x: 100, y: 20, w: 60, h: 40 });
    expect(x(ed, b)).toBe(100);

    ed.align([a, b], 'left');
    expect(x(ed, a)).toBe(0);
    expect(x(ed, b)).toBe(0);
  });

  it("distribute('h') equalizes the horizontal gaps between successive boxes", () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 40, h: 40 });
    const b = ed.createNode({ type: 'rect', x: 100, y: 0, w: 20, h: 40 });
    const c = ed.createNode({ type: 'rect', x: 200, y: 0, w: 40, h: 40 });

    ed.distribute([a, b, c], 'h');

    const ra = ed.store.peek(a) as NodeRecord;
    const rb = ed.store.peek(b) as NodeRecord;
    const rc = ed.store.peek(c) as NodeRecord;
    const gap1 = rb.x - (ra.x + ra.w);
    const gap2 = rc.x - (rb.x + rb.w);
    expect(gap1).toBeCloseTo(gap2, 6);
    expect(rb.x).toBeCloseTo(110, 6); // outer boxes fixed, middle re-spaced
  });
});
