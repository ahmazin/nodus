/**
 * Canonical (de)serialization for a {@link StencilLibrary}. Serialization routes through the engine's
 * `stableStringify`, so a library's on-disk bytes are deterministic (sorted keys, no `undefined`) and
 * diff-stable — the same "diagrams you can code-review" contract the core uses for `*.nodus.json`.
 *
 * Parsing is defensive: it rejects only input that isn't a stencil library at all (invalid JSON, or a
 * top level missing `name`/`stencils`), and otherwise *drops* individual malformed stencils rather than
 * failing the whole load — a single hand-corrupted entry never takes the rest of the library down.
 */

import { stableStringify } from '@ahmazin/core';
import type { Stencil, StencilLibrary } from './types.js';

/** Serialize a library to canonical JSON text (sorted keys, trailing newline). Byte-stable per input. */
export function serializeLibrary(lib: StencilLibrary): string {
  return stableStringify(lib) + '\n';
}

/**
 * Parse canonical (or any) JSON back into a {@link StencilLibrary}.
 *
 * Throws only when the input isn't a stencil library: invalid JSON, or a top level without a string
 * `name` and an array `stencils`. Individual stencils that lack a string `id`/`name` or an array
 * `records` are silently dropped, keeping every valid stencil.
 */
export function parseLibrary(json: string): StencilLibrary {
  const parsed: unknown = JSON.parse(json); // throws on totally invalid JSON — intended
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('parseLibrary: expected a JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.name !== 'string' || !Array.isArray(obj.stencils)) {
    throw new Error('parseLibrary: not a stencil library (need string "name" and array "stencils")');
  }
  const stencils = obj.stencils.filter(isValidStencil);
  return { name: obj.name, stencils };
}

/** A stencil is kept iff it has a string `id`, a string `name`, and an array `records`. */
function isValidStencil(s: unknown): s is Stencil {
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.name === 'string' && Array.isArray(o.records);
}
