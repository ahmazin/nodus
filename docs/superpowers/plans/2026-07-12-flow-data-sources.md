# Flow Data Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `editor.bindFlowSource(id, source)` so a declarative live feed (pull-poll or push-subscribe) drives a data-driven edge's flow metric, without the host running its own tick loop.

**Architecture:** Sources feed the existing ephemeral `flowMetrics` map via an internal `emit` that ignores non-finite values. Pull sources run an engine-owned `setInterval` (immediate first poll, in-flight overlap skipped); push sources use `subscribe(emit) → unsubscribe`. Errors are swallowed (last metric kept, feed keeps running) and reported to an optional `onError`. Leak-safety: sources auto-unbind when their edge is removed and are all torn down on `editor.dispose()`.

**Tech Stack:** TypeScript, the repo's `atom`/`Dispose`, Vitest with fake timers (`vi.useFakeTimers`, `vi.advanceTimersByTimeAsync`).

## Global Constraints

- Sources are EPHEMERAL: **not serialized, not undoable** (a `FlowSource` holds functions). Plain in-memory map, no `store.apply`/history.
- **Core-only** (`@nodus-dev/core`). No React, renderer, model-visual, or serialization changes.
- `emit(value)` writes the metric **only when `Number.isFinite(value)`** — a non-finite tick is ignored.
- **Pull:** immediate first poll, then `setInterval(intervalMs)`; an `inFlight` guard skips overlapping polls; a rejected/thrown poll → `onError?.(e)`, keep last metric, keep polling.
- **Push:** `subscribe(emit)` returns an unsubscribe; coerce a non-function return to a no-op; wrap subscribe/unsubscribe in try/catch → `onError`.
- `bindFlowSource(id, source)` replaces any existing binding for `id` (old teardown runs) and returns a `Dispose` that unbinds.
- Lifecycle: auto-unbind a source whose edge no longer exists (checked on every store change); `editor.dispose()` tears down all sources.
- TDD (failing test first), frequent commits. Git branch `flow-data-sources` off `mainline` (repo default branch is `mainline`); committing works.

## File Structure

- `packages/core/src/model.ts` — add the `FlowSource` type (types-only; auto re-exported by the barrel).
- `packages/core/src/editor/index.ts` — the `flowSources` map, `bindFlowSource`/`unbindFlowSource`/`clearFlowSources` (Task 1), and the constructor lifecycle wiring (Task 2).
- `packages/core/src/__tests__/flow-sources.test.ts` — new headless test file.

---

### Task 1: FlowSource type + bind/unbind/clear (core)

**Files:**
- Modify: `packages/core/src/model.ts` (add `FlowSource` type after `FlowSpec`)
- Modify: `packages/core/src/editor/index.ts` (add `flowSources` map + methods in the flow-metric region, ~after `clearFlowMetrics` at ~line 1054)
- Test: `packages/core/src/__tests__/flow-sources.test.ts` (new)

**Interfaces:**
- Consumes: `this.setFlowMetric` / `this.flowMetric` (existing); `Id`, `Dispose` (already imported in editor); `ReturnType<typeof setInterval>`.
- Produces (Task 2 + consumers rely on): the `type FlowSource`; `private readonly flowSources = new Map<Id, () => void>()`; `bindFlowSource(id: Id, source: FlowSource): Dispose`; `unbindFlowSource(id: Id): void`; `clearFlowSources(): void`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/__tests__/flow-sources.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, type Id } from '../index.js';

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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/core/src/__tests__/flow-sources.test.ts`
Expected: FAIL — `ed.bindFlowSource is not a function`.

- [ ] **Step 3: Add the `FlowSource` type**

In `packages/core/src/model.ts`, after the `FlowSpec` interface, add:

```ts
/**
 * A declarative live feed for a data-driven edge's flow metric — bound via `editor.bindFlowSource`.
 * EPHEMERAL: never serialized or historied. Two shapes:
 *  - pull: `poll` every `intervalMs` (engine-owned timer); overlapping in-flight polls are skipped.
 *  - push: `subscribe(emit)` returns an unsubscribe; the source pushes values on its own cadence.
 * A poll/subscribe error is swallowed (last metric kept, feed keeps running) and reported to `onError`.
 */
export type FlowSource =
  | { poll: () => number | Promise<number>; intervalMs: number; onError?: (err: unknown) => void }
  | { subscribe: (emit: (value: number) => void) => (() => void); onError?: (err: unknown) => void };
```

- [ ] **Step 4: Add the map + methods to the editor**

In `packages/core/src/editor/index.ts`, add `FlowSource` to the existing type import from `../model.js`:

```ts
  type FlowSource,
