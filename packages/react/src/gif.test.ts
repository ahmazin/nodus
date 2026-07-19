import { describe, expect, it } from 'vitest';
// See the note in `gif.ts`: 'gifenc' ships no type declarations, and (in this TS setup) neither
// ambient-declaration form can type it without an error, so the import is deliberately untyped here —
// suppress the one expected diagnostic rather than duplicating gif.ts's local type aliases.
// @ts-expect-error TS7016 — see note above; 'gifenc' has no shipped or `@types/*` declarations.
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

/**
 * `exportFlowGIF` itself needs a browser canvas (2D context + `editor.paintRegion`), so it's exercised
 * by the browser E2E, not here (per CLAUDE.md: no jsdom in this repo's `vitest` environment). What we
 * CAN verify headlessly is the encode path it drives per frame: quantize → applyPalette → writeFrame →
 * finish. This builds synthetic RGBA frames directly (no canvas) and asserts the result is a valid,
 * non-empty GIF — proving the pipeline `exportFlowGIF` uses actually produces a real GIF byte stream.
 */

/** A flat RGBA buffer of `w*h` pixels, all set to `rgba` — a stand-in for a `getImageData().data` grab. */
function solidFrame(w: number, h: number, rgba: readonly [number, number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0];
    data[i + 1] = rgba[1];
    data[i + 2] = rgba[2];
    data[i + 3] = rgba[3];
  }
  return data;
}

describe('gifenc encode pipeline (the path exportFlowGIF drives per frame)', () => {
  it('encodes solid-color frames into a valid, non-empty GIF stream', () => {
    const w = 4;
    const h = 4;
    const frames = [
      solidFrame(w, h, [255, 0, 0, 255]),
      solidFrame(w, h, [0, 255, 0, 255]),
      solidFrame(w, h, [0, 0, 255, 255]),
    ];

    const gif = GIFEncoder();
    const delay = Math.round(1000 / 12);
    for (const frame of frames) {
      // Per-frame palette — mirrors exportFlowGIF, which quantizes each frame independently rather
      // than sharing one palette across the whole animation.
      const palette = quantize(frame, 256);
      const index = applyPalette(frame, palette);
      expect(index).toHaveLength(w * h);
      gif.writeFrame(index, w, h, { palette, delay });
    }
    gif.finish();

    const bytes = gif.bytes() as Uint8Array;
    expect(bytes.length).toBeGreaterThan(0);
    const signature = String.fromCharCode(...Array.from(bytes.slice(0, 6)));
    expect(['GIF89a', 'GIF87a']).toContain(signature);
  });

  it('encodes a single-frame GIF (the frames=1 edge case)', () => {
    const w = 2;
    const h = 2;
    const frame = solidFrame(w, h, [10, 20, 30, 255]);

    const gif = GIFEncoder();
    const palette = quantize(frame, 256);
    const index = applyPalette(frame, palette);
    gif.writeFrame(index, w, h, { palette, delay: 83 });
    gif.finish();

    const bytes = gif.bytes() as Uint8Array;
    expect(bytes.length).toBeGreaterThan(0);
    expect(String.fromCharCode(...Array.from(bytes.slice(0, 6)))).toBe('GIF89a');
  });
});
