import { describe, expect, it, vi } from 'vitest';
import {
  DrawApi,
  STENCIL,
  drawStencil,
  getIcon,
  iconNames,
  measureStencil,
  registerIcon,
  type Ctx2D,
  type NodeRecord,
  type ResolvedTokens,
} from '../index.js';

/**
 * A no-op Ctx2D that records how often key paint ops fire, captures drawn text, and — for the glass
 * material assertions — snapshots `fillStyle`/`strokeStyle` + shadow state at each `fill()`/`stroke()`
 * call (since this fake ctx has no real save/restore stack, sampling at call-time is the only way to
 * associate paint state with a specific op) and records gradient stops created via
 * `createLinearGradient`.
 */
function stubCtx() {
  const calls: Record<string, number> = {};
  const rec = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  const texts: string[] = [];
  const gradientStops: { at: number; color: string }[][] = [];
  const fillSnapshots: { fillStyle: unknown; shadowColor: string; shadowBlur: number; shadowOffsetY: number }[] = [];
  const strokeSnapshots: { strokeStyle: unknown; shadowColor: string; shadowBlur: number }[] = [];
  const ctx = {
    save() {}, restore() {}, scale() {}, translate() {}, rotate() {}, setTransform() {}, transform() {},
    clearRect() {}, fillRect() { rec('fillRect'); }, strokeRect() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, arcTo() {}, ellipse() {},
    quadraticCurveTo() {}, bezierCurveTo() {}, rect() {},
    fill() {
      rec('fill');
      fillSnapshots.push({
        fillStyle: ctx.fillStyle,
        shadowColor: ctx.shadowColor,
        shadowBlur: ctx.shadowBlur,
        shadowOffsetY: ctx.shadowOffsetY,
      });
    },
    stroke() {
      rec('stroke');
      strokeSnapshots.push({ strokeStyle: ctx.strokeStyle, shadowColor: ctx.shadowColor, shadowBlur: ctx.shadowBlur });
    },
    clip() {},
    fillText(t: string) { rec('fillText'); texts.push(t); }, strokeText() {},
    measureText(t: string) { return { width: t.length * 6 }; },
    setLineDash() {},
    createLinearGradient() {
      rec('createLinearGradient');
      const stops: { at: number; color: string }[] = [];
      gradientStops.push(stops);
      return { addColorStop(at: number, color: string) { stops.push({ at, color }); } };
    },
    fillStyle: '', strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '', lineDashOffset: 0,
    font: '', textAlign: '', textBaseline: '', globalAlpha: 1,
    shadowBlur: 0, shadowColor: '', shadowOffsetX: 0, shadowOffsetY: 0,
  };
  return { ctx: ctx as unknown as Ctx2D, calls, texts, gradientStops, fillSnapshots, strokeSnapshots };
}

const TOKENS: ResolvedTokens = {
  fill: '#0c100f',
  stroke: '#3b82f6',
  strokeWidth: 1,
  text: '#3b82f6',
  glow: '#3b82f6',
  opacity: 1,
  fontScale: 1,
  radius: 7,
  fontFamily: 'monospace',
  fontSize: 10.5,
  lineHeight: 1.3,
};

const node = (over: Partial<NodeRecord> = {}): NodeRecord =>
  ({ x: 10, y: 20, w: STENCIL.DEFAULT_W, h: STENCIL.NODE_H, label: 'Load Balancer', ...over }) as unknown as NodeRecord;

describe('measureStencil', () => {
  it('keeps a fixed stencil height and grows width with the label', () => {
    expect(STENCIL.NODE_H).toBe(STENCIL.TILE + STENCIL.GAP + STENCIL.LABEL_BAND);
    const short = measureStencil('x');
    expect(short.h).toBe(STENCIL.NODE_H);
    expect(short.w).toBe(STENCIL.DEFAULT_W); // short label clamps to the default width

    const long = measureStencil('A very long service label');
    expect(long.h).toBe(STENCIL.NODE_H);
    expect(long.w).toBeGreaterThan(short.w);
  });
});

describe('drawStencil', () => {
  it('paints the tile, glyph and label for a normal node', () => {
    const { ctx, calls, texts } = stubCtx();
    const api = new DrawApi(ctx, TOKENS);
    drawStencil(api, node(), TOKENS, { icon: 'balancer', label: 'Load Balancer' });

    expect(calls.fill).toBeGreaterThan(0); // tile + glyph body fills
    expect(calls.stroke).toBeGreaterThan(0); // tile border + glyph outline
    expect(texts).toContain('Load Balancer'); // label drawn below
  });

  it('honors the locked override: shows the override label and skips the glyph', () => {
    const normal = stubCtx();
    drawStencil(new DrawApi(normal.ctx, TOKENS), node(), TOKENS, { icon: 'balancer', label: 'LB' });

    const locked = stubCtx();
    drawStencil(new DrawApi(locked.ctx, TOKENS), node(), { ...TOKENS, labelOverride: '?' }, { icon: 'balancer', label: 'LB' });

    expect(locked.texts).toContain('?');
    expect(locked.texts).not.toContain('LB');
    // glyph is skipped when locked, so fewer fill ops than the glyph-bearing normal render
    expect(locked.calls.fill ?? 0).toBeLessThan(normal.calls.fill ?? 0);
  });
});

