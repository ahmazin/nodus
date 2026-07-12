import { describe, expect, it } from 'vitest';
import { Editor, type EdgeRecord, type NodeRecord } from '../index.js';

const ep = (e: EdgeRecord, side: 'from' | 'to') => (e[side] as { nodeId?: string }).nodeId;

describe('double-click canvas → create node', () => {
  it('creates a node centered on the click and starts editing its label', () => {
    const ed = new Editor();
    expect(ed.store.nodes()).toHaveLength(0);
    ed.doubleClick({ x: 200, y: 150 });
    const nodes = ed.store.nodes();
    expect(nodes).toHaveLength(1);
    const n = nodes[0]!;
    expect(n.x + n.w / 2).toBeCloseTo(200, 0); // centered on the click, not top-left
    expect(n.y + n.h / 2).toBeCloseTo(150, 0);
    expect(ed.selectedIdsArray()).toEqual([n.id]);
    expect(ed.editingAtom.peek()).toBe(n.id); // rect is editable → edit begins
  });

  it('double-clicking an existing node edits it instead of creating a new one', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 130, h: 56 });
    ed.doubleClick({ x: 65, y: 28 }); // center of A
    expect(ed.store.nodes()).toHaveLength(1); // no new node
    expect(ed.editingAtom.peek()).toBe(a);
  });

  it('respects quickCreateType when set', () => {
    const ed = new Editor();
    ed.quickCreateType = 'rect';
    ed.doubleClick({ x: 10, y: 10 });
    expect(ed.store.nodes()[0]!.type).toBe('rect');
  });
});

describe('drag from a port → connect / create', () => {
  it('drags from a source port onto another node to create an edge', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 130, h: 56 }); // 'out' port at (130, 28)
    const b = ed.createNode({ type: 'rect', x: 300, y: 0, w: 130, h: 56 }); // center (365, 28)
    ed.pointerDown({ x: 130, y: 28 }); // grab A's out port
    ed.pointerMove({ x: 365, y: 28 });
    ed.pointerUp({ x: 365, y: 28 }); // drop on B
    const edges = ed.store.edges();
    expect(edges).toHaveLength(1);
    expect(ep(edges[0]!, 'from')).toBe(a);
    expect(ep(edges[0]!, 'to')).toBe(b);
  });

  it('drags from a port into empty space to quick-create a connected node (one undo entry)', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 130, h: 56 });
    ed.pointerDown({ x: 130, y: 28 });
    ed.pointerMove({ x: 400, y: 220 });
    ed.pointerUp({ x: 400, y: 220 }); // empty space
    expect(ed.store.nodes()).toHaveLength(2);
    expect(ed.store.edges()).toHaveLength(1);
    const created = ed.store.nodes().find((n) => n.id !== a)!;
    expect(created.x + created.w / 2).toBeCloseTo(400, 0); // centered on the drop
    // create + connect collapse into ONE undo entry
    ed.undo();
    expect(ed.store.nodes()).toHaveLength(1);
    expect(ed.store.edges()).toHaveLength(0);
  });

  it('dropping back on the same node makes no edge and no node', () => {
    const ed = new Editor();
    ed.createNode({ type: 'rect', x: 0, y: 0, w: 130, h: 56 });
    ed.pointerDown({ x: 130, y: 28 }); // A out port
    ed.pointerMove({ x: 65, y: 28 });
    ed.pointerUp({ x: 65, y: 28 }); // back on A
    expect(ed.store.edges()).toHaveLength(0);
    expect(ed.store.nodes()).toHaveLength(1);
  });

  it('grabbing a node away from its ports still moves it (port-drag does not hijack drags)', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 130, h: 56 });
    ed.select([a]);
    ed.pointerDown({ x: 40, y: 28 }); // interior, away from any port anchor
    ed.pointerMove({ x: 140, y: 28 });
    ed.pointerUp({ x: 140, y: 28 });
    expect(ed.store.edges()).toHaveLength(0);
    expect((ed.store.peek(a) as NodeRecord).x).toBeCloseTo(100, 0); // moved by ~100
  });
});
