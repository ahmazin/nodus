import { describe, expect, it } from 'vitest';
import { Editor } from '@nodus-dev/core';
import { buildLayerTree, type LayerNode } from './layers-panel.js';

/** Flatten a tree to `id`s in visit order (row order the panel would render). */
function ids(tree: LayerNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: LayerNode[]): void => {
    for (const n of ns) {
      out.push(n.id);
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

const find = (tree: LayerNode[], id: string): LayerNode | undefined => {
  for (const n of tree) {
    if (n.id === id) return n;
    const inner = find(n.children, id);
    if (inner) return inner;
  }
  return undefined;
};

describe('buildLayerTree', () => {
  it('orders top-level nodes by z descending (front-most first)', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, label: 'A' }); // z assigned in creation order
    const b = ed.createNode({ type: 'rect', x: 60, y: 0, label: 'B' });
    const c = ed.createNode({ type: 'rect', x: 120, y: 0, label: 'C' });
    // sanity: creation assigns strictly increasing z strings
    const zOf = (id: string): string => ed.store.nodes().find((n) => n.id === id)!.z;
    expect(zOf(a) < zOf(b) && zOf(b) < zOf(c)).toBe(true);

    const tree = buildLayerTree(ed.store.nodes(), ed.store.edges());
    expect(ids(tree)).toEqual([c, b, a]); // highest z (front) on top
    expect(tree.every((n) => n.depth === 0 && n.isEdge === false)).toBe(true);
  });

  it('nests a group child under its group at depth 1, group at depth 0', () => {
    const ed = new Editor();
    const child = ed.createNode({ type: 'rect', x: 0, y: 0, label: 'child' });
    const g = ed.group([child], 'cluster')!;

    const tree = buildLayerTree(ed.store.nodes(), ed.store.edges());
    const group = find(tree, g)!;
    expect(group).toBeDefined();
    expect(group.depth).toBe(0);
    expect(group.type).toBe('group');
    expect(group.children.map((n) => n.id)).toEqual([child]);
    expect(group.children[0]!.depth).toBe(1);
    // the child is NOT also a top-level row
    expect(tree.some((n) => n.id === child)).toBe(false);
  });

  it('surfaces hidden and locked flags from the records', () => {
    const ed = new Editor();
    const hiddenId = ed.createNode({ type: 'rect', x: 0, y: 0, label: 'ghost' });
    const lockedId = ed.createNode({ type: 'rect', x: 60, y: 0, label: 'fixed' });
    const plainId = ed.createNode({ type: 'rect', x: 120, y: 0, label: 'plain' });
    ed.setNodesHidden([hiddenId], true);
    ed.lock([lockedId]);

    const tree = buildLayerTree(ed.store.nodes(), ed.store.edges());
    expect(find(tree, hiddenId)!.hidden).toBe(true);
    expect(find(tree, hiddenId)!.locked).toBe(false);
    expect(find(tree, lockedId)!.locked).toBe(true);
    expect(find(tree, lockedId)!.hidden).toBe(false);
    expect(find(tree, plainId)!.hidden).toBe(false);
    expect(find(tree, plainId)!.locked).toBe(false);
  });

  it('appends edges as flat top-level isEdge leaves after the nodes', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, label: 'A' });
    const b = ed.createNode({ type: 'rect', x: 200, y: 0, label: 'B' });
    const e = ed.connect({ kind: 'node', nodeId: a, portId: 'out' }, { kind: 'node', nodeId: b, portId: 'in' })!;
    expect(e).toBeTruthy();

    const tree = buildLayerTree(ed.store.nodes(), ed.store.edges());
    const edgeRow = find(tree, e)!;
    expect(edgeRow.isEdge).toBe(true);
    expect(edgeRow.depth).toBe(0);
    expect(edgeRow.children).toHaveLength(0);

    // edge row comes after every node row
    const flat = ids(tree);
    const lastNode = Math.max(flat.indexOf(a), flat.indexOf(b));
    expect(flat.indexOf(e)).toBeGreaterThan(lastNode);
  });

  it('gives a node with no label a non-empty fallback label (the type)', () => {
    const ed = new Editor();
    const id = ed.createNode({ type: 'rect', x: 0, y: 0 }); // no label
    const tree = buildLayerTree(ed.store.nodes(), ed.store.edges());
    const row = find(tree, id)!;
    expect(row.label.length).toBeGreaterThan(0);
    expect(row.label).toBe('rect');
  });

  it('returns an empty tree for an empty document', () => {
    const ed = new Editor();
    expect(buildLayerTree(ed.store.nodes(), ed.store.edges())).toEqual([]);
  });
});
