/**
 * Store mutation-channel regressions:
 *   - `apply` refuses an `add` onto an already-existing id (no silent overwrite / data loss), and
 *     surfaces the collision via `onError` (`phase: 'duplicate-add'`).
 *   - per-op bulk builds are not O(N²): a single `add` never deep-clones the whole id-set.
 * Each `it` fails on the pre-fix code.
 */
import { describe, expect, it } from 'vitest';
import { Store, type StoreErrorContext } from './index.js';
import type { Change, Id, NodeRecord } from '../model.js';

function mkNode(id: string, extra: Partial<NodeRecord> = {}): NodeRecord {
  return {
    id: id as Id<'node'>,
    typeName: 'node',
    version: 0,
    type: 'rect',
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    z: 'a0',
    visual: { state: 'solid' },
    props: {},
    ...extra,
  };
}

describe("Store.apply — an 'add' onto an existing id is refused, never a silent overwrite", () => {
  it('keeps the live record intact and reports the collision via onError', () => {
    const ctxs: StoreErrorContext[] = [];
    const store = new Store({ onError: (_err, ctx) => ctxs.push(ctx) });
    store.apply([{ op: 'add', record: mkNode('node:dup', { props: { marker: 'ORIGINAL' } }) }]);

    // A regenerated id (module-global makeId collision) would clobber the loaded node pre-fix.
    const info = store.apply([{ op: 'add', record: mkNode('node:dup', { props: { marker: 'REGEN' } }) }]);

    expect((store.peek('node:dup' as Id) as NodeRecord).props.marker).toBe('ORIGINAL'); // not clobbered
    expect(info.changes).toHaveLength(0); // nothing applied
    expect(info.inverse).toHaveLength(0); // ...so nothing enters undo history either
    expect(ctxs).toHaveLength(1);
    const ctx = ctxs[0]!;
    expect(ctx.phase).toBe('duplicate-add');
    expect(ctx.phase === 'duplicate-add' ? ctx.id : null).toBe('node:dup');
  });

  it('still applies the valid changes in a mixed batch, refusing only the duplicate', () => {
    const ctxs: StoreErrorContext[] = [];
    const store = new Store({ onError: (_err, ctx) => ctxs.push(ctx) });
    store.apply([{ op: 'add', record: mkNode('node:a', { props: { marker: 'A' } }) }]);

    const info = store.apply([
      { op: 'add', record: mkNode('node:a', { props: { marker: 'CLOBBER' } }) }, // refused
      { op: 'add', record: mkNode('node:b') }, // applied
    ]);

    expect(store.has('node:b' as Id)).toBe(true);
    expect((store.peek('node:a' as Id) as NodeRecord).props.marker).toBe('A');
    expect(info.changes).toHaveLength(1);
    expect(store.size).toBe(2);
    expect(ctxs).toHaveLength(1);
  });
});

describe('Store.apply — per-op adds do not deep-clone the whole id-set (O(N²) guard)', () => {
  it('a single add on a large store constructs no membership-sized Set', () => {
    const store = new Store();
    const N = 300;
    for (let i = 0; i < N; i++) store.apply([{ op: 'add', record: mkNode(`node:n${i}`) }]);
    expect(store.size).toBe(N);

    // Intercept every `new Set(...)`. Pre-fix, `apply` cloned `new Set(this.idsAtom.peek())` (size N)
    // on each call; the fix mutates a persistent set in place. `store.ids()` is the positive control:
    // it DOES snapshot the whole set, proving the interceptor is genuinely wired.
    const realSet = globalThis.Set;
    let maxSetSize = 0;
    const spy = function (iterable?: Iterable<unknown> | null) {
      const s = new realSet(iterable ?? undefined);
      if (s.size > maxSetSize) maxSetSize = s.size;
      return s;
    } as unknown as SetConstructor;
    (spy as unknown as { prototype: unknown }).prototype = realSet.prototype;

    let afterApply: number;
    let afterIds: number;
    globalThis.Set = spy;
    try {
      store.apply([{ op: 'add', record: mkNode('node:extra') }]);
      afterApply = maxSetSize;
      store.ids(); // positive control: materializing the snapshot clones the full set
      afterIds = maxSetSize;
    } finally {
      globalThis.Set = realSet;
    }

    expect(afterIds).toBeGreaterThanOrEqual(N); // interceptor is live (snapshot cloned the set)
    expect(afterApply).toBeLessThan(N); // the fix: one add clones nothing near the store size
  });

  it('membership and undo integrity survive many per-op adds and a remove', () => {
    const store = new Store();
    for (let i = 0; i < 50; i++) store.apply([{ op: 'add', record: mkNode(`node:m${i}`) }]);
    expect(store.ids().size).toBe(50);

    const info = store.apply([{ op: 'remove', id: 'node:m0' as Id }]);
    expect(store.has('node:m0' as Id)).toBe(false);
    expect(store.ids().size).toBe(49);

    // undo path: applying the computed inverse re-adds the removed record
    store.apply(info.inverse as Change[], { capture: 'never', source: 'program' });
    expect(store.has('node:m0' as Id)).toBe(true);
    expect(store.ids().size).toBe(50);
  });
});