describe('built-in glyphs', () => {
  it('every registered icon renders without throwing (outline + fill channels)', () => {
    const { ctx } = stubCtx();
    for (const name of iconNames()) {
      const draw = getIcon(name)!;
      expect(() => draw(ctx, 0, 0, 40, '#3b82f6', '#3b82f6')).not.toThrow();
      expect(() => draw(ctx, 0, 0, 40, '#3b82f6')).not.toThrow(); // fill omitted -> body falls back
    }
  });
});

describe('drawStencil glass material', () => {
  const SHADOW = { color: 'rgba(0,0,0,0.30)', blur: 16, dy: 4 };
  const GLASS_TOKENS: ResolvedTokens = { ...TOKENS, glass: 0.16, shadow: SHADOW };

  it('glass>0: tile fills with a two-stop gradient + shadow; glow moves to the stroke; rim-light strokes', () => {
    const { ctx, fillSnapshots, gradientStops, strokeSnapshots } = stubCtx();
    drawStencil(new DrawApi(ctx, GLASS_TOKENS), node(), GLASS_TOKENS, { icon: 'balancer', label: 'Load Balancer' });

    // the tile fill (first fill() call) used a gradient, not a flat color
    const tileFill = fillSnapshots[0]!;
    expect(gradientStops.length).toBeGreaterThan(0);
    expect(typeof tileFill.fillStyle).not.toBe('string');
    expect(gradientStops[0]).toHaveLength(2);

    // ...and carried the offset drop-shadow
    expect(tileFill.shadowColor).toBe(SHADOW.color);
    expect(tileFill.shadowBlur).toBe(SHADOW.blur);

    // the category glow rides the stroke instead (glowBlur 8)
    expect(strokeSnapshots.some((s) => s.shadowColor === GLASS_TOKENS.glow && s.shadowBlur === 8)).toBe(true);

    // a white inner rim-light was stroked
    expect(
      strokeSnapshots.some((s) => typeof s.strokeStyle === 'string' && (s.strokeStyle as string).startsWith('rgba(255,255,255,')),
    ).toBe(true);
  });

  it('glass unset: flat fill, no gradient — unchanged from today', () => {
    const { ctx, fillSnapshots, gradientStops } = stubCtx();
    drawStencil(new DrawApi(ctx, TOKENS), node(), TOKENS, { icon: 'balancer', label: 'Load Balancer' });

    expect(gradientStops.length).toBe(0);
    const tileFill = fillSnapshots[0]!;
    expect(tileFill.fillStyle).toBe(TOKENS.fill);
    expect(tileFill.shadowBlur).toBe(14); // today's plain glow blur on the fill
  });
});

describe('drawStencil depth-of-field LOD', () => {
  it('below the LOD threshold (zoom 0.4), the glyph and label are skipped — tile only', () => {
    const { ctx } = stubCtx();
    const api = new DrawApi(ctx, TOKENS, 0, 0.4);
    const iconSpy = vi.spyOn(api, 'icon');
    const labelSpy = vi.spyOn(api, 'label');

    drawStencil(api, node(), TOKENS, { icon: 'balancer', label: 'Load Balancer' });

    expect(iconSpy).not.toHaveBeenCalled();
    expect(labelSpy).not.toHaveBeenCalled();
  });

  it('at zoom 1 (default), the glyph and label are drawn — full detail', () => {
    const { ctx } = stubCtx();
    const api = new DrawApi(ctx, TOKENS, 0, 1);
    const iconSpy = vi.spyOn(api, 'icon');
    const labelSpy = vi.spyOn(api, 'label');

    drawStencil(api, node(), TOKENS, { icon: 'balancer', label: 'Load Balancer' });

    expect(iconSpy).toHaveBeenCalledTimes(1);
    expect(labelSpy).toHaveBeenCalledTimes(1);
  });
});

describe('drawStencil needsChip', () => {
  it('paints a light chip behind glyphs flagged needsChip', () => {
    registerIcon('chip-test', () => {}, { needsChip: true });
    registerIcon('plain-test', () => {});
    const chip = stubCtx();
    drawStencil(new DrawApi(chip.ctx, TOKENS), node(), TOKENS, { icon: 'chip-test', label: 'X' });
    const plain = stubCtx();
    drawStencil(new DrawApi(plain.ctx, TOKENS), node(), TOKENS, { icon: 'plain-test', label: 'X' });
    // the chip adds one extra fill (the chip rect) vs the plain icon
    expect((chip.calls.fill ?? 0)).toBeGreaterThan(plain.calls.fill ?? 0);
  });
});
