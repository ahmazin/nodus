/**
 * Pure helpers for the lossless text <-> canvas round-trip Source editor.
 *
 * These wrap the engine's canonical serialization (`editor.toJSON()` / `loadSnapshot()` and
 * `toCanonicalString`) into the small, DOM-free vocabulary the `CodePanel` component stands on:
 *   - `editorToSource`     — pretty, human-editable JSON text of the current document.
 *   - `editorToCanonical`  — the canonical (order-insensitive, minimal-diff) fixed point.
 *   - `canonicalOf`        — the same fixed point for an arbitrary parsed `Snapshot`.
 *   - `parseSource`        — a never-throwing parse that reports line/column on failure.
 *   - `sourceMatchesEditor`— whether some text and the live editor denote the same document.
 *   - `applySource`        — load a parsed snapshot back onto the canvas (camera preserved).
 *
 * Everything here is pure and unit-tested in `round-trip.test.ts` (node env, no DOM).
 */

import { toCanonicalString, type Editor, type Snapshot } from '@nodus-dev/core';
import { parseSnapshot } from './persistence.js';

/**
 * Serialize the editor's current document to pretty (2-space) JSON — the text the user edits.
 * No `meta.updated` stamp is written, so the text is a stable function of document content (a
 * no-op edit re-serializes byte-for-byte, which keeps the panel's sync state machine quiet).
 */
export function editorToSource(editor: Editor): string {
  return JSON.stringify(editor.toJSON(), null, 2);
}

/** The editor's document in canonical form — the order-insensitive fixed point used for equality. */
export function editorToCanonical(editor: Editor): string {
  return toCanonicalString(editor.toJSON());
}

/** Canonical form of an already-parsed snapshot (same fixed point as `editorToCanonical`). */
export function canonicalOf(snapshot: Snapshot): string {
  return toCanonicalString(snapshot);
}

/** Result of parsing editable source text — either a valid snapshot or a located error. */
export type SourceParse =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; message: string; line: number | null; column: number | null };

/** Count `\n` up to `position` (clamped) to derive a 1-based line/column for an error marker. */
function lineColAt(text: string, position: number): { line: number; column: number } {
  const end = Math.max(0, Math.min(position, text.length));
  let line = 1;
  let column = 1;
  for (let i = 0; i < end; i++) {
    if (text[i] === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

/**
 * Best-effort extraction of a 1-based line & column from a JSON `SyntaxError` message, given the
 * source text it was parsing. `JSON.parse` messages vary across engines; we try, in order:
 *   1. an explicit `line L column C` (modern V8/Node),
 *   2. an `at position N` char offset, converted against `text`,
 *   3. otherwise `null` (e.g. a structural — non-JSON — validation error carries no position).
 */
function locateJsonError(text: string, message: string): { line: number | null; column: number | null } {
  const lc = /line (\d+) column (\d+)/i.exec(message);
  if (lc && lc[1] && lc[2]) {
    return { line: Number.parseInt(lc[1], 10), column: Number.parseInt(lc[2], 10) };
  }
  const pos = /position (\d+)/i.exec(message);
  if (pos && pos[1]) {
    const { line, column } = lineColAt(text, Number.parseInt(pos[1], 10));
    return { line, column };
  }
  return { line: null, column: null };
}

/**
 * Parse editable source text into a `Snapshot`, never throwing. On failure (malformed JSON or a
 * structurally-invalid Nodus document, both surfaced by `parseSnapshot`) returns `ok: false` with
 * the error message and, when derivable, the 1-based line/column of the problem.
 */
export function parseSource(text: string): SourceParse {
  try {
    return { ok: true, snapshot: parseSnapshot(text) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const { line, column } = locateJsonError(text, message);
    return { ok: false, message, line, column };
  }
}

/**
 * True when `text` parses and denotes the same document as the live editor — i.e. the panel is in
 * sync. Unparseable text is never a match.
 */
export function sourceMatchesEditor(text: string, editor: Editor): boolean {
  const parsed = parseSource(text);
  if (!parsed.ok) return false;
  return canonicalOf(parsed.snapshot) === editorToCanonical(editor);
}

/**
 * Load a parsed snapshot back onto the canvas. Deliberately calls `loadSnapshot` WITHOUT a `fit`
 * option so the user's current camera (pan/zoom) is preserved across a text-driven rebuild.
 */
export function applySource(editor: Editor, snapshot: Snapshot): void {
  editor.loadSnapshot(snapshot);
}
