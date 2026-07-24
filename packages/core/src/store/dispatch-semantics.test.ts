/**
 * Written dispatch semantics + editor.transaction + ambient-transact refusal (task A14): a raw
 * store.apply nested in a signals transact() is refused; editor.transaction groups edits into one undo
 * entry; a throwing onError sink can't make apply() throw post-commit; ChangeInfo arrays are frozen in
 * dev; a reentrant apply from a listener dispatches its own notification. Each `it` fails pre-change.
 */
import { describe, expect, it } from 'vitest';
import { transact } from '../signals/index.js';
import { Store } from './index.js';
import { Editor } from '../editor/index.js';
import { isNodusError, type NodusError } from '../errors/index.js';
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

describe('A14 — ambient-transact refusal', () => {
  it('store.apply inside a raw transact() throws NodusError("apply-in-transaction")', () => {
    const store = new Store();
    let err: unknown;
    transact(() => {
      try {
        store.apply([{ op: 'add', record: mkNode('node:a') }]);
      } catch (e) {
        err = e;
      }
    });
    expect(isNodusError(err)).toBe(true);
    expect((err as NodusError).code).toBe('apply-in-transaction');
    expect(store.has('node:a' as Id)).toBe(false); // nothing committed
  });

  it('an intercept:false apply (undo/redo/remote replay) is exempt inside a transact()', () => {
    const store = new Store();
    transact(() => {
      store.apply([{ op: 'add', record: mkNode('node:a') }], { intercept: false });
    });
    expect(store.has('node:a' as Id)).toBe(true);
  });
});

describe('A14 — editor.transaction grouping', () => {
  it('groups N edits into ONE undo entry', () => {
    const ed = new Editor();
    ed.transaction(() => {
      ed.createNode({ type: 'rect', x: 0, y: 0 });
      ed.createNode({ type: 'rect', x: 100, y: 0 });
      ed.createNode({ type: 'rect', x: 200, y: 0 });
    });
    expect(ed.store.nodes()).toHaveLength(3);
    ed.undo(); // a single undo reverts all three
    expect(ed.store.nodes()).toHaveLength(0);
    expect(ed.canUndo()).toBe(false);
  });

  it('nested transaction() still yields one undo entry (only the outermost marks)', () => {
    const ed = new Editor();
    ed.transaction(() => {
      ed.createNode({ type: 'rect', x: 0, y: 0 });
      ed.transaction(() => ed.createNode({ type: 'rect', x: 100, y: 0 }));
      ed.createNode({ type: 'rect', x: 200, y: 0 });
    });
    expect(ed.store.nodes()).toHaveLength(3);
    ed.undo();
    expect(ed.store.nodes()).toHaveLength(0);
  });
});

describe('A14 — dispatch robustness', () => {
  it('a throwing onError sink does not make apply() throw post-commit', () => {
    const store = new Store({
      onError: () => {
        throw new Error('onError boom');
      },
    });
    store.listen(() => {
      throw new Error('listener boom'); // routes to the (throwing) onError sink
    });
    expect(() => store.apply([{ op: 'add', record: mkNode('node:a') }])).not.toThrow();
    expect(store.has('node:a' as Id)).toBe(true); // committed despite both throwing
  });

  it('dev-frozen ChangeInfo arrays reject mutation', () => {
    const store = new Store();
    let threw = false;
    store.listen((info) => {
      try {
        (info.changes as Change[]).push({ op: 'remove', id: 'node:x' as Id });
      } catch {
        threw = true;
      }
    });
    store.apply([{ op: 'add', record: mkNode('node:a') }]);
    expect(threw).toBe(true); // frozen in dev (NODE_ENV !== production)
  });

  it('a reentrant apply from a listener dispatches its own notification', () => {
    const store = new Store();
    const seen: string[] = [];
    let reentered = false;
    store.listen((info) => {
      for (const c of info.changes) if (c.op === 'add') seen.push(c.record.id);
      if (!reentered && info.changes.some((c) => c.op === 'add' && c.record.id === 'node:a')) {
        reentered = true;
        store.apply([{ op: 'add', record: mkNode('node:b') }]); // nested apply dispatches synchronously
      }
    });
    store.apply([{ op: 'add', record: mkNode('node:a') }]);
    expect(seen).toEqual(['node:a', 'node:b']); // both notifications delivered
    expect(store.has('node:b' as Id)).toBe(true);
  });
});
