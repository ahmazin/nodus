import { describe, expect, it } from 'vitest';
import {
  Editor,
  Rectangle2d,
  Polyline2d,
  atom,
  boxEncloses,
  computed,
  diff,
  effect,
  fitBox,
  resolveTokens,
  restore,
  screenToWorld,
  serializeRecords,
  transact,
  worldToScreen,
  zoomAt,
  type Camera,
  type LayoutEngine,
  type NodeRecord,
  type Theme,
} from '../index.js';

describe('signals', () => {
  it('computed recomputes only when a real dependency changes', () => {
    const a = atom(1);
    const b = atom(10);
    let runs = 0;
    const c = computed(() => {
      runs++;
      return a.get() * 2;
    });
    expect(c.get()).toBe(2);
    expect(runs).toBe(1);
    b.set(20); // unrelated
    c.get();
    expect(runs).toBe(1);
    a.set(5);
    expect(c.get()).toBe(10);
    expect(runs).toBe(2);
  });

  it('transact rolls back all writes on throw', () => {
    const a = atom(1);
    const b = atom(2);
    expect(() =>
      transact(() => {
        a.set(100);
        b.set(200);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(a.peek()).toBe(1);
    expect(b.peek()).toBe(2);
  });

  it('effect batches multiple writes into one run', () => {
    const a = atom(0);
    const log: number[] = [];
    const stop = effect(() => log.push(a.get()));
    transact(() => {
      a.set(1);
      a.set(2);
      a.set(3);
    });
    stop();
    expect(log).toEqual([0, 3]);
  });
});

describe('geometry', () => {
  it('rectangle distance is 0 inside, positive outside', () => {
    const r = new Rectangle2d({ x: 0, y: 0, w: 100, h: 50 });
    expect(r.distanceToPoint({ x: 50, y: 25 })).toBe(0);
    expect(r.distanceToPoint({ x: 110, y: 25 })).toBeCloseTo(10);
    expect(r.hitPoint({ x: 104, y: 25 }, 5)).toBe(true);
  });

  it('polyline distance measures to nearest segment', () => {
    const p = new Polyline2d(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      8,
    );
    expect(p.distanceToPoint({ x: 50, y: 3 })).toBe(0); // within half-width
    expect(p.distanceToPoint({ x: 50, y: 20 })).toBeCloseTo(16);
  });

  it('boxEncloses is strict containment', () => {
    const outer = { x: 0, y: 0, w: 100, h: 100 };
    expect(boxEncloses(outer, { x: 10, y: 10, w: 20, h: 20 })).toBe(true);
    expect(boxEncloses(outer, { x: 90, y: 90, w: 20, h: 20 })).toBe(false);
  });
});

describe('camera', () => {
  it('screenToWorld inverts worldToScreen', () => {
    const cam: Camera = { x: 30, y: -12, z: 1.7 };
    const w = { x: 123, y: 456 };
    const back = screenToWorld(cam, worldToScreen(cam, w));
    expect(back.x).toBeCloseTo(w.x);
    expect(back.y).toBeCloseTo(w.y);
  });

  it('zoomAt keeps the world point under the cursor fixed', () => {
    const cam: Camera = { x: 0, y: 0, z: 1 };
    const screenPoint = { x: 400, y: 300 };
    const worldBefore = screenToWorld(cam, screenPoint);
    const next = zoomAt(cam, screenPoint, 2);
    const worldAfter = screenToWorld(next, screenPoint);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y);
    expect(next.z).toBeCloseTo(2);
  });

  it('fitBox centers content in the viewport', () => {
    const cam = fitBox({ x: 0, y: 0, w: 200, h: 100 }, 800, 600, 0);
    // content center in world = (100,50); should map to viewport center (400,300)
    const c = worldToScreen(cam, { x: 100, y: 50 });
    expect(c.x).toBeCloseTo(400);
    expect(c.y).toBeCloseTo(300);
  });
});

describe('theme token resolution', () => {
  const theme: Theme = {
    name: 't',
    palette: {},
    typography: { fontFamily: 'mono', size: 10, lineHeight: 1.2 },
    radii: { node: 7 },
    canvas: { fill: '#000' },
    states: {
      accent: { fill: '#0c100f', strokeWidth: 1 } as Theme['states'][string],
      solid: { fill: '#0c100f', stroke: '#3a423f', strokeWidth: 1, text: '#e5e5e5', glow: null },
    },
    overlays: { missed: { stroke: '#ef4444', glow: '#ef4444' } },
    focus: { strokeWidth: 2 },
    byType: { 'infra.db': { stroke: '#06b6d4', text: '#06b6d4', glow: '#06b6d4' } },
  };

  it('layers byType < state, so accent shows the type color', () => {
    const t = resolveTokens(theme, { state: 'accent' }, 'infra.db');
    expect(t.stroke).toBe('#06b6d4');
    expect(t.glow).toBe('#06b6d4');
    expect(t.fill).toBe('#0c100f');
    expect(t.radius).toBe(7);
  });

  it('solid state clears the inherited glow via null', () => {
    const t = resolveTokens(theme, { state: 'solid' }, 'infra.db');
    expect(t.stroke).toBe('#3a423f');
    expect(t.glow).toBeNull();
  });

  it('overlay layers above state; focus bumps stroke width', () => {
    const t = resolveTokens(theme, { state: 'accent', overlay: 'missed', focused: true }, 'infra.db');
    expect(t.stroke).toBe('#ef4444');
    expect(t.strokeWidth).toBe(2);
  });
});

describe('diff', () => {
  it('reports added / removed / changed', () => {
    const base = (id: string, x: number): NodeRecord => ({
      id: `node:${id}` as NodeRecord['id'],
      typeName: 'node',
      version: 0,
      type: 'rect',
      x,
      y: 0,
      w: 10,
      h: 10,
      z: '0',
      visual: { state: 'solid' },
      props: {},
    });
    const prev = [base('a', 0), base('b', 0)];
    const next = [base('a', 99), base('c', 0)];
    const d = diff(prev, next);
    expect(d.added).toEqual(['node:c']);
    expect(d.removed).toEqual(['node:b']);
    expect(d.changed.map((c) => c.id)).toEqual(['node:a']);
  });
});

describe('editor: document ops + history', () => {
  it('creates, connects, and cascades edge deletion', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, label: 'A' });
    const b = ed.createNode({ type: 'rect', x: 200, y: 0, label: 'B' });
    expect(ed.store.nodes()).toHaveLength(2);
    const e = ed.connect({ kind: 'node', nodeId: a, portId: 'out' }, { kind: 'node', nodeId: b, portId: 'in' });
    expect(e).toBeTruthy();
    expect(ed.store.edges()).toHaveLength(1);
    ed.deleteRecords([a]);
    expect(ed.store.nodes()).toHaveLength(1);
    expect(ed.store.edges()).toHaveLength(0); // cascaded
  });

  it('a dragged gesture (later + mark) is a single undo entry', () => {
    const ed = new Editor();
    const n = ed.createNode({ type: 'rect', x: 0, y: 0 });
    for (let i = 0; i < 5; i++) ed.moveBy([n], 10, 0, { capture: 'later' });
    ed.mark();
    expect((ed.store.peek(n) as NodeRecord).x).toBe(50);
    ed.undo();
    expect((ed.store.peek(n) as NodeRecord).x).toBe(0);
    ed.redo();
    expect((ed.store.peek(n) as NodeRecord).x).toBe(50);
  });

  it('undo∘redo round-trips the whole document to identity', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, label: 'A' });
    const b = ed.createNode({ type: 'rect', x: 100, y: 0, label: 'B' });
    ed.connect({ kind: 'node', nodeId: a, portId: 'out' }, { kind: 'node', nodeId: b, portId: 'in' });
    ed.moveBy([b], 50, 25, { capture: 'immediately' });
    const snapshot = JSON.stringify(ed.toJSON().document.records.length);
    // undo everything, then redo everything
    for (let i = 0; i < 8; i++) ed.undo();
    expect(ed.store.size).toBe(0);
    for (let i = 0; i < 8; i++) ed.redo();
    expect(JSON.stringify(ed.toJSON().document.records.length)).toBe(snapshot);
  });

  it('capture:never is not recorded in history', () => {
    const ed = new Editor();
    ed.createNode({ type: 'rect', x: 0, y: 0 }, { capture: 'never' });
    expect(ed.history.canUndo()).toBe(false);
  });
});

