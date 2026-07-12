import { describe, expect, it } from 'vitest';
import { atom, batch, computed, effect, transact } from './index.js';

describe('signals: transactions', () => {
  it('rolls back atom writes when the transaction throws', () => {
    const a = atom(1);
    expect(() =>
      transact(() => {
        a.set(99);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(a.get()).toBe(1);
  });

  it('rollback re-derives computeds that were recomputed mid-transaction (no stale cache)', () => {
    const a = atom(1);
    const b = computed(() => a.get() * 2);
    expect(b.get()).toBe(2);
    try {
      transact(() => {
        a.set(10);
        expect(b.get()).toBe(20); // b caches 20 during the transaction
        throw new Error('x');
      });
    } catch {
      /* expected */
    }
    expect(a.get()).toBe(1);
    expect(b.get()).toBe(2); // NOT the stale 20
  });

  it('rollback does not discard effects scheduled by committed writes outside the transaction', () => {
    const a = atom(0);
    let ran = 0;
    effect(() => {
      a.get();
      ran++;
    });
    expect(ran).toBe(1);
    batch(() => {
      a.set(5); // committed write, schedules the effect
      try {
        transact(() => {
          throw new Error('x'); // rollback must not wipe the pending effect from the outer write
        });
      } catch {
        /* expected */
      }
    });
    expect(a.get()).toBe(5);
    expect(ran).toBe(2); // the committed a.set(5) effect still fired
  });
});

describe('signals: computed disposal', () => {
  it('dispose() unlinks the computed from the atoms that held it', () => {
    const a = atom(1) as unknown as { observers: Set<unknown> };
    const c = computed(() => (a as unknown as { get(): number }).get() + 1);
    expect(c.get()).toBe(2);
    expect(a.observers.size).toBe(1); // the atom retains the computed
    c.dispose();
    expect(a.observers.size).toBe(0); // released
  });
});
