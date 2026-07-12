/** Copy/download the diagram (or the selection) as a PNG. Renders via the same paint pipeline. */
import { padBox, type Box, type Ctx2D, type Editor } from '@nodus/core';

export interface ImageExportOptions {
  /** Export only the current selection's bounds (default: whole content). */
  selection?: boolean;
  pixelRatio?: number;
  padding?: number;
  background?: boolean;
}

function regionFor(editor: Editor, opts: ImageExportOptions): Box | null {
  const pad = opts.padding ?? 24;
  if (opts.selection && editor.selectedIdsArray().length > 0) {
    const b = editor.selectionBounds();
    return b ? padBox(b, pad) : null;
  }
  const b = editor.sceneIndex.contentBounds();
  return b ? padBox(b, pad) : null;
}

/** Max canvas dimension browsers accept (~Chromium/Firefox); larger throws on construct or getContext. */
const MAX_DIM = 16384;

/** Render the requested region to a PNG Blob (OffscreenCanvas when available, else a DOM canvas).
 * Returns null (never throws) on an empty scene, an unavailable context, or any allocation failure, so
 * the copy/download callers can honor their documented "returns false if unsupported" contract. */
export async function renderPngBlob(editor: Editor, opts: ImageExportOptions = {}): Promise<Blob | null> {
  const region = regionFor(editor, opts);
  if (!region) return null;
  // Clamp so neither dimension exceeds the browser cap — downscale the effective ratio rather than
  // throwing a RangeError on a huge diagram. A slightly smaller export beats a rejected promise.
  const wanted = opts.pixelRatio ?? 2;
  const fit = Math.min(1, MAX_DIM / Math.max(1, region.w * wanted), MAX_DIM / Math.max(1, region.h * wanted));
  const ratio = wanted * fit;
  const w = Math.min(MAX_DIM, Math.max(1, Math.ceil(region.w * ratio)));
  const h = Math.min(MAX_DIM, Math.max(1, Math.ceil(region.h * ratio)));

  try {
    let canvas: HTMLCanvasElement | OffscreenCanvas;
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(w, h);
    } else {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      canvas = c;
    }
    const raw = canvas.getContext('2d');
    if (!raw) return null;
    editor.paintRegion(raw as unknown as Ctx2D, region, ratio, { background: opts.background ?? true });

    if ('convertToBlob' in canvas) {
      return await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' });
    }
    return await new Promise<Blob | null>((resolve) =>
      (canvas as HTMLCanvasElement).toBlob((b) => resolve(b), 'image/png'),
    );
  } catch {
    return null;
  }
}

/** Copy the diagram/selection to the system clipboard as an image. Returns false if unsupported/denied. */
export async function copyImage(editor: Editor, opts: ImageExportOptions = {}): Promise<boolean> {
  const blob = await renderPngBlob(editor, opts);
  if (!blob) return false;
  try {
    // ClipboardItem support varies (Firefox gained image write later than Chromium); user gesture required.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

/** Download the diagram/selection as a PNG file. */
export async function downloadImage(editor: Editor, filename = 'diagram.png', opts: ImageExportOptions = {}): Promise<boolean> {
  const blob = await renderPngBlob(editor, opts);
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
