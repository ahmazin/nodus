import { afterEach, describe, expect, it } from 'vitest';
import { defaultTheme, type Ctx2D, type NodeRecord, type NodeRegistry, type NodeUtil, type RenderItem } from '../index.js';
import { paintItem, setPaintErrorHandler, type ItemPresentation } from './paint.js';
import { clearTokenCache } from './token-cache.js';

/** A stub Ctx2D that counts key ops and maintains a real save/restore stack for `globalAlpha`, so we
 *  can prove the per-item `finally` restore actually runs after a throwing draw. */
function stubCtx() {
  const calls: Record<string, number> = {};
  const stack: number[] = [];
  const rec = (n: string) => {
    calls[n] = (calls[n] ?? 0) + 1;
  };
  const ctx = {
    globalAlpha: 1,
    save() {
      stack.push(ctx.globalAlpha);
    },
    restore() {
      const v = stack.pop();
      if (v !== undefined) ctx.globalAlpha = v;
    },
    scale() {}, translate() {}, rotate() {}, setTransform() {}, transform() {},
    clearRect() {}, fillRect() { rec('fillRect'); }, strokeRect() { rec('strokeRect'); },
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, arcTo() {}, ellipse() {},
    quadraticCurveTo() {}, bezierCurveTo() {}, rect() {},
    fill() { rec('fill'); }, stroke() { rec('stroke'); }, clip() {},
    fillText() { rec('fillText'); }, strokeText() {}, measureText: (t: string) => ({ width: t.length * 6 }),
    setLineDash() {}, drawImage() { rec('drawImage'); },
    fillStyle: '', strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '', lineDashOffset: 0,
    font: '', textAlign: '', textBaseline: '', shadowBlur: 0, shadowColor: '', shadowOffsetX: 0, shadowOffsetY: 0,
  };
  return { ctx: ctx as unknown as Ctx2D, calls, get alpha() { return ctx.globalAlpha; } };
}

function nodeItem(id: string, type: string): RenderItem {
  const record = {
    id: `node:${id}`, typeName: 'node', version: 0, type,
    x: 0, y: 0, w: 40, h: 20, z: '0', visual: { state: 'solid' }, props: {},
  } as NodeRecord;
  return {
    id: record.id, kind: 'node', record,
    geometry: {} as RenderItem['geometry'],
    aabb: { x: 0, y: 0, w: 40, h: 20 },
    renderVersion: 0,
  };
}

const util = (type: string, draw: NodeUtil['draw']): NodeUtil => ({
  type, getDefaultProps: () => ({}),
  getGeometry: () => ({}) as ReturnType<NodeUtil['getGeometry']>,
  draw,
});

function registryOf(...utils: NodeUtil[]): NodeRegistry {
  const map = new Map(utils.map((u) => [u.type, u]));
  return { get: (t: string) => map.get(t) } as unknown as NodeRegistry;
}

const noEdges = { get: () => undefined } as unknown as Parameters<typeof paintItem>[3];

afterEach(() => {
  setPaintErrorHandler(null);
  clearTokenCache();
});

describe('paintItem fault tolerance', () => {
  it('a throwing draw() is isolated — later items on the frame still paint', () => {
    const skipped: string[] = [];
    setPaintErrorHandler((_err, r) => skipped.push(r.id));

    let goodDraws = 0;
    const nodes = registryOf(
      util('bad', () => { throw new Error('boom'); }),
      util('good', () => { goodDraws++; }),
    );
    const { ctx, calls } = stubCtx();

    // paint a malformed record first, then a healthy one — the healthy one must still draw.
    paintItem(ctx, nodeItem('bad', 'bad'), nodes, noEdges, defaultTheme);
    paintItem(ctx, nodeItem('good', 'good'), nodes, noEdges, defaultTheme);

    expect(goodDraws).toBe(1); // the frame was not aborted
    expect(skipped).toEqual(['node:bad']); // the bad record was surfaced, not swallowed
    expect(calls.strokeRect ?? 0).toBeGreaterThan(0); // an error placeholder marked the gap
  });

  it('restores globalAlpha after a throwing draw so later items are not dimmed', () => {
    setPaintErrorHandler(() => {});
    const nodes = registryOf(util('bad', (api) => {
      api.ctx.globalAlpha *= 0.2; // dirty state mid-draw...
      throw new Error('boom'); // ...then throw
    }));
    const probe = stubCtx();
    paintItem(probe.ctx, nodeItem('bad', 'bad'), nodes, noEdges, defaultTheme);
    expect(probe.alpha).toBe(1); // finally-restore undid the leaked alpha
  });

  it('an unregistered type is a no-op, not a crash', () => {
    setPaintErrorHandler(() => {});
    const { ctx } = stubCtx();
    expect(() => paintItem(ctx, nodeItem('x', 'nope'), registryOf(), noEdges, defaultTheme)).not.toThrow();
  });
});

describe('paintItem presentation modifier', () => {
  it('multiplies globalAlpha by the presentation alpha', () => {
    const drawn: number[] = [];
    const nodes = registryOf(util('n', (api) => { drawn.push(api.ctx.globalAlpha); }));
    const { ctx } = stubCtx();
    const present: ItemPresentation = { alpha: 0.5, scale: 1, dx: 0, dy: 0 };

    paintItem(ctx, nodeItem('n1', 'n'), nodes, noEdges, defaultTheme, present);

    expect(drawn[0]).toBeCloseTo(0.5);
  });

  it('defaults to alpha 1 when no presentation is supplied', () => {
    const drawn: number[] = [];
    const nodes = registryOf(util('n', (api) => { drawn.push(api.ctx.globalAlpha); }));
    const { ctx } = stubCtx();

    paintItem(ctx, nodeItem('n1', 'n'), nodes, noEdges, defaultTheme);

    expect(drawn[0]).toBe(1);
  });
});
