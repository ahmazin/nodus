import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultTheme,
  type Camera,
  type Ctx2D,
  type EdgeRecord,
  type EdgeRegistry,
  type EdgeUtil,
  type NodeRecord,
  type NodeRegistry,
  type NodeUtil,
  type RenderItem,
  type ResolvedTokens,
} from '../index.js';
import { drawAmbient, drawGrid, paintItem, setPaintErrorHandler, type ItemPresentation } from './paint.js';
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

function edgeItem(id: string, type: string): RenderItem {
  const record = {
    id: `edge:${id}`, typeName: 'edge', version: 0, type,
    from: { kind: 'point', x: 0, y: 0 }, to: { kind: 'point', x: 40, y: 20 },
    visual: { state: 'solid' }, props: {},
  } as EdgeRecord;
  const route = [{ x: 0, y: 0 }, { x: 40, y: 20 }];
  return {
    id: record.id, kind: 'edge', record,
    geometry: {} as RenderItem['geometry'],
    aabb: { x: 0, y: 0, w: 40, h: 20 },
    route,
    renderVersion: 0,
  };
}

const edgeUtil = (type: string, draw: EdgeUtil['draw']): EdgeUtil => ({
  type,
  getRoute: () => [],
  draw,
});

function edgeRegistryOf(...utils: EdgeUtil[]): EdgeRegistry {
  const map = new Map(utils.map((u) => [u.type, u]));
  return { get: (t: string) => map.get(t) } as unknown as EdgeRegistry;
}

const noNodes = { get: () => undefined } as unknown as NodeRegistry;

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

/** A Ctx2D that logs every `translate`/`scale` call (with args) to an ordered array, mirroring the
 *  `recordingCtx()` pattern in `sketchy.test.ts` — lets us assert the exact presentation transform
 *  sequence `paintItem` applies about the item's aabb center. Every other member is a harmless no-op
 *  stub so `paintItem`'s save/restore/globalAlpha/draw plumbing doesn't throw. */
function transformRecordingCtx(): { ctx: Ctx2D; log: string[] } {
  const log: string[] = [];
  const fmt = (v: unknown): string => (typeof v === 'number' ? v.toString() : String(v));
  const obj: Record<string, unknown> = {
    globalAlpha: 1,
    save() {}, restore() {},
    translate(x: number, y: number) { log.push(`translate(${fmt(x)},${fmt(y)})`); },
    scale(x: number, y: number) { log.push(`scale(${fmt(x)},${fmt(y)})`); },
    rotate() {}, setTransform() {}, transform() {},
    clearRect() {}, fillRect() {}, strokeRect() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, arcTo() {}, ellipse() {},
    quadraticCurveTo() {}, bezierCurveTo() {}, rect() {},
    fill() {}, stroke() {}, clip() {},
    fillText() {}, strokeText() {}, measureText: (t: string) => ({ width: t.length * 6 }),
    setLineDash() {}, drawImage() {},
    fillStyle: '', strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '', lineDashOffset: 0,
    font: '', textAlign: '', textBaseline: '', shadowBlur: 0, shadowColor: '', shadowOffsetX: 0, shadowOffsetY: 0,
  };
  return { ctx: obj as unknown as Ctx2D, log };
}

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

  it('applies scale/offset about the aabb center: translate(cx+dx,cy+dy) → scale → translate(-cx,-cy)', () => {
    const nodes = registryOf(util('n', () => {}));
    const { ctx, log } = transformRecordingCtx();
    const item = nodeItem('n1', 'n'); // aabb: { x: 0, y: 0, w: 40, h: 20 } → center (20, 10)
    const present: ItemPresentation = { alpha: 1, scale: 2, dx: 5, dy: 7 };

    paintItem(ctx, item, nodes, noEdges, defaultTheme, present);

    const transformOps = log.filter((l) => l.startsWith('translate(') || l.startsWith('scale('));
    expect(transformOps).toEqual(['translate(25,17)', 'scale(2,2)', 'translate(-20,-10)']);
  });
});

