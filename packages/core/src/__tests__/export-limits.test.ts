import { describe, expect, it, vi } from 'vitest';
import { Editor, MAX_EXPORT_PIXELS, isNodusError, renderSVG, type CreateCanvas } from '../index.js';

/**
 * Export raster cap (PRR P2). `toPNG`/`renderSVG`/`paintRegion` must refuse an export whose raster
 * would exceed MAX_EXPORT_PIXELS, throwing a catchable NodusError('export-too-large') BEFORE allocating
 * — mirrors the flow.count DoS guard. A node parked at extreme coordinates is the attack shape.
 */
describe('MAX_EXPORT_PIXELS', () => {
  it('is exported as a finite positive number (256 MP)', () => {
    expect(Number.isFinite(MAX_EXPORT_PIXELS)).toBe(true);
    expect(MAX_EXPORT_PIXELS).toBe(268_435_456);
  });

  it('toPNG throws export-too-large and never invokes the canvas factory when the raster is too large', async () => {
    const ed = new Editor();
    ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const create = vi.fn(() => {
      throw new Error('factory must not be called past the cap');
    });
    // 200_000 × 200_000 at ratio 2 → 4×10^11 px ≫ MAX_EXPORT_PIXELS.
    let thrown: unknown;
    try {
      await ed.toPNG(create as unknown as CreateCanvas, {
        bounds: { x: 0, y: 0, w: 200_000, h: 200_000 },
        padding: 0,
        pixelRatio: 2,
      });
    } catch (e) {
      thrown = e;
    }
    expect(isNodusError(thrown) && thrown.code === 'export-too-large').toBe(true);
    expect(create).not.toHaveBeenCalled();
  });

  it('renderSVG (the shared paintRegion pipeline) throws export-too-large for an oversized region', () => {
    const ed = new Editor();
    ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
    // SVG export drives paintRegion at ratio 1; 20_000 × 20_000 = 4×10^8 > MAX_EXPORT_PIXELS.
    let thrown: unknown;
    try {
      renderSVG(ed, { bounds: { x: 0, y: 0, w: 20_000, h: 20_000 }, padding: 0 });
    } catch (e) {
      thrown = e;
    }
    expect(isNodusError(thrown) && thrown.code === 'export-too-large').toBe(true);
  });

  it('an ordinary-size export is NOT blocked by the cap', () => {
    const ed = new Editor();
    ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const svg = renderSVG(ed); // small default region, well under the cap
    expect(svg).toContain('<svg');
  });
});
