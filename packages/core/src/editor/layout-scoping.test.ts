/**
 * Layout scoping + staleness (task E4). editor.layout() scopes the graph to the active page, excludes
 * hidden nodes, marks locked nodes fixed, and discards a superseded/late result. Each `it` fails on the
 * pre-change engine (whole-store graph, no fixed flag, no staleness guard).
 */
import { describe, expect, it } from 'vitest';
import { Editor } from '../index.js';
import type { LayoutGraph, LayoutResult } from '../layout/index.js';
import type { Id, NodeRecord } from '../model.js';

describe('E4 — layout graph scoping', () => {
  it('marks a locked node fixed and excludes hidden nodes', async () => {
    const ed = new Editor();
    let captured: LayoutGraph | undefined;
    ed.registerLayout({
      id: 'stub',
      layout: async (g): Promise<LayoutResult> => {
        captured = g;
        return { positions: {} };
      },
    });
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const b = ed.createNode({ type: 'rect', x: 100, y: 0 });
    const c = ed.createNode({ type: 'rect', x: 200, y: 0 });
    ed.lock([a]);
    ed.setNodesHidden([c], true);

    await ed.layout('stub');
    const ids = captured!.nodes.map((n) => n.id);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
    expect(ids).not.toContain(c); // hidden excluded
    expect(captured!.nodes.find((n) => n.id === a)?.fixed).toBe(true); // locked → fixed
  });
});

describe('E4 — layout staleness guard', () => {
  it('a second layout() discards the first, slower call\'s late result', async () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    let resolveSlow!: () => void;
    ed.registerLayout({
      id: 'slow',
      layout: (): Promise<LayoutResult> =>
        new Promise((res) => {
          resolveSlow = () => res({ positions: { [a]: { x: 999, y: 999 } } });
        }),
    });
    ed.registerLayout({ id: 'fast', layout: async (): Promise<LayoutResult> => ({ positions: { [a]: { x: 50, y: 50 } } }) });

    const slow = ed.layout('slow'); // gen 1, pending
    await ed.layout('fast'); // gen 2, commits x=50
    resolveSlow(); // slow resolves late → gen 1 is stale → discarded
    await slow;
    expect((ed.store.peek(a) as NodeRecord).x).toBe(50);
  });

  it('layout() whose result returns after dispose() is discarded', async () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    ed.registerLayout({ id: 's', layout: async (): Promise<LayoutResult> => ({ positions: { [a]: { x: 500, y: 500 } } }) });
    const p = ed.layout('s');
    ed.dispose();
    await p;
    expect((ed.store.peek(a as Id) as NodeRecord).x).toBe(0); // disposed → result not committed
  });
});
