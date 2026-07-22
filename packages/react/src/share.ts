/**
 * Shareable scenes for the Nodus web layer.
 *
 * Encodes the current document into a compact, URL-safe fragment so a plain link reproduces the
 * diagram — no server, no storage. The payload is `editor.toJSON()` (canonical, meta-free) as
 * UTF-8-safe, URL-safe base64, carried in the location hash (`#scene=<...>`). Companion helpers copy
 * the share link or the diagram's SVG to the clipboard and build an `<iframe>` embed snippet.
 *
 * This is a thin binding over the engine's canonical serialization — it reuses `parseSnapshot`
 * (persistence) for decode validation and core's `renderSVG` for the SVG copy. Every browser-only
 * entry point guards `window`/`navigator` so importing the module (or running it under SSR / node
 * tests) never throws.
 */

import { renderSVG, type Editor, type Snapshot } from '@nodus/core';
import { parseSnapshot } from './persistence.js';

// ---------------------------------------------------------------------------
// UTF-8-safe, URL-safe base64
// ---------------------------------------------------------------------------

/**
 * Encode a UTF-8 string to URL-safe base64. `encodeURIComponent`/`unescape` widen the string to a
 * byte string `btoa` accepts (so non-ASCII labels survive), then `+`/`/`/`=` are swapped/stripped for
 * the `-`/`_`, no-padding alphabet that rides cleanly in a URL fragment.
 */
function toBase64Url(text: string): string {
  const b64 = btoa(unescape(encodeURIComponent(text)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * Inverse of {@link toBase64Url}. Restores the standard alphabet + padding, `atob`-decodes, then
 * reverses the UTF-8 widening. Throws (via `atob`/`decodeURIComponent`) on malformed input — callers
 * that must not throw wrap this in try/catch.
 */
function fromBase64Url(encoded: string): string {
  let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = b64.length % 4;
  if (remainder) b64 += '='.repeat(4 - remainder);
  return decodeURIComponent(escape(atob(b64)));
}

// ---------------------------------------------------------------------------
// Encode / decode
// ---------------------------------------------------------------------------

/** Encode a snapshot into a compact, URL-safe string (UTF-8-safe base64 of the JSON). */
export function encodeScene(snapshot: Snapshot): string {
  return toBase64Url(JSON.stringify(snapshot));
}

/**
 * Cap on the encoded `#scene=` fragment length, checked before `fromBase64Url`/`atob` allocates. The
 * hash of a shared link is fully attacker-controlled and loads zero-click on page open, so a crafted
 * multi-megabyte fragment must be rejected before it forces a large decode + main-thread `JSON.parse`
 * (pre-publication audit M2). ~8 MB of base64 ≈ 6 MB decoded — under `parseSnapshot`'s own cap.
 */
export const MAX_SCENE_BYTES = 8_000_000;

/** Inverse of encodeScene. Returns null if the string is malformed, oversized, or not a valid Nodus snapshot. */
export function decodeScene(encoded: string): Snapshot | null {
  if (encoded.length > MAX_SCENE_BYTES) return null; // reject an oversized #scene= before atob/JSON.parse
  try {
    // `parseSnapshot` does the JSON.parse + shape validation and throws on anything that isn't a
    // Nodus document; `fromBase64Url` throws on non-base64. Either failure → null, never a throw.
    return parseSnapshot(fromBase64Url(encoded));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Location / URL helpers
// ---------------------------------------------------------------------------

/** Current page origin + pathname, or empty strings under SSR / node (no `window`). */
function currentLocation(): { origin: string; pathname: string } {
  if (typeof window !== 'undefined' && window.location) {
    return { origin: window.location.origin, pathname: window.location.pathname };
  }
  return { origin: '', pathname: '' };
}

/**
 * Pull the `scene=<...>` value out of a hash, a bare `scene=...` string, or a full URL. Matches the
 * param at the start or after any `#`/`&`/`?` separator, and stops at the next `&`/`#`. Returns null
 * when no `scene` param is present.
 */
function extractSceneParam(hash: string): string | null {
  const m = /(?:^|[#&?])scene=([^&#]*)/.exec(hash);
  return m ? (m[1] ?? null) : null;
}

/** Full share URL: `${origin}${pathname}#scene=<encodeScene(editor.toJSON())>`. */
export function buildShareUrl(editor: Editor, loc?: { origin: string; pathname: string }): string {
  const { origin, pathname } = loc ?? currentLocation();
  return `${origin}${pathname}#scene=${encodeScene(editor.toJSON())}`;
}

/** Parse a location hash/string; if it carries `scene=<...>`, decode + return the Snapshot, else null. */
export function sceneFromHash(hash: string): Snapshot | null {
  const encoded = extractSceneParam(hash);
  return encoded == null ? null : decodeScene(encoded);
}

/** If the current location hash carries a scene, load it into the editor (loadSnapshot, fit). Returns true if it loaded. */
export function loadSceneFromLocation(editor: Editor, loc?: { hash: string }): boolean {
  const hash =
    loc?.hash ?? (typeof window !== 'undefined' && window.location ? window.location.hash : '');
  const snap = sceneFromHash(hash);
  if (!snap) return false;
  editor.loadSnapshot(snap, { fit: true });
  return true;
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

/** Write text via the async clipboard API. Returns false (never throws) when unavailable or denied. */
async function writeText(text: string): Promise<boolean> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.clipboard ||
    typeof navigator.clipboard.writeText !== 'function'
  ) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Copy the share URL to the clipboard. Returns success. */
export function copyShareLink(editor: Editor): Promise<boolean> {
  return writeText(buildShareUrl(editor));
}

/** Copy the diagram's SVG source (text) to the clipboard. Returns success. */
export function copySvg(editor: Editor): Promise<boolean> {
  return writeText(renderSVG(editor));
}

// ---------------------------------------------------------------------------
// Embed
// ---------------------------------------------------------------------------

/** An `<iframe>` embed snippet string wrapping the share URL (default 800×600). */
export function buildEmbedSnippet(editor: Editor, opts: { width?: number; height?: number } = {}): string {
  const width = opts.width ?? 800;
  const height = opts.height ?? 600;
  const url = buildShareUrl(editor);
  return `<iframe src="${url}" width="${width}" height="${height}" style="border:0" loading="lazy"></iframe>`;
}
