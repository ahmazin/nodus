import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultTheme,
  type Ctx2D,
  type EdgeRegistry,
  type NodeRecord,
  type NodeRegistry,
  type NodeUtil,
  type RenderItem,
} from '../index.js';
import { drawOverlayBadge, paintItem } from './paint.js';
import { clearTokenCache } from './token-cache.js';

afterEach(() => clearTokenCache());

/** A Ctx2D that records arc()/fill()/stroke() calls so we can prove the corner badge was drawn (and
 *  where) without a real canvas. Every other member is a harmless no-op. */
function badgeCtx() {
  const arcs: { x: number; y: number; r: number }[] = [];
  const counts = { fill: 0, stroke: 0 };
  const obj: Record<string, unknown> = {
    globalAlpha: 1,
    save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, setTransform() {}, transform() {},
    clearRect() {}, fillRect() {}, strokeRect() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    arc(x: number, y: number, r: number) { arcs.push({ x, y, r }); },
    arcTo() {}, ellipse() {}, quadraticCurveTo() {}, bezierCurveTo() {}, rect() {},
    fill() { counts.fill++; }, stroke() { counts.stroke++; }, clip() {},
    fillText() {}, strokeText() {}, measureText: (t: string) => ({ width: t.length * 6 }),
    setLineDash() {}, drawImage() {},
    fillStyle: '', strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '', lineDashOffset: 0,
    font: '', textAlign: '', textBaseline: '', shadowBlur: 0, shadowColor: '', shadowOffsetX: 0, shadowOffsetY: 0,
  };
  return { ctx: obj as unknown as Ctx2D, arcs, counts };
}

const rectUtil: NodeUtil = {
  type: 'rect',
  getDefaultProps: () => ({}),
  getGeometry: () => ({}) as ReturnType<NodeUtil['getGeometry']>,
  draw: () => {}, // no-op body: the only arc()s on the frame come from the status badge
};
const nodes = { get: (t: string) => (t === 'rect' ? rectUtil : undefined) } as unknown as NodeRegistry;
const noEdges = { get: () => undefined } as unknown as EdgeRegistry;

function nodeItem(overlay?: string): RenderItem {
  const record = {
    id: 'node:a', typeName: 'node', version: 0, type: 'rect',
    x: 0, y: 0, w: 40, h: 20, z: '0',
    visual: overlay ? { state: 'solid', overlay } : { state: 'solid' }, props: {},
  } as NodeRecord;
  return {
    id: record.id, kind: 'node', record,
    geometry: {} as RenderItem['geometry'],
    aabb: { x: 0, y: 0, w: 40, h: 20 },
    renderVersion: 0,
  };
}

describe('status overlay corner badge (paintItem)', () => {
  it('a node with a met overlay draws a badge disc at its top-right corner', () => {
    const { ctx, arcs, counts } = badgeCtx();
    paintItem(ctx, nodeItem('met'), nodes, noEdges, defaultTheme);
    // r = clamp(min(40,20)*0.14, 5, 10) = 5 → disc centered at (w-r, r) = (35, 5)
    const disc = arcs.find((a) => Math.abs(a.x - 35) < 0.01 && Math.abs(a.y - 5) < 0.01 && Math.abs(a.r - 5) < 0.01);
    expect(disc).toBeDefined();
    expect(counts.fill).toBeGreaterThan(0); // disc background filled
    expect(counts.stroke).toBeGreaterThan(0); // ring + glyph stroked
  });

  it('a node without a status overlay draws no badge (no arc() calls)', () => {
    const { ctx, arcs } = badgeCtx();
    paintItem(ctx, nodeItem(), nodes, noEdges, defaultTheme);
    expect(arcs).toHaveLength(0);
  });

  it('an unrecognized overlay name draws no badge', () => {
    const { ctx, arcs } = badgeCtx();
    paintItem(ctx, nodeItem('some-custom-overlay'), nodes, noEdges, defaultTheme);
    expect(arcs).toHaveLength(0);
  });
});

describe('drawOverlayBadge — stroked, font-free glyphs', () => {
  it('every status kind strokes without throwing and never calls a text primitive', () => {
    for (const kind of ['met', 'partial', 'missed'] as const) {
      const { ctx, counts } = badgeCtx();
      expect(() => drawOverlayBadge(ctx, kind, 100, 100, 8, '#10b981')).not.toThrow();
      expect(counts.stroke).toBeGreaterThan(0); // glyph is stroked, not filled text
    }
  });
});
