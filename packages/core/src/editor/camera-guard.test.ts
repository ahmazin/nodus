/**
 * `setCamera` finite-guard. A single non-finite camera value freezes the whole viewport (grid,
 * ambient, hit-test all depend on a finite camera), and it can arrive from a corrupt content bound,
 * a divide-by-zero fit, or a bad restore. The guard is the one chokepoint that keeps the last good
 * camera instead of poisoning the view. (Surfaced by the fuzz stress-probe: a NaN node coordinate
 * flowed through contentBounds -> zoomToFit -> setCamera and produced camera.z = NaN.)
 */
import { describe, expect, it } from 'vitest';
import { Editor } from '../index.js';

describe('setCamera finite-guard', () => {
  it('rejects a non-finite (or non-positive-zoom) camera and keeps the last good one', () => {
    const ed = new Editor();
    ed.setCamera({ x: 10, y: 20, z: 1.5 });
    expect(ed.camera).toEqual({ x: 10, y: 20, z: 1.5 });

    for (const bad of [
      { x: NaN, y: 0, z: 1 },
      { x: 0, y: Infinity, z: 1 },
      { x: 0, y: 0, z: NaN },
      { x: 0, y: 0, z: 0 }, // z must be a positive scale
      { x: 0, y: 0, z: -2 },
    ]) {
      ed.setCamera(bad);
      expect(ed.camera).toEqual({ x: 10, y: 20, z: 1.5 }); // unchanged — the bad update was dropped
    }

    ed.setCamera({ x: 5, y: 5, z: 2 }); // a valid update still applies
    expect(ed.camera).toEqual({ x: 5, y: 5, z: 2 });
  });

  it('zoomToFit on a scene with a NaN-coordinate node leaves the camera finite', () => {
    const ed = new Editor();
    ed.setCamera({ x: 0, y: 0, z: 1 });
    // A corrupt node with a NaN x makes contentBounds NaN -> fitBox NaN -> setCamera(NaN); the guard
    // must keep the camera finite (and usable) instead of freezing on a NaN.
    ed.createNode({ type: 'rect', x: NaN, y: 0, w: 100, h: 60 });
    ed.zoomToFit();
    expect(Number.isFinite(ed.camera.x)).toBe(true);
    expect(Number.isFinite(ed.camera.y)).toBe(true);
    expect(Number.isFinite(ed.camera.z)).toBe(true);
    expect(ed.camera.z).toBeGreaterThan(0);
  });
});
