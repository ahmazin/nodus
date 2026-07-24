/**
 * Instance isolation (task A10): per-editor icon registry (private registrations isolated, shared
 * defaults fall through) and per-editor paint-error routing (a throwing draw() reports to THAT
 * editor's bus, deduped, never another's or the console). Plus the setPaintErrorHandler(null) fix:
 * null RESTORES the console default, it does not install silence. Each `it` fails on the pre-change
 * engine (module-global icon set, module-global paint handler, null→no-op).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  Editor,
  Rectangle2d,
  Registry,
  defaultTheme,
  paintItem,
  setPaintErrorHandler,
  type Ctx2D,
  type IconDraw,
  type NodeUtil,
  type RenderItem,
} from '../index.js';

function mockCtx(): Ctx2D {
  return new Proxy(
    {},
    { get: (_t, p) => (p === 'measureText' ? () => ({ width: 0 }) : () => {}), set: () => true },
  ) as unknown as Ctx2D;
}

const boomType: NodeUtil = {
  type: 'boom',
  getDefaultProps: () => ({}),
  getGeometry: (n) => new Rectangle2d({ x: n.x, y: n.y, w: n.w, h: n.h }),
  draw: () => {
    throw new Error('draw boom');
  },
};

describe('A10 — per-editor icon registry', () => {
  it('an icon registered on A is absent on B; both still resolve the shared defaults', () => {
    const a = new Editor();
    const b = new Editor();
    const glyph: IconDraw = () => {};
    a.icons.register('mine', glyph);
    expect(a.icons.get('mine')).toBe(glyph);
    expect(b.icons.get('mine')).toBeUndefined(); // isolated to A
    expect(a.icons.get('database')).toBeTypeOf('function'); // shared default still resolves
    expect(b.icons.get('database')).toBeTypeOf('function');
  });

  it('unregister restores the shared default glyph for a shadowed name', () => {
    const a = new Editor();
    const custom: IconDraw = () => {};
    a.icons.register('database', custom); // shadow a built-in for this editor
    expect(a.icons.get('database')).toBe(custom);
    a.icons.unregister('database');
    const restored = a.icons.get('database');
    expect(restored).toBeTypeOf('function');
    expect(restored).not.toBe(custom); // back to the shared default
  });
});

describe('A10 — per-editor paint-error routing', () => {
  it("a throwing draw() on editor A reports to A's bus, not B's", () => {
    const a = new Editor();
    a.registerNodeType(boomType);
    const b = new Editor();
    b.registerNodeType(boomType);
    const aErr: unknown[] = [];
    a.on('error', (e) => e.context.phase === 'paint' && aErr.push(e));
    const bErr: unknown[] = [];
    b.on('error', (e) => e.context.phase === 'paint' && bErr.push(e));

    a.createNode({ type: 'boom', x: 10, y: 10, w: 50, h: 50 });
    a.render(mockCtx(), 200, 200, 1);
    expect(aErr.length).toBeGreaterThan(0); // A's bus received the paint error
    expect(bErr).toHaveLength(0); // B's bus is untouched
  });

  it('per-editor paint dedup: the same failing item painted twice yields ONE event', () => {
    const a = new Editor();
    a.registerNodeType(boomType);
    const aErr: unknown[] = [];
    a.on('error', (e) => e.context.phase === 'paint' && aErr.push(e));
    a.createNode({ type: 'boom', x: 10, y: 10, w: 50, h: 50 });
    a.render(mockCtx(), 200, 200, 1);
    a.render(mockCtx(), 200, 200, 1); // same record@version
    expect(aErr).toHaveLength(1);
  });
});

describe('A10 — setPaintErrorHandler(null) restores the default, not silence', () => {
  it('the module-global handler logs via console after null (fixing the null→no-op bug)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      setPaintErrorHandler(null); // must RESTORE the deduped console default
      const nodes = new Registry<NodeUtil>();
      nodes.register(boomType);
      const item = {
        id: 'node:x',
        kind: 'node',
        record: {
          id: 'node:x',
          typeName: 'node',
          version: 0,
          type: 'boom',
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          z: 'a0',
          visual: { state: 'solid' },
          props: {},
        },
        geometry: {} as never,
        aabb: { x: 0, y: 0, w: 10, h: 10 },
        renderVersion: 0,
      } as unknown as RenderItem;
      // no deps.onPaintError → routes to the module-global handler, which must be the console default
      paintItem(mockCtx(), item, nodes, new Registry(), defaultTheme);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      setPaintErrorHandler(null);
    }
  });
});
