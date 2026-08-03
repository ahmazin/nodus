/**
 * The two content shapes this package ships and (de)serializes.
 *
 * A **stencil** is a reusable *fragment* — a small group of records (usually with its origin near
 * `(0,0)`) that a user drops onto the canvas as a unit: a labeled box, a note, a decision shape.
 * A **template** is a whole *starting diagram* — a complete {@link Snapshot} you open as a new
 * document: a blank canvas, a 3-tier web app, a CI/CD pipeline.
 *
 * Both are plain, id-referenced POJOs made of `@nodus-dev/core` records, so they round-trip through the
 * engine's canonical serializer and are diff-friendly on disk.
 */

import type { NodusRecord, Snapshot } from '@nodus-dev/core';

/** A reusable element-group fragment. `records` are engine records with ids unique within the fragment. */
export interface Stencil {
  /** Stable identifier, unique within its {@link StencilLibrary}. */
  id: string;
  /** Human-readable name shown in a palette. */
  name: string;
  /** Optional free-form tags for filtering/search. */
  tags?: string[];
  /** The fragment's records; convention is to place its origin near `(0, 0)`. */
  records: NodusRecord[];
  /** Optional preview (e.g. a data-URI thumbnail); the engine never interprets it. */
  preview?: string;
}

/** A named collection of stencils — the unit that {@link serializeLibrary}/{@link parseLibrary} persist. */
export interface StencilLibrary {
  name: string;
  stencils: Stencil[];
}

/** A complete starting diagram, opened as a fresh document from its {@link Snapshot}. */
export interface Template {
  id: string;
  name: string;
  description?: string;
  /** The full document snapshot this template expands to. */
  snapshot: Snapshot;
  /** Optional preview (e.g. a data-URI thumbnail); the engine never interprets it. */
  preview?: string;
}