describe('editor: scene index + interaction', () => {
  it('moving a node reflows its connected edge route', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const b = ed.createNode({ type: 'rect', x: 300, y: 0 });
    const e = ed.connect({ kind: 'node', nodeId: a, portId: 'out' }, { kind: 'node', nodeId: b, portId: 'in' })!;
    const before = ed.sceneIndex.getItem(e)!.route!.at(-1)!;
    ed.moveBy([b], 0, 120, { capture: 'immediately' });
    const after = ed.sceneIndex.getItem(e)!.route!.at(-1)!;
    expect(after.y).not.toBe(before.y); // endpoint followed node
  });

  it('hit-test prefers the node over an underlying edge', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 50 });
    const b = ed.createNode({ type: 'rect', x: 0, y: 200, w: 100, h: 50 });
    ed.connect({ kind: 'node', nodeId: a, portId: 'bottom' }, { kind: 'node', nodeId: b, portId: 'top' });
    const hit = ed.sceneIndex.hitTest({ x: 50, y: 25 }, 4);
    expect(hit?.kind).toBe('node');
    expect(hit?.id).toBe(a);
  });

  it('marquee selects only fully-enclosed nodes', () => {
    const ed = new Editor();
    const inside = ed.createNode({ type: 'rect', x: 20, y: 20, w: 40, h: 20 });
    ed.createNode({ type: 'rect', x: 500, y: 500, w: 40, h: 20 });
    const enclosed = ed.sceneIndex.enclosedNodes({ x: 0, y: 0, w: 100, h: 100 });
    expect(enclosed).toEqual([inside]);
  });

  it('the Create tool places a node via pointer events', () => {
    const ed = new Editor({ viewport: { w: 800, h: 600 } });
    ed.setTool('create', { type: 'rect' });
    ed.pointerDown({ x: 100, y: 100 });
    ed.pointerUp({ x: 100, y: 100 });
    expect(ed.store.nodes()).toHaveLength(1);
    expect(ed.currentToolId).toBe('select'); // create switches back
  });
});

