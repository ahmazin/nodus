/**
 * Runtime props validation (task A15). The façade (createNode/updateRecord) runs a type's
 * validateProps synchronously — invalid props throw NodusError('invalid-props'), the normalized result
 * commits. A built-in before-apply guard applies the same on RAW store writes, but VETOES + reports
 * (raw-path faults are third-party). createNode merges defaults UNDER partial props. Each `it` fails
 * on the pre-change engine (no validateProps hook, defaults replaced not merged, undo() returned void).
 */
import { describe, expect, it } from 'vitest';
import { Editor } from './index.js';
import { effect } from '../signals/index.js';
import { isNodusError, type NodusError } from '../errors/index.js';
import type { NodeUtil } from '../registries/index.js';
import type { Change, Id } from '../model.js';

// A node type requiring a positive `size`, clamping it to <= 100 as (idempotent) normalization;
// `color` defaults to blue.
const gaugeUtil: NodeUtil = {
  type: 'gauge',
  getDefaultProps: () => ({ size: 1, color: 'blue' }),
  getGeometry: (n) => ({ bounds: () => ({ x: n.x, y: n.y, w: n.w, h: n.h }) }) as never,
  draw: () => {},
  validateProps: (p) => {
    if (typeof p.size !== 'number' || p.size <= 0) throw new Error('size must be a positive number');
    return { ...p, size: Math.min(100, p.size) };
  },
};

function rawGauge(id: string, size: number): Change {
  return {
    op: 'add',
    record: {
      id: id as Id<'node'>,
      typeName: 'node',
      version: 0,
      type: 'gauge',
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      z: 'a0',
      visual: { state: 'solid' },
      props: { size },
    },
  };
}

const propsOf = (ed: Editor, id: Id): { size: number; color: string } =>
  (ed.store.peek(id) as unknown as { props: { size: number; color: string } }).props;

describe('A15 — synchronous façade validation', () => {
  it('createNode throws NodusError("invalid-props") for invalid props', () => {
    const ed = new Editor();
    ed.registerNodeType(gaugeUtil);
    let err: unknown;
    try {
      ed.createNode({ type: 'gauge', props: { size: -5 } });
    } catch (e) {
      err = e;
    }
    expect(isNodusError(err)).toBe(true);
    expect((err as NodusError).code).toBe('invalid-props');
  });

  it('createNode normalizes via validateProps and merges defaults UNDER the partial props', () => {
    const ed = new Editor();
    ed.registerNodeType(gaugeUtil);
    const id = ed.createNode({ type: 'gauge', props: { size: 150 } });
    expect(propsOf(ed, id).size).toBe(100); // clamped by validateProps
    expect(propsOf(ed, id).color).toBe('blue'); // the default survived the partial props
  });

  it('updateRecord normalizes a props update, and throws invalid-props on a bad one', () => {
    const ed = new Editor();
    ed.registerNodeType(gaugeUtil);
    const id = ed.createNode({ type: 'gauge', props: { size: 1 } });
    ed.updateRecord(id, { props: { size: 150, color: 'red' } }); // clamped to 100
    expect(propsOf(ed, id)).toEqual({ size: 100, color: 'red' });

    let err: unknown;
    try {
      ed.updateRecord(id, { props: { size: 0 } });
    } catch (e) {
      err = e;
    }
    expect((err as NodusError).code).toBe('invalid-props');
  });
});

describe('A15 — raw-path guard interceptor', () => {
  it('a RAW store.apply with invalid props is vetoed and reported (not thrown)', () => {
    const ed = new Editor();
    ed.registerNodeType(gaugeUtil);
    const errors: unknown[] = [];
    ed.on('error', (e) => errors.push(e.error));
    expect(() => ed.store.apply([rawGauge('node:raw', -1)])).not.toThrow();
    expect(ed.store.has('node:raw' as Id)).toBe(false); // vetoed — nothing committed
    expect(errors.length).toBeGreaterThan(0); // surfaced on the error channel
  });

  it('a RAW store.apply with valid props commits the NORMALIZED props', () => {
    const ed = new Editor();
    ed.registerNodeType(gaugeUtil);
    ed.store.apply([rawGauge('node:raw2', 150)]);
    expect(propsOf(ed, 'node:raw2' as Id).size).toBe(100); // clamped by the built-in interceptor
  });
});

describe('A15 — reactive undo state + boolean undo/redo', () => {
  it('canUndo() is reactive: a signal effect re-runs when the undo stack changes', () => {
    const ed = new Editor();
    const seen: boolean[] = [];
    const stop = effect(() => seen.push(ed.canUndo()));
    expect(seen).toEqual([false]); // initial
    ed.createNode({ type: 'rect', x: 0, y: 0 }); // pushes an undo entry → history.version bumps
    expect(seen).toEqual([false, true]); // the effect re-ran with the flipped value
    stop();
  });

  it('undo() returns false on an empty stack, true after an edit', () => {
    const ed = new Editor();
    expect(ed.undo()).toBe(false);
    ed.createNode({ type: 'rect', x: 0, y: 0 });
    expect(ed.undo()).toBe(true);
    expect(ed.undo()).toBe(false);
    expect(ed.redo()).toBe(true); // the undone edit is redoable
  });
});