```

Then, right after `clearFlowMetrics()` (~line 1054), add:

```ts
  /** id -> teardown (clears the interval for a pull source, or calls unsubscribe for a push source). */
  private readonly flowSources = new Map<Id, () => void>();

  /** Bind a declarative live feed to an edge's flow metric. Replaces any existing binding for `id`.
   *  Returns a `Dispose` that unbinds. EPHEMERAL — not serialized, not undoable. */
  bindFlowSource(id: Id, source: FlowSource): Dispose {
    this.unbindFlowSource(id);
    const emit = (value: number): void => {
      if (Number.isFinite(value)) this.setFlowMetric(id, value);
    };
    let teardown: () => void;
    if ('poll' in source) {
      let inFlight = false;
      const tick = async (): Promise<void> => {
        if (inFlight) return; // skip overlapping polls
        inFlight = true;
        try {
          emit(await source.poll());
        } catch (err) {
          source.onError?.(err); // keep last metric, keep polling
        } finally {
          inFlight = false;
        }
      };
      void tick(); // immediate first poll
      const handle = setInterval(() => void tick(), source.intervalMs);
      teardown = () => clearInterval(handle);
    } else {
      let unsub: () => void = () => {};
      try {
        const u = source.subscribe(emit);
        if (typeof u === 'function') unsub = u;
      } catch (err) {
        source.onError?.(err);
      }
      teardown = () => {
        try {
          unsub();
        } catch (err) {
          source.onError?.(err);
        }
      };
    }
    this.flowSources.set(id, teardown);
    return () => this.unbindFlowSource(id);
  }

  /** Stop and remove the source bound to `id` (idempotent). */
  unbindFlowSource(id: Id): void {
    const teardown = this.flowSources.get(id);
    if (teardown) {
      teardown();
      this.flowSources.delete(id);
    }
  }

  /** Unbind every source. */
  clearFlowSources(): void {
    for (const teardown of this.flowSources.values()) teardown();
    this.flowSources.clear();
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/core/src/__tests__/flow-sources.test.ts`
Expected: PASS (all push + pull tests).

- [ ] **Step 6: Full core suite + typecheck**

Run: `pnpm exec vitest run packages/core && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/model.ts packages/core/src/editor/index.ts packages/core/src/__tests__/flow-sources.test.ts
git commit -m "feat(core): bindFlowSource — declarative pull/push live metric feeds"
```

---

### Task 2: Lifecycle — auto-unbind on edge removal + dispose (core)

**Files:**
- Modify: `packages/core/src/editor/index.ts` (constructor, after the existing `this.disposers.push(...)` block at ~line 188)
- Test: `packages/core/src/__tests__/flow-sources.test.ts` (append a `lifecycle` describe block)

**Interfaces:**
- Consumes: `this.flowSources`, `this.unbindFlowSource`, `this.clearFlowSources` (Task 1); `this.onChange` (existing, `(info: ChangeInfo) => void → Dispose`); `this.store.peek`; `this.deleteRecords` (existing); `this.dispose` (existing, runs `disposers[]`).
- Produces: sources auto-unbind when their edge is gone; `dispose()` tears down all sources.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/__tests__/flow-sources.test.ts`:

```ts
describe('flow data sources — lifecycle', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('auto-unbinds a source when its edge is deleted (interval stops)', async () => {
    vi.useFakeTimers();
    const { ed, e } = build();
    const poll = vi.fn(() => 3);
    ed.bindFlowSource(e, { poll, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(1);
    ed.deleteRecords([e]);
    const before = poll.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(poll.mock.calls.length).toBe(before); // no polls after the edge is gone
  });

  it('dispose() tears down all sources (intervals cleared)', async () => {
    vi.useFakeTimers();
    const { ed, e } = build();
    const poll = vi.fn(() => 3);
    ed.bindFlowSource(e, { poll, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    const before = poll.mock.calls.length;
    ed.dispose();
    await vi.advanceTimersByTimeAsync(3000);
    expect(poll.mock.calls.length).toBe(before);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/core/src/__tests__/flow-sources.test.ts`
Expected: FAIL — the two lifecycle tests fail (the interval keeps polling after delete / after dispose, because nothing tears sources down yet).

- [ ] **Step 3: Wire lifecycle in the constructor**

In `packages/core/src/editor/index.ts`, in the constructor, immediately AFTER the existing `this.disposers.push( this.store.listen(...) );` block (which ends at ~line 188, before the `if (opts.records ...)` block), add:

```ts
    // flow data sources: auto-unbind a source whose edge is gone (delete/undo), and tear down all on dispose
    this.disposers.push(
      this.onChange(() => {
        for (const id of [...this.flowSources.keys()]) {
          if (!this.store.peek(id)) this.unbindFlowSource(id);
        }
      }),
      () => this.clearFlowSources(),
    );
```

(The closures capture `this`; `flowSources` is a class-field map already initialized by construction time, and the handler only runs on later store changes — so there is no initialization-order concern.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/core/src/__tests__/flow-sources.test.ts`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Full core suite + typecheck**

Run: `pnpm exec vitest run packages/core && pnpm typecheck`
Expected: PASS, no type errors. (Confirms the new constructor wiring didn't regress anything.)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/editor/index.ts packages/core/src/__tests__/flow-sources.test.ts
git commit -m "feat(core): auto-unbind flow sources on edge removal + dispose"
```

---

## Self-Review

**Spec coverage:**
- `FlowSource` type (pull + push) → Task 1 Step 3. ✓
- `bindFlowSource`/`unbindFlowSource`/`clearFlowSources`, replace-on-rebind, returns Dispose → Task 1 Step 4 + tests. ✓
- `emit` finite guard → Task 1 (`Number.isFinite`) + "ignores non-finite" test. ✓
- Pull: immediate poll + interval + in-flight skip + error keeps-last/keeps-polling/onError → Task 1 code + three pull tests. ✓
- Push: subscribe→unsubscribe, non-function guard, try/catch → Task 1 code + push tests. ✓
- Auto-unbind on edge removal → Task 2 constructor wiring + delete test. ✓
- Dispose tears down all → Task 2 (`disposers.push(() => clearFlowSources())`) + dispose test. ✓
- Ephemeral (no serialize/undo) → plain map, `setFlowMetric` is already ephemeral; no `store.apply`. ✓ (Global Constraints)
- Core-only → only model.ts + editor/index.ts + a test file touched. ✓

**Placeholder scan:** No TBD/TODO; every step has complete code and exact commands. ✓

**Type consistency:** `FlowSource`, `flowSources`, `bindFlowSource`/`unbindFlowSource`/`clearFlowSources`, `emit`, `flowMetric` names identical across model.ts, editor, and tests. `Dispose` return type matches the existing `addOverlay`/`onChange` convention. ✓
