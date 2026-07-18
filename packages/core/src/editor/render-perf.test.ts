import { describe, expect, it, vi } from 'vitest';
import { Editor, type Ctx2D } from '../index.js';

/** A permissive canvas stub: every method is a no-op, every property write is swallowed, and
 *  measureText returns a zero-width metric. Enough to drive a full `render()` without a real canvas. */
function mockCtx(): Ctx2D {
  return new Proxy(
    {},
    {
      get: (_t, prop) => (prop === 'measureText' ? () => ({ width: 0 }) : () => {}),
      set: () => true,
    },
  ) as unknown as Ctx2D;
}

describe('render-loop perf', () => {
  const build = (): { ed: Editor } => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const b = ed.createNode({ type: 'rect', x: 300, y: 0, w: 100, h: 100 });
    ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b });
    return { ed };
  };

  it('computes the culled+sorted visible set ONCE per frame (shared by static + flow passes)', () => {
    const { ed } = build();
    const spy = vi.spyOn(ed.sceneIndex, 'visible');
    ed.render(mockCtx(), 800, 600, 1, false, 0);
    // Before sharing, paintStatic and paintFlow each queried the R-tree → 2 calls. Now: 1.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('re-queries after a mutation invalidates the per-frame memo', () => {
    const { ed } = build();
    const spy = vi.spyOn(ed.sceneIndex, 'visible');
    ed.render(mockCtx(), 800, 600, 1, false, 0);
    ed.createNode({ type: 'rect', x: 10, y: 10, w: 20, h: 20 }); // bumps scene version
    ed.render(mockCtx(), 800, 600, 1, false, 0);
    expect(spy).toHaveBeenCalledTimes(2); // one query per distinct frame state
  });

  it('hasFlow() stays correct across set / delete / undo via the O(1) flow index', () => {
    const { ed } = build();
    const e = ed.store.edges()[0]!.id;
    expect(ed.hasFlow()).toBe(false);
    ed.setFlow([e], { style: 'dots' });
    expect(ed.hasFlow()).toBe(true);
    ed.deleteRecords([e]);
    expect(ed.hasFlow()).toBe(false);
    ed.undo(); // the flowing edge comes back
    expect(ed.hasFlow()).toBe(true);
  });
});
