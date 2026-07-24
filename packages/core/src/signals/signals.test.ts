import { afterEach, describe, expect, it, vi } from 'vitest';
import { atom, batch, computed, effect, setEffectErrorHandler, transact } from './index.js';
import { Store } from '../store/index.js';
import type { Change, Id, NodeRecord } from '../model.js';

function mkNode(id: string): NodeRecord {
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
  };
}

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

describe('signals: effect-error isolation (F16)', () => {
  // Every test installs its own handler; restore the deduped-console default between tests so a
  // leftover handler (or a failed assertion skipping cleanup) never leaks into a sibling.
  afterEach(() => setEffectErrorHandler(null));

  it('a throwing effect does not strand a later pending effect in the same flush', () => {
    const seen: unknown[] = [];
    setEffectErrorHandler((err) => seen.push(err));
    const a = atom(0);
    let firstA = true;
    let bRuns = 0;
    // Both effects depend on `a`; the first (scheduled first) throws on re-run. The second must
    // still run — a broken consumer cannot dequeue-and-drop its siblings.
    effect(() => {
      a.get();
      if (firstA) {
        firstA = false;
        return;
      }
      throw new Error('A boom');
    });
    effect(() => {
      a.get();
      bRuns++;
    });
    expect(bRuns).toBe(1); // B's initial run
    a.set(1); // schedules A then B into one flush; A throws, B must still run
    expect(bRuns).toBe(2); // B was not stranded
    expect(seen).toHaveLength(1); // A's error was routed, not propagated
  });

  it('an effect that throws during a transact() commit flush does not disable a LATER rollback', () => {
    setEffectErrorHandler(() => {}); // isolate the commit-flush throw quietly
    const trigger = atom(0);
    let first = true;
    effect(() => {
      trigger.get();
      if (first) {
        first = false;
        return; // initial run must not throw (it runs outside a flush)
      }
      throw new Error('effect boom during commit flush');
    });

    // A committing transaction whose commit-path flush runs the now-throwing effect. Pre-fix this
    // corrupts txDepth to -1 and nulls txBackups; the try lets the test reach the decisive assertion.
    try {
      transact(() => trigger.set(1));
    } catch {
      /* pre-fix: the commit-flush throw re-entered the rollback catch and threw a TypeError */
    }

    // THE F16 ASSERTION: a completely unrelated later transaction must still roll back. Pre-fix,
    // txDepth === -1 means `outer` is false, txBackups is never created, and this rollback is dead.
    const guarded = atom('before');
    expect(() =>
      transact(() => {
        guarded.set('after');
        throw new Error('rollback me');
      }),
    ).toThrow('rollback me');
    expect(guarded.get()).toBe('before'); // rollback still works — the session was not corrupted
  });

  it('routes to the installed handler; null restores the deduped-console default', () => {
    const seen: unknown[] = [];
    setEffectErrorHandler((err) => seen.push(err));
    const a = atom(0);
    let first = true;
    const boom = new Error('handler target');
    effect(() => {
      a.get();
      if (first) {
        first = false;
        return;
      }
      throw boom;
    });

    a.set(1);
    expect(seen).toEqual([boom]); // the custom handler received the exact thrown value

    setEffectErrorHandler(null); // restore the built-in default
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      a.set(2); // effect throws again — now routed to the default console.error sink
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
    expect(seen).toHaveLength(1); // the removed handler no longer receives after null
  });

  it('store.apply survives a throwing consumer effect with atoms left consistent', () => {
    setEffectErrorHandler(() => {}); // the consumer throw is isolated inside apply's commit flush
    const store = new Store();
    const nodeId = 'node:consumer' as Id;
    store.apply([{ op: 'add', record: mkNode('node:consumer') }] as Change[]);

    let first = true;
    effect(() => {
      store.get(nodeId); // subscribe to the record atom
      if (first) {
        first = false;
        return;
      }
      throw new Error('consumer boom');
    });

    // The update's internal transact commits, then its flush runs the now-throwing consumer effect.
    // Pre-fix that throw corrupts transact and re-throws out of apply; post-fix it is isolated.
    expect(() => store.apply([{ op: 'update', id: nodeId, patch: { x: 42 } }])).not.toThrow();
    expect((store.peek(nodeId) as NodeRecord).x).toBe(42); // the write committed and is readable

    // And the session is not corrupted: an independent signals transaction still rolls back.
    const guarded = atom('before');
    expect(() =>
      transact(() => {
        guarded.set('after');
        throw new Error('x');
      }),
    ).toThrow('x');
    expect(guarded.get()).toBe('before');
  });
});
