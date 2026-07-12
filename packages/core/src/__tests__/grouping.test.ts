import { describe, expect, it } from 'vitest';
import { Editor, type NodeRecord } from '../index.js';

describe('grouping / frames', () => {
  it('wraps nodes in a group and moves them together', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, label: 'A' });
    const b = ed.createNode({ type: 'rect', x: 200, y: 0, label: 'B' });
    const g = ed.group([a, b], 'cluster')!;
    expect(g).toBeTruthy();
    expect((ed.store.peek(a) as NodeRecord).parentId).toBe(g);
    expect(ed.childrenOf(g).sort()).toEqual([a, b].sort());

    const ax0 = (ed.store.peek(a) as NodeRecord).x;
    ed.moveBy([g], 50, 30); // moving the group moves children
    expect((ed.store.peek(a) as NodeRecord).x).toBe(ax0 + 50);
  });

  it('ungroups without deleting the children', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const g = ed.group([a])!;
    ed.ungroup(g);
    expect(ed.store.has(g)).toBe(false);
    expect(ed.store.has(a)).toBe(true);
    expect((ed.store.peek(a) as NodeRecord).parentId).toBeUndefined();
  });
});

describe('clipboard', () => {
  it('duplicates nodes + interconnecting edges with fresh ids', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, label: 'A' });
    const b = ed.createNode({ type: 'rect', x: 200, y: 0, label: 'B' });
    ed.connect({ kind: 'node', nodeId: a, portId: 'out' }, { kind: 'node', nodeId: b, portId: 'in' });
    expect(ed.store.nodes()).toHaveLength(2);
    expect(ed.store.edges()).toHaveLength(1);

    const created = ed.duplicate([a, b]);
    expect(created).toHaveLength(2);
    expect(ed.store.nodes()).toHaveLength(4);
    expect(ed.store.edges()).toHaveLength(2); // the edge was duplicated too

    // the duplicated edge connects the *new* nodes, not the originals
    const newSet = new Set(created);
    const dupEdge = ed.store.edges().find(
      (e) => e.from.kind === 'node' && newSet.has(e.from.nodeId),
    );
    expect(dupEdge).toBeTruthy();

    // paste offsets position and the whole duplication is one undo
    const na = ed.store.peek(created[0]!) as NodeRecord;
    expect(na.x).not.toBe(0);
    ed.undo();
    expect(ed.store.nodes()).toHaveLength(2);
  });
});
