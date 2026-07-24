/**
 * The closed event union + EventBus isolation (task A2). `on()` narrows the handler payload by key
 * and rejects a typo'd name at compile time; a throwing handler is isolated and re-surfaced on the
 * `error` channel; an `error` event nobody listens for is not silently dropped. Each `it` (and the
 * `@ts-expect-error`, checked by `pnpm typecheck`) fails on the pre-change bus.
 */
import { describe, expect, it } from 'vitest';
import { EventBus, type NodusEvent } from './index.js';
import { Editor } from '../editor/index.js';
import type { Id } from '../model.js';
import type { NodeUtil } from '../registries/index.js';

describe('EventBus — typed key narrowing', () => {
  it('narrows the handler payload by event key, and rejects a typo (compile-time)', () => {
    const bus = new EventBus();
    let ids: Id[] = [];
    bus.on('selection', (e) => {
      ids = e.ids; // e is { type:'selection'; ids: Id[] } — no cast needed
    });
    bus.emit({ type: 'selection', ids: ['node:a' as Id] });
    expect(ids).toEqual(['node:a' as Id]);

    // @ts-expect-error — a typo'd name matches no key, not '*', and not `custom:${string}`
    bus.on('selektion', () => {});
  });
});

describe('EventBus — handler isolation & error re-surfacing', () => {
  it('a throwing handler neither crashes the emitter nor strands its siblings; it surfaces on error', () => {
    const bus = new EventBus();
    const errors: unknown[] = [];
    let siblingRan = false;
    bus.on('selection', () => {
      throw new Error('boom in selection');
    });
    bus.on('selection', () => {
      siblingRan = true;
    });
    bus.on('error', (e) => errors.push(e.error));

    expect(() => bus.emit({ type: 'selection', ids: [] })).not.toThrow();
    expect(siblingRan).toBe(true); // the sibling still ran
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('boom in selection');
  });

  it('a throwing error-handler is reported out-of-band, never re-dispatched (recursion guard)', () => {
    const seen: unknown[] = [];
    const bus = new EventBus({ onUnhandledError: (e) => seen.push(e.error) });
    bus.on('error', () => {
      throw new Error('error-handler itself threw');
    });
    expect(() =>
      bus.emit({ type: 'error', error: new Error('original'), context: { phase: 'listener' }, severity: 'error' }),
    ).not.toThrow();
    expect(seen).toHaveLength(1);
    expect((seen[0] as Error).message).toBe('error-handler itself threw');
  });

  it('an error event with no error/wildcard subscriber goes to onUnhandledError, not the void', () => {
    const seen: unknown[] = [];
    const bus = new EventBus({ onUnhandledError: (e) => seen.push(e.error) });
    bus.emit({ type: 'error', error: new Error('nobody listening'), context: { phase: 'build' }, severity: 'error' });
    expect(seen).toHaveLength(1);
    expect((seen[0] as Error).message).toBe('nobody listening');
  });
});

describe('EventBus — custom escape hatch', () => {
  it('a custom:-namespaced event passes through to its subscriber', () => {
    const bus = new EventBus();
    let got: NodusEvent | null = null;
    bus.on('custom:foo', (e) => {
      got = e;
    });
    bus.emit({ type: 'custom:foo', detail: 42 });
    expect(got).toEqual({ type: 'custom:foo', detail: 42 });
  });
});

describe('Editor event emission', () => {
  it('emits hover only when the hovered id actually changes (not per pointer-move)', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const hovers: (Id | null)[] = [];
    ed.on('hover', (e) => hovers.push(e.id));

    ed.setHover(a);
    ed.setHover(a); // same target — must NOT re-emit
    ed.setHover(null);
    ed.setHover(null); // same — no emit
    expect(hovers).toEqual([a, null]);
  });

  it('a registry override surfaces on the error channel with severity "warning"', () => {
    const ed = new Editor();
    const events: { severity: string; phase: unknown }[] = [];
    ed.on('error', (e) => events.push({ severity: e.severity, phase: e.context.phase }));

    // re-registering the builtin 'rect' is a deliberate override → warning, not a fatal error
    ed.registerNodeType({ type: 'rect', getGeometry: () => ({}), draw: () => {} } as unknown as NodeUtil);
    expect(events).toHaveLength(1);
    expect(events[0]!.severity).toBe('warning');
    expect(events[0]!.phase).toBe('register');
  });
});
