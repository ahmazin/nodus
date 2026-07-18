/** Copy/download the diagram (or the selection) as a PNG. Renders via the same paint pipeline. */
import { padBox, type Box, type Ctx2D, type Editor, type Vec2 } from '@nodus/core';
import { showToast } from './toast.js';

// ============================================================================
// System-clipboard PASTE (image / plain text → a node)
// ============================================================================

export interface SystemPasteOptions {
  /** Node type used for a pasted image (e.g. `'diagram.image'`). Omit to ignore clipboard images. */
  imageNodeType?: string;
  /** Node type used for pasted plain text (its `label`). Omit to ignore clipboard text. */
  textNodeType?: string;
}

/** World point at the center of the current viewport — where pasted content is dropped. */
function viewportCenterWorld(editor: Editor): Vec2 {
  const vp = editor.viewportAtom.peek();
  return editor.screenToWorld({ x: vp.w / 2, y: vp.h / 2 });
}

/** Create a node of `type` centered on `(c)`, sized by its `getDefaultSize`. Returns the new id. */
function createCentered(
  editor: Editor,
  type: string,
  c: Vec2,
  props: Record<string, unknown>,
  label?: string,
): void {
  const size = editor.nodes.get(type)?.getDefaultSize?.(props) ?? { w: 160, h: 40 };
  const id = editor.createNode({ type, x: c.x - size.w / 2, y: c.y - size.h / 2, props, label });
  editor.select([id]);
}

/** Decode an image `File` to a data-URI, read its natural size, and drop an image node centered on
 *  the viewport. Browser-only (uses `Image`/`FileReader`); on any decode/read failure it does nothing
 *  rather than inserting a broken node. */
function insertImageFile(editor: Editor, file: File, imageNodeType: string): void {
  const reader = new FileReader();
  reader.onload = () => {
    const src = typeof reader.result === 'string' ? reader.result : '';
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      const naturalWidth = img.naturalWidth || 1;
      const naturalHeight = img.naturalHeight || 1;
      createCentered(editor, imageNodeType, viewportCenterWorld(editor), { src, naturalWidth, naturalHeight });
    };
    img.onerror = () => { /* undecodable clipboard image — ignore */ };
    img.src = src;
  };
  reader.onerror = () => { /* unreadable clipboard file — ignore */ };
  reader.readAsDataURL(file);
}

/**
 * Handle a system paste's `DataTransfer`: insert a clipboard image as an image node (when
 * `imageNodeType` is set), else plain text as a text node (when `textNodeType` is set), centered on
 * the viewport and selected. Returns true if it consumed the paste (the caller should
 * `preventDefault`). Image insertion is async (decode); the return value only reflects that an image
 * WILL be inserted.
 */
export function pasteFromSystem(editor: Editor, data: DataTransfer | null, opts: SystemPasteOptions): boolean {
  if (!data) return false;
  if (opts.imageNodeType) {
    for (const item of Array.from(data.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          insertImageFile(editor, file, opts.imageNodeType);
          return true;
        }
      }
    }
  }
  if (opts.textNodeType) {
    const text = data.getData('text/plain');
    if (text.trim()) {
      createCentered(editor, opts.textNodeType, viewportCenterWorld(editor), {}, text);
      return true;
    }
  }
  return false;
}

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

/** Whether this browser can put an image on the clipboard at all. Firefox only shipped
 *  `ClipboardItem` + async `clipboard.write` on by default in 127 (mid-2024); Safari needs a secure
 *  context. When this is false, callers should fall back to a download rather than fail silently. */
export function canCopyImage(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.clipboard &&
    typeof navigator.clipboard.write === 'function' &&
    typeof ClipboardItem !== 'undefined' &&
    typeof window !== 'undefined' &&
    window.isSecureContext
  );
}

/** Copy the diagram/selection to the system clipboard as an image. Returns false if unsupported/denied. */
export async function copyImage(editor: Editor, opts: ImageExportOptions = {}): Promise<boolean> {
  if (!canCopyImage()) return false;
  try {
    // Call clipboard.write() SYNCHRONOUSLY within the user gesture, handing ClipboardItem a *promise*
    // for the blob rather than an already-awaited value. Awaiting the render first and then writing
    // drops the transient user activation in Safari and older Firefox → NotAllowedError; the promise
    // form keeps the gesture alive while the PNG renders. Rejects (→ caught) on an empty diagram.
    const blob = renderPngBlob(editor, opts).then((b) => {
      if (!b) throw new Error('empty diagram');
      return b;
    });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

export type ExportMethod = 'clipboard' | 'download' | 'none';
export interface ExportResult {
  ok: boolean;
  method: ExportMethod;
}

/** The "do the right thing" export used by UI controls: copy to the clipboard when the browser
 *  supports it, otherwise (or when the write is blocked/denied) save a PNG — so the user ALWAYS gets
 *  their image instead of a silent no-op. Shows a one-line toast reporting what happened. */
export async function copyOrDownloadImage(editor: Editor, opts: ImageExportOptions = {}): Promise<ExportResult> {
  if (canCopyImage() && (await copyImage(editor, opts))) {
    showToast('Copied image to clipboard');
    return { ok: true, method: 'clipboard' };
  }
  // Clipboard unavailable or blocked → fall back to a file so the action isn't a dead end.
  if (await downloadImage(editor, 'diagram.png', opts)) {
    showToast(canCopyImage() ? 'Clipboard blocked — saved PNG instead' : 'Saved PNG (clipboard unavailable)');
    return { ok: true, method: 'download' };
  }
  showToast('Nothing to export — the diagram is empty', 'error');
  return { ok: false, method: 'none' };
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
