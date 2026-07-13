import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, type FlowSource, type Id } from '../index.js';

/** An editor with one data-driven edge (has a scale so metrics are meaningful). */
function build(): { ed: Editor; e: Id } {
  const ed = new Editor();
  const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
  const b = ed.createNode({ type: 'rect', x: 400, y: 0, w: 100, h: 100 });
  const e = ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b })!;
  ed.setFlow([e], { style: 'dots', scale: { domain: [0, 100] } });
  return { ed, e };
}

describe('flow data sources — push', () => {
  it('feeds emitted values into the edge metric', () => {
    const { ed, e } = build();
    let emit!: (v: number) => void;
    ed.bindFlowSource(e, { subscribe: (fn) => { emit = fn; return () => {}; } });
    emit(5);
    expect(ed.flowMetric(e)).toBe(5);
    emit(42);
    expect(ed.flowMetric(e)).toBe(42);
  });

  it('ignores non-finite emitted values (no metric poisoning)', () => {
    const { ed, e } = build();
    let emit!: (v: number) => void;
    ed.bindFlowSource(e, { subscribe: (fn) => { emit = fn; return () => {}; } });
    emit(7);
    emit(Number.NaN);
    emit(Number.POSITIVE_INFINITY);
    expect(ed.flowMetric(e)).toBe(7); // last finite value kept
  });

  it('unbind (via the returned Dispose) calls the source unsubscribe', () => {
    const { ed, e } = build();
    const unsub = vi.fn();
    const dispose = ed.bindFlowSource(e, { subscribe: () => unsub });
    dispose();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it('rebinding an id disposes the previous source', () => {
    const { ed, e } = build();
    const unsub1 = vi.fn();
    ed.bindFlowSource(e, { subscribe: () => unsub1 });
    ed.bindFlowSource(e, { subscribe: () => () => {} });
    expect(unsub1).toHaveBeenCalledTimes(1);
  });
});

describe('flow data sources — pull', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('polls immediately and on the interval, tracking the latest value', async () => {
    vi.useFakeTimers();
    const { ed, e } = build();
    let value = 42;
    ed.bindFlowSource(e, { poll: () => value, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);   // flush the immediate poll
    expect(ed.flowMetric(e)).toBe(42);
    value = 43;
    await vi.advanceTimersByTimeAsync(1000);
    expect(ed.flowMetric(e)).toBe(43);
  });

  it('skips overlapping polls while one is in flight', async () => {
    vi.useFakeTimers();
    const { ed, e } = build();
    let resolve!: (v: number) => void;
    const poll = vi.fn(() => new Promise<number>((r) => { resolve = r; }));
    ed.bindFlowSource(e, { poll, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);     // starts poll #1 (pending)
    await vi.advanceTimersByTimeAsync(1000);  // interval fires but #1 still in flight -> skipped
    expect(poll).toHaveBeenCalledTimes(1);
    resolve(9);
    await vi.advanceTimersByTimeAsync(0);
    expect(ed.flowMetric(e)).toBe(9);
    await vi.advanceTimersByTimeAsync(1000);  // now free -> polls again
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('keeps the last value and keeps polling when a poll rejects, reporting onError', async () => {
    vi.useFakeTimers();
    const { ed, e } = build();
    let mode: 'ok' | 'fail' = 'ok';
    let okVal = 11;
    const onError = vi.fn();
    ed.bindFlowSource(e, {
      poll: () => (mode === 'ok' ? Promise.resolve(okVal) : Promise.reject(new Error('boom'))),
      intervalMs: 1000,
      onError,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(ed.flowMetric(e)).toBe(11);
    mode = 'fail';
    await vi.advanceTimersByTimeAsync(1000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(ed.flowMetric(e)).toBe(11);        // last good value kept
    mode = 'ok'; okVal = 12;
    await vi.advanceTimersByTimeAsync(1000);
    expect(ed.flowMetric(e)).toBe(12);        // resumed polling after the error
  });

  it('a poll resolving after rebind does not clobber the new source (in-flight gated)', async () => {
    vi.useFakeTimers();
    const { ed, e } = build();
    let resolveA!: (v: number) => void;
    ed.bindFlowSource(e, { poll: () => new Promise<number>((r) => { resolveA = r; }), intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);            // A's poll now pending
    let emitB!: (v: number) => void;
    ed.bindFlowSource(e, { subscribe: (fn) => { emitB = fn; return () => {}; } }); // rebind
    emitB(99);
    expect(ed.flowMetric(e)).toBe(99);
    resolveA(1);                                     // stale A resolves after rebind
    await vi.advanceTimersByTimeAsync(0);
    expect(ed.flowMetric(e)).toBe(99);               // stale value did NOT land
    vi.useRealTimers();
  });

  it('tolerates a subscribe returning a non-function (JS callers)', () => {
    const { ed, e } = build();
    const bad = { subscribe: () => undefined } as unknown as FlowSource;
    const dispose = ed.bindFlowSource(e, bad);
    expect(() => dispose()).not.toThrow();
  });

  it('reports a throwing subscribe via onError without throwing', () => {
    const { ed, e } = build();
    const onError = vi.fn();
    expect(() => ed.bindFlowSource(e, { subscribe: () => { throw new Error('x'); }, onError })).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
