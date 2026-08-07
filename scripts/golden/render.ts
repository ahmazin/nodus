/**
 * Shared deterministic render path for golden fixtures.
 *
 * Both generate.ts (writes baselines) and compare.ts (diffs live output) call
 * renderFixture so the two paths can never drift. The output is a PNG buffer
 * plus its device dimensions; callers decode via pngjs so pixelmatch always
 * compares identical color spaces.
 */

import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import type { Ctx2D } from '@nodus-dev/core';
import { InfraCanvas, darkInfraTheme } from '@nodus-dev/preset-infra';
import type { GoldenFixture } from './fixtures';

/** Device pixel ratio baked into every baseline. */
export const DPR = 2;

// Pin a font the headless Skia canvas reliably has, so glyph rasterization is
// stable across runs (matches scripts/render-demo.ts).
let fontsLoaded = false;
function ensureFonts(): void {
  if (fontsLoaded) return;
  (GlobalFonts as { loadSystemFonts?: () => number }).loadSystemFonts?.();
  fontsLoaded = true;
}
const MONO = 'Noto Sans Mono, monospace';

export interface RenderedFixture {
  /** Device width (css * DPR). */
  readonly width: number;
  /** Device height (css * DPR). */
  readonly height: number;
  /** PNG-encoded bytes. Callers decode via pngjs to compare identical colorspaces. */
  readonly png: Buffer;
}

export function renderFixture(fixture: GoldenFixture): RenderedFixture {
  ensureFonts();

  const { w, h } = fixture.viewport;
  const handle = InfraCanvas({ model: fixture.model, viewport: { w, h } });
  const editor = handle.editor;
  editor.setTheme({
    ...darkInfraTheme,
    typography: { ...darkInfraTheme.typography, fontFamily: MONO },
  });
  editor.setViewport(w, h);
  editor.setCamera({ x: fixture.camera.x, y: fixture.camera.y, z: fixture.camera.z });

  if (fixture.select && fixture.select.length > 0) {
    const wanted = new Set(fixture.select);
    const ids = editor.store
      .nodes()
      .filter((n) => wanted.has((n as { props?: { key?: string } }).props?.key ?? ''))
      .map((n) => n.id);
    editor.select(ids);
  }

  const dw = Math.round(w * DPR);
  const dh = Math.round(h * DPR);
  const canvas = createCanvas(dw, dh);
  const ctx = canvas.getContext('2d') as unknown as Ctx2D;
  editor.render(ctx, w, h, DPR, fixture.interactive ?? false);

  const png = canvas.toBuffer('image/png');
  return { width: dw, height: dh, png };
}
