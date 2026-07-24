/**
 * Instance-scoped id generation. A `Editor` owns an {@link IdFactory}, so two editors in one process
 * mint DISJOINT ids for the same creation sequence — replacing the old module-global counter that
 * two editors would silently share (and collide over on cross-context save/load).
 */

import { makeId, seedIdCounter } from '../model.js';
import type { Id } from '../model.js';

export interface IdFactory {
  /** Mint a fresh id for `typeName`. A `seed` (paste/stencil) passes through verbatim as the suffix. */
  make<T extends string>(typeName: T, seed?: string): Id<T>;
  /** Advance this factory's counter past every id in `ids` it could otherwise regenerate — called on
   *  load so an id minted afterward can't collide with a loaded record. */
  seed(ids: Iterable<string>): void;
}

const PREFIX_LEN = 4;
const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomPrefix(): string {
  let s = '';
  for (let i = 0; i < PREFIX_LEN; i++) s += B36[Math.floor(Math.random() * 36)];
  return s;
}

/**
 * The default per-instance factory. Each instance carries its OWN counter and a random 4-char prefix,
 * so ids read `<typeName>:<prefix>-<counter b36>` (e.g. `node:q7k3-5`). Two factories mint disjoint
 * ids for the same sequence (different prefixes), and {@link IdFactory.seed} advances past any loaded
 * id that shares this factory's prefix (the only ids it could otherwise regenerate).
 */
export function sessionIdFactory(): IdFactory {
  const prefix = randomPrefix();
  const marker = `${prefix}-`;
  let counter = 0;
  return {
    make<T extends string>(typeName: T, seed?: string): Id<T> {
      if (seed !== undefined) return `${typeName}:${seed}` as Id<T>;
      return `${typeName}:${prefix}-${(counter++).toString(36)}` as Id<T>;
    },
    seed(ids: Iterable<string>): void {
      for (const id of ids) {
        const suffix = id.slice(id.indexOf(':') + 1);
        if (!suffix.startsWith(marker)) continue; // a different prefix can never collide with ours
        const n = Number.parseInt(suffix.slice(marker.length), 36);
        if (Number.isSafeInteger(n) && n >= counter) counter = n + 1;
      }
    },
  };
}

/**
 * A legacy-byte-compatible factory: identical output to the historical module-global `makeId`
 * (`<typeName>:<counter b36>x<hash b36>`), with `seed()` advancing that shared counter. Use it where
 * ids must reproduce exactly — golden byte fixtures, deterministic snapshots.
 *
 * Note: because it delegates to the process-global counter, two `deterministicIdFactory()` instances
 * (unlike {@link sessionIdFactory}) DO share state. That is the point — determinism over isolation.
 */
export function deterministicIdFactory(): IdFactory {
  return { make: makeId, seed: seedIdCounter };
}
