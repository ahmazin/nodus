/**
 * Change feed for sync (task A7): store.onReset fires on load; the editor emits document:load after
 * the scene rebuild; applyRemote applies with source:'remote' (no undo history, interception bypassed).
 * Each `it` fails on the pre-change engine (no reset feed / no document:load / no applyRemote).
 */
import { describe, expect, it } from 'vitest';
import { Editor } from './index.js';
import { Store } from '../store/index.js';
import type { Change, Id, NodeRecord, NodusRecord } from '../model.js';

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

describe('A7 — store reset feed + document:load', () => {
  it('store.onReset fires on load with the loaded records', () => {
    const store = new Store();
    const seen: NodusRecord[][] = [];
    store.onReset((info) => seen.push(info.records));
    store.load([mkNode('node:a'), mkNode('node:b')]);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.map((r) => r.id)).toEqual(['node:a', 'node:b']);
  });

  it('the editor emits document:load with recordCount after loadSnapshot', () => {
    const ed = new Editor();
    ed.createNode({ type: 'rect', x: 0, y: 0 });
    const snap = ed.toJSON();
    const events: { source: string; recordCount: number }[] = [];
    ed.on('document:load', (e) => events.push({ source: e.source, recordCount: e.recordCount }));
    ed.loadSnapshot(snap);
    expect(events).toEqual([{ source: 'load', recordCount: 1 }]);
  });
});

describe('A7 — applyRemote', () => {
  it('applyRemote does not enter local undo history', () => {
    const ed = new Editor();
    ed.applyRemote([{ op: 'add', record: mkNode('node:r') }]);
    expect(ed.store.has('node:r' as Id)).toBe(true);
    expect(ed.canUndo()).toBe(false); // a remote edit is authoritative, not a local undoable action
  });

  it('a local edit after applyRemote undoes ONLY the local edit', () => {
    const ed = new Editor();
    ed.applyRemote([{ op: 'add', record: mkNode('node:remote') }]);
    const local = ed.createNode({ type: 'rect', x: 50, y: 50 });
    expect(ed.canUndo()).toBe(true);
    ed.undo();
    expect(ed.store.has(local)).toBe(false); // local edit undone
    expect(ed.store.has('node:remote' as Id)).toBe(true); // remote edit untouched
    expect(ed.canUndo()).toBe(false);
  });

  it('applyRemote bypasses before-apply interceptors', () => {
    const ed = new Editor();
    let ran = 0;
    ed.onBeforeChange(() => {
      ran++;
      return null; // would veto a normal apply
    });
    ed.applyRemote([{ op: 'add', record: mkNode('node:r') }] as Change[]);
    expect(ed.store.has('node:r' as Id)).toBe(true); // committed despite the veto — interceptor bypassed
    expect(ran).toBe(0);
  });
});
