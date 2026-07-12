import { describe, expect, it } from 'vitest';
import { Editor, type Ctx2D, type EdgeRecord } from '../index.js';

/** A recording Ctx2D that captures the packet-dot arc() calls paintFlow makes. */
function mockCtx(): Ctx2D & { arcs: { x: number; y: number; r: number }[] } {
  const arcs: { x: number; y: number; r: number }[] = [];
  const noop = (): void => {};
  return {
    arcs,
    save: noop, restore: noop, setTransform: noop, beginPath: noop, fill: noop, stroke: noop,
    moveTo: noop, lineTo: noop, setLineDash: noop, closePath: noop,
    arc: (x: number, y: number, r: number) => arcs.push({ x, y, r }),
    fillStyle: '', strokeStyle: '', lineWidth: 0, lineDashOffset: 0, shadowColor: '', shadowBlur: 0,
  } as unknown as Ctx2D & { arcs: { x: number; y: number; r: number }[] };
}

describe('edge flow animation', () => {
  const build = () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const b = ed.createNode({ type: 'rect', x: 400, y: 0, w: 100, h: 100 });
    const e = ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b })!;
    return { ed, e };
  };

  it('setFlow / hasFlow toggle, and clearing removes it', () => {
    const { ed, e } = build();
    expect(ed.hasFlow()).toBe(false);
    ed.setFlow([e], { style: 'dots', count: 3 });
    expect(ed.hasFlow()).toBe(true);
    expect((ed.store.peek(e) as EdgeRecord).flow).toMatchObject({ style: 'dots', count: 3 });
    ed.setFlow([e], null);
    expect(ed.hasFlow()).toBe(false);
  });

  it('is undoable and survives a toJSON round-trip', () => {
    const { ed, e } = build();
    ed.setFlow([e], { style: 'dots' });
    ed.undo();
    expect(ed.hasFlow()).toBe(false); // flow removed
    ed.redo();
    expect(ed.hasFlow()).toBe(true);
    const r2 = new Editor();
    r2.loadSnapshot(ed.toJSON());
    expect(r2.hasFlow()).toBe(true);
    expect((r2.store.edges()[0] as EdgeRecord).flow).toBeTruthy();
  });

  it('paintFlow draws the requested number of packets and animates them over time', () => {
    const { ed, e } = build();
    ed.setFlow([e], { style: 'dots', count: 3, speed: 70 });

    const c0 = mockCtx();
    ed.paintFlow(c0, 1, 0);
    expect(c0.arcs).toHaveLength(3); // three packets drawn

    const c1 = mockCtx();
    ed.paintFlow(c1, 1, 500); // 0.5s later
    expect(c1.arcs).toHaveLength(3);
    // the lead packet has advanced along the edge (positions differ from t=0)
    const moved = c1.arcs.some((p, i) => Math.abs(p.x - c0.arcs[i]!.x) > 1);
    expect(moved).toBe(true);
  });

  it('paintFlow is a no-op for a non-flowing edge', () => {
    const { ed } = build();
    const c = mockCtx();
    ed.paintFlow(c, 1, 0);
    expect(c.arcs).toHaveLength(0);
  });
});
