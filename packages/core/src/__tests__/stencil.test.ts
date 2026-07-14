import { describe, expect, it } from 'vitest';
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

/** A no-op Ctx2D that records how often key paint ops fire and captures drawn text. */
function stubCtx() {
  const calls: Record<string, number> = {};
  const rec = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  const texts: string[] = [];
  const ctx = {
    save() {}, restore() {}, scale() {}, translate() {}, rotate() {}, setTransform() {}, transform() {},
    clearRect() {}, fillRect() { rec('fillRect'); }, strokeRect() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, arcTo() {}, ellipse() {},
    quadraticCurveTo() {}, bezierCurveTo() {}, rect() {},
    fill() { rec('fill'); }, stroke() { rec('stroke'); }, clip() {},
    fillText(t: string) { rec('fillText'); texts.push(t); }, strokeText() {},
    measureText(t: string) { return { width: t.length * 6 }; },
    setLineDash() {},
    fillStyle: '', strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '', lineDashOffset: 0,
    font: '', textAlign: '', textBaseline: '', globalAlpha: 1,
    shadowBlur: 0, shadowColor: '', shadowOffsetX: 0, shadowOffsetY: 0,
  };
  return { ctx: ctx as unknown as Ctx2D, calls, texts };
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
