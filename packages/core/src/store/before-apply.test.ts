/**
 * Before-apply interception (task A3). Interceptors run as a registration-order fold at the top of
 * `apply()`, BEFORE the transaction, so the inverse is computed from the final change set. A `null`
 * vetoes; `void` passes through; a transform replaces; a throw is isolated + reported; a reentrant
 * apply throws; `intercept:false` (undo/redo/remote) bypasses the pipeline. Each `it` fails pre-change.
 */
import { describe, expect, it } from 'vitest';
import { Store, type StoreErrorContext } from './index.js';
import { Editor } from '../editor/index.js';
import { isNodusError, type NodusError } from '../errors/index.js';
import type { Change, Id, NodeRecord } from '../model.js';

function mkNode(id: string, x = 0): NodeRecord {
  return {
    id: id as Id<'node'>,
    typeName: 'node',
    version: 0,
    type: 'rect',
    x,
    y: 0,
    w: 10,
    h: 10,
    z: 'a0',
    visual: { state: 'solid' },
    props: {},
  };
}

describe('Store.apply — before-apply interception', () => {
  it('a veto (null) commits nothing and notifies no listener', () => {
    const store = new Store();
    const notified: unknown[] = [];
    store.listen((info) => notified.push(info));
    store.registerBeforeApply(() => null);
    const info = store.apply([{ op: 'add', record: mkNode('node:a') }]);
    expect(store.has('node:a' as Id)).toBe(false); // nothing committed
    expect(info.changes).toHaveLength(0);
    expect(notified).toHaveLength(0); // no listener notification for a vetoed apply
  });

  it('a transform clamps the committed record AND the inverse restores the ORIGINAL value', () => {
    const store = new Store();
    store.apply([{ op: 'add', record: mkNode('node:a', 5) }]); // x = 5
    store.registerBeforeApply((changes) =>
      changes.map((c) =>
        c.op === 'update' && typeof c.patch.x === 'number'
          ? { ...c, patch: { ...c.patch, x: Math.min(100, c.patch.x) } }
          : c,
      ),
    );
    const info = store.apply([{ op: 'update', id: 'node:a' as Id, patch: { x: 9999 } }]);
    expect((store.peek('node:a' as Id) as NodeRecord).x).toBe(100); // clamped by the interceptor
    // inverse restores the ORIGINAL pre-apply value (5), computed from the FINAL change set — not 9999
    expect(info.inverse).toEqual([{ op: 'update', id: 'node:a', patch: { x: 5 } }]);
  });

  it('an interceptor can append a change', () => {
    const store = new Store();
    store.registerBeforeApply((changes) => [...changes, { op: 'add', record: mkNode('node:b') }]);
    store.apply([{ op: 'add', record: mkNode('node:a') }]);
    expect(store.has('node:a' as Id)).toBe(true);
    expect(store.has('node:b' as Id)).toBe(true); // appended by the interceptor
  });

  it('interceptors fold in registration order (each sees the prior output)', () => {
    const store = new Store();
    const seen: string[][] = [];
    const ids = (cs: readonly Change[]): string[] => cs.map((c) => (c.op === 'add' ? c.record.id : c.op));
    store.registerBeforeApply((changes) => {
      seen.push(ids(changes));
      return [...changes, { op: 'add', record: mkNode('node:x') }];
    });
    store.registerBeforeApply((changes) => {
      seen.push(ids(changes)); // sees the FIRST interceptor's appended node:x
      return undefined; // passthrough
    });
    store.apply([{ op: 'add', record: mkNode('node:a') }]);
    expect(seen[0]).toEqual(['node:a']);
    expect(seen[1]).toEqual(['node:a', 'node:x']);
  });

  it('a reentrant apply from inside an interceptor throws NodusError("reentrant-apply")', () => {
    const store = new Store();
    let err: unknown;
    store.registerBeforeApply(() => {
      try {
        store.apply([{ op: 'add', record: mkNode('node:z') }]);
      } catch (e) {
        err = e; // caught here so the outer apply still passes through
      }
    });
    store.apply([{ op: 'add', record: mkNode('node:a') }]);
    expect(isNodusError(err)).toBe(true);
    expect((err as NodusError).code).toBe('reentrant-apply');
    expect(store.has('node:z' as Id)).toBe(false); // the reentrant add never committed
  });

  it('a throwing interceptor is isolated (passthrough) and reported with phase before-apply', () => {
    const ctxs: StoreErrorContext[] = [];
    const store = new Store({ onError: (_e, ctx) => ctxs.push(ctx) });
    store.registerBeforeApply(() => {
      throw new Error('interceptor boom');
    });
    const info = store.apply([{ op: 'add', record: mkNode('node:a') }]);
    expect(store.has('node:a' as Id)).toBe(true); // apply NOT aborted — the throw is passthrough
    expect(info.changes).toHaveLength(1);
    expect(ctxs.map((c) => c.phase)).toContain('before-apply');
  });

  it('intercept:false bypasses the pipeline entirely', () => {
    const store = new Store();
    let ran = 0;
    store.registerBeforeApply(() => {
      ran++;
      return null; // would veto if it ran
    });
    store.apply([{ op: 'add', record: mkNode('node:a') }], { intercept: false });
    expect(store.has('node:a' as Id)).toBe(true); // committed despite the veto interceptor
    expect(ran).toBe(0); // the interceptor never ran
  });

  it('undo replay bypasses interception (Editor history passes intercept:false)', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 5, y: 0 });
    ed.onBeforeChange(() => null); // a veto that must NOT block undo's recorded-inverse replay
    ed.undo();
    expect(ed.store.has(a)).toBe(false); // the node was removed — undo bypassed the veto
  });
});