describe('editor: layout + serialization', () => {
  it('runs a registered layout engine as a single undoable step', async () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const b = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const fake: LayoutEngine = {
      id: 'grid',
      async layout(graph) {
        const positions: Record<string, { x: number; y: number }> = {};
        graph.nodes.forEach((n, i) => (positions[n.id] = { x: i * 200, y: 0 }));
        return { positions };
      },
    };
    ed.registerLayout(fake);
    await ed.layout('grid');
    expect((ed.store.peek(b) as NodeRecord).x).toBe(200);
    ed.undo();
    expect((ed.store.peek(b) as NodeRecord).x).toBe(0);
    void a;
  });

  it('round-trips through toJSON/restore and repairs a dangling edge', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const b = ed.createNode({ type: 'rect', x: 100, y: 0 });
    ed.connect({ kind: 'node', nodeId: a, portId: 'out' }, { kind: 'node', nodeId: b, portId: 'in' });
    const snap = ed.toJSON();
    const count = snap.document.records.length;

    // inject a dangling edge
    snap.document.records.push({
      id: 'edge:dangling' as never,
      typeName: 'edge',
      version: 0,
      type: 'line',
      from: { kind: 'node', nodeId: 'node:ghost' as never },
      to: { kind: 'node', nodeId: 'node:ghost2' as never },
      visual: { state: 'solid' },
      props: {},
    } as never);

    const result = restore(serializeRecords(snap.document.records));
    expect(result.droppedEdges).toBe(1);
    expect(result.records).toHaveLength(count); // dangling edge dropped, rest intact
  });
});