describe('paintItem override', () => {
  it('shallow-merges override into the tokens the util sees — a strokeGradient reaches draw()', () => {
    const seen: (ResolvedTokens['strokeGradient'] | undefined)[] = [];
    const edges = edgeRegistryOf(edgeUtil('e', (_api, _edge, tokens) => { seen.push(tokens.strokeGradient); }));
    const { ctx } = stubCtx();
    const override: Partial<ResolvedTokens> = {
      strokeGradient: { stops: [{ at: 0, color: '#111111' }, { at: 1, color: '#222222' }], angle: 45 },
    };

    paintItem(ctx, edgeItem('e1', 'e'), noNodes, edges, defaultTheme, undefined, override);

    expect(seen).toEqual([override.strokeGradient]);
  });

  it('without an override, strokeGradient is undefined — unchanged behavior', () => {
    const seen: (ResolvedTokens['strokeGradient'] | undefined)[] = [];
    const edges = edgeRegistryOf(edgeUtil('e', (_api, _edge, tokens) => { seen.push(tokens.strokeGradient); }));
    const { ctx } = stubCtx();

    paintItem(ctx, edgeItem('e1', 'e'), noNodes, edges, defaultTheme);

    expect(seen).toEqual([undefined]);
  });

  it('other override fields (e.g. stroke) merge too, alongside untouched tokens', () => {
    const seen: ResolvedTokens[] = [];
    const edges = edgeRegistryOf(edgeUtil('e', (_api, _edge, tokens) => { seen.push(tokens); }));
    const { ctx } = stubCtx();

    paintItem(ctx, edgeItem('e1', 'e'), noNodes, edges, defaultTheme, undefined, { stroke: '#abcdef' });

    expect(seen[0]!.stroke).toBe('#abcdef');
    expect(seen[0]!.fill).toBe(defaultTheme.states.solid!.fill); // non-overridden fields pass through
  });
});

/** A stub Ctx2D that counts `createRadialGradient`/`fillRect` calls and hands back a fake gradient with
 *  a no-op `addColorStop`, so `drawAmbient` can be exercised without a real canvas. */
function ambientRecordingCtx(): { ctx: Ctx2D; radialGradients: number; fills: number } {
  const counts = { radialGradients: 0, fills: 0 };
  const gradient = { addColorStop() {} };
  const obj: Record<string, unknown> = {
    globalAlpha: 1,
    save() {}, restore() {},
    scale() {}, translate() {}, rotate() {}, setTransform() {}, transform() {},
    clearRect() {}, fillRect() { counts.fills++; }, strokeRect() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, arcTo() {}, ellipse() {},
    quadraticCurveTo() {}, bezierCurveTo() {}, rect() {},
    fill() {}, stroke() {}, clip() {},
    fillText() {}, strokeText() {}, measureText: (t: string) => ({ width: t.length * 6 }),
    setLineDash() {}, drawImage() {},
    createLinearGradient() { return gradient; },
    createRadialGradient() { counts.radialGradients++; return gradient; },
    fillStyle: '', strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '', lineDashOffset: 0,
    font: '', textAlign: '', textBaseline: '', shadowBlur: 0, shadowColor: '', shadowOffsetX: 0, shadowOffsetY: 0,
  };
  return {
    ctx: obj as unknown as Ctx2D,
    get radialGradients() { return counts.radialGradients; },
    get fills() { return counts.fills; },
  };
}

describe('drawAmbient', () => {
  const cam: Camera = { x: 0, y: 0, z: 1 };

  it('no-ops when theme.canvas.ambient is undefined — zero gradients, zero fills', () => {
    // read the counters AFTER the call (they are live getters) — a destructure up front would freeze
    // them at their pre-call value of 0 and pass vacuously.
    const probe = ambientRecordingCtx();

    drawAmbient(probe.ctx, defaultTheme, cam, 800, 600);

    expect(probe.radialGradients).toBe(0);
    expect(probe.fills).toBe(0);
  });

  it('paints one radial gradient per wash plus a vignette gradient when ambient is set', () => {
    const theme = {
      ...defaultTheme,
      canvas: {
        ...defaultTheme.canvas,
        ambient: {
          washes: [{ color: 'rgba(16,185,129,0.10)', cx: 0.25, cy: 0.2, r: 0.6 }],
          vignette: 0.12,
        },
      },
    };
    const probe = ambientRecordingCtx();

    drawAmbient(probe.ctx, theme, cam, 800, 600);

    // one wash + one vignette = at least 2 radial gradients, each backed by a fill.
    expect(probe.radialGradients).toBeGreaterThanOrEqual(2);
    expect(probe.fills).toBeGreaterThanOrEqual(2);
  });

  it('guards a non-finite camera like drawGrid does — no gradients, no throw', () => {
    const theme = {
      ...defaultTheme,
      canvas: {
        ...defaultTheme.canvas,
        ambient: { washes: [{ color: 'rgba(16,185,129,0.10)', cx: 0.5, cy: 0.5, r: 0.5 }] },
      },
    };
    const probe = ambientRecordingCtx();

    expect(() => drawAmbient(probe.ctx, theme, { x: NaN, y: 0, z: 1 }, 800, 600)).not.toThrow();
    expect(probe.radialGradients).toBe(0);
  });
});

/** A Ctx2D that records every dot `fillRect` (with the `globalAlpha` in effect at call time) and every
 *  stroked path (`moveTo`/`lineTo` points, `strokeStyle`, and `globalAlpha`) — lets `drawGrid` tests
 *  assert the major-gridline pass is distinct from the dot pass, and that alpha fades by distance. */
function gridRecordingCtx(): {
  ctx: Ctx2D;
  fillRects: { x: number; y: number; alpha: number }[];
  strokes: { points: [number, number][]; strokeStyle: string; alpha: number }[];
} {
  const fillRects: { x: number; y: number; alpha: number }[] = [];
  const strokes: { points: [number, number][]; strokeStyle: string; alpha: number }[] = [];
  let path: [number, number][] = [];
  const obj: Record<string, unknown> = {
    globalAlpha: 1,
    save() {}, restore() {},
    scale() {}, translate() {}, rotate() {}, setTransform() {}, transform() {},
    clearRect() {},
    fillRect(x: number, y: number) {
      fillRects.push({ x, y, alpha: obj.globalAlpha as number });
    },
    strokeRect() {},
    beginPath() { path = []; },
    closePath() {},
    moveTo(x: number, y: number) { path.push([x, y]); },
    lineTo(x: number, y: number) { path.push([x, y]); },
    arc() {}, arcTo() {}, ellipse() {}, quadraticCurveTo() {}, bezierCurveTo() {}, rect() {},
    fill() {},
    stroke() {
      strokes.push({ points: [...path], strokeStyle: obj.strokeStyle as string, alpha: obj.globalAlpha as number });
    },
    clip() {},
    fillText() {}, strokeText() {}, measureText: (t: string) => ({ width: t.length * 6 }),
    setLineDash() {}, drawImage() {},
    fillStyle: '', strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '', lineDashOffset: 0,
    font: '', textAlign: '', textBaseline: '', shadowBlur: 0, shadowColor: '', shadowOffsetX: 0, shadowOffsetY: 0,
  };
  return { ctx: obj as unknown as Ctx2D, fillRects, strokes };
}

describe('drawGrid — depth-faded dots + accent major lines', () => {
  const cam: Camera = { x: 0, y: 0, z: 1 };

  it('strokes at least one major gridline, distinct from the dot fillRects, when grid.major is set', () => {
    const theme = {
      ...defaultTheme,
      canvas: {
        ...defaultTheme.canvas,
        grid: { color: 'rgba(255,255,255,0.03)', size: 24, major: 'rgba(16,185,129,0.06)', majorEvery: 5 },
      },
    };
    const probe = gridRecordingCtx();

    drawGrid(probe.ctx, theme, cam, 240, 240);

    expect(probe.fillRects.length).toBeGreaterThan(0); // dot pass still runs
    expect(probe.strokes.length).toBeGreaterThan(0); // major-line pass ran too
    for (const s of probe.strokes) {
      expect(s.strokeStyle).toBe('rgba(16,185,129,0.06)'); // majors use grid.major, not grid.color
    }
  });

  it('does not stroke any lines when grid.major is unset (existing dot-only behavior)', () => {
    const theme = {
      ...defaultTheme,
      canvas: { ...defaultTheme.canvas, grid: { color: 'rgba(255,255,255,0.03)', size: 24 } },
    };
    const probe = gridRecordingCtx();

    drawGrid(probe.ctx, theme, cam, 240, 240);

    expect(probe.fillRects.length).toBeGreaterThan(0);
    expect(probe.strokes.length).toBe(0);
  });

  it('treats majorEvery: 0 as "majors disabled" — draws zero major lines', () => {
    const theme = {
      ...defaultTheme,
      canvas: {
        ...defaultTheme.canvas,
        grid: { color: 'rgba(255,255,255,0.03)', size: 24, major: 'rgba(16,185,129,0.06)', majorEvery: 0 },
      },
    };
    const probe = gridRecordingCtx();

    drawGrid(probe.ctx, theme, cam, 240, 240);

    expect(probe.fillRects.length).toBeGreaterThan(0); // dot pass still runs
    expect(probe.strokes.length).toBe(0); // majors disabled — no major lines at all
  });

  it('treats a negative majorEvery as "majors disabled" too, instead of the old NaN-modulo sign quirk', () => {
    // The real regression case: with the unguarded `grid.majorEvery ?? 5` fallback, a NEGATIVE value
    // does NOT silently draw nothing — JS's `%` keeps the dividend's sign, so
    // `((ix % -1) + -1) % -1 === 0` is true for every integer ix, meaning the old code would draw a
    // major line at every single gridline (worse than the "never draws" case majorEvery: 0 happens to
    // produce via NaN). The guard must skip the whole pass for any majorEvery <= 0.
    const theme = {
      ...defaultTheme,
      canvas: {
        ...defaultTheme.canvas,
        grid: { color: 'rgba(255,255,255,0.03)', size: 24, major: 'rgba(16,185,129,0.06)', majorEvery: -1 },
      },
    };
    const probe = gridRecordingCtx();

    drawGrid(probe.ctx, theme, cam, 240, 240);

    expect(probe.strokes.length).toBe(0);
  });

  it('still draws majors normally when majorEvery: 5 (the normal case is unchanged)', () => {
    const theme = {
      ...defaultTheme,
      canvas: {
        ...defaultTheme.canvas,
        grid: { color: 'rgba(255,255,255,0.03)', size: 24, major: 'rgba(16,185,129,0.06)', majorEvery: 5 },
      },
    };
    const probe = gridRecordingCtx();

    drawGrid(probe.ctx, theme, cam, 240, 240);

    expect(probe.strokes.length).toBeGreaterThan(0);
  });

  it('fades dot alpha by distance from the viewport center — a center dot is brighter than an edge dot', () => {
    const theme = {
      ...defaultTheme,
      canvas: { ...defaultTheme.canvas, grid: { color: 'rgba(255,255,255,0.03)', size: 24 } },
    };
    const probe = gridRecordingCtx();
    const cssW = 240;
    const cssH = 240;

    drawGrid(probe.ctx, theme, cam, cssW, cssH);

    const cx = cssW / 2;
    const cy = cssH / 2;
    const withDist = probe.fillRects.map((r) => ({ ...r, dist: Math.hypot(r.x - cx, r.y - cy) }));
    const nearest = withDist.reduce((a, b) => (b.dist < a.dist ? b : a));
    const farthest = withDist.reduce((a, b) => (b.dist > a.dist ? b : a));

    expect(nearest.alpha).toBeGreaterThan(farthest.alpha); // center ~full, edge ~0
    expect(farthest.alpha).toBeLessThan(0.3);
  });

  it('preserves the step < 6 skip and the non-finite-camera guard', () => {
    const theme = {
      ...defaultTheme,
      canvas: { ...defaultTheme.canvas, grid: { color: 'rgba(255,255,255,0.03)', size: 24 } },
    };
    const dense = gridRecordingCtx();
    drawGrid(dense.ctx, theme, { x: 0, y: 0, z: 0.2 }, 240, 240); // step = 24*0.2 = 4.8 < 6
    expect(dense.fillRects.length).toBe(0);

    const bad = gridRecordingCtx();
    expect(() => drawGrid(bad.ctx, theme, { x: NaN, y: 0, z: 1 }, 240, 240)).not.toThrow();
    expect(bad.fillRects.length).toBe(0);
  });
});
