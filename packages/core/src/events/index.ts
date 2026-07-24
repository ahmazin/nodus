/**
 * A tiny typed event bus. Read-only observers (a11y mirror, analytics, mode adapters) subscribe
 * here; the engine emits a CLOSED set of events (see {@link NodusEventMap}) plus a `custom:${string}`
 * escape hatch for app-defined ones. `on()` narrows the handler payload by event key; a throwing
 * handler is isolated (siblings still run) and re-surfaced on the `error` event.
 */

import type { Dispose } from '../signals/index.js';
import type { Camera, Id } from '../model.js';
import type { ChangeInfo } from '../store/index.js';

/**
 * Structured context attached to an `error` event. `phase` says WHERE the fault came from; the open
 * index signature carries phase-specific detail (the throwing event's type, the plugin id, …).
 */
export interface ErrorEventContext {
  phase:
    | 'listener'
    | 'duplicate-add'
    | 'build'
    | 'non-finite'
    | 'missing-util'
    | 'plugin'
    | 'register'
    | 'flow'
    | 'paint'
    | 'effect'
    | 'layout'
    | 'before-apply';
  [k: string]: unknown;
}

/**
 * The closed map of engine events: `type` key → payload shape. `on('<key>', …)` narrows the handler
 * to `{ type: '<key>' } & <payload>`. App-defined events live under the `custom:${string}` arm of
 * {@link NodusEvent} and are not part of this map.
 */
export interface NodusEventMap {
  change: { info: ChangeInfo };
  selection: { ids: Id[] };
  camera: { camera: Camera };
  hover: { id: Id | null };
  'edit:start': { id: Id };
  'edit:end': { id: Id; committed: boolean };
  tool: { id: string };
  theme: { name: string };
  error: { error: unknown; context: ErrorEventContext; severity: 'error' | 'warning' };
  // The emitter for this arm lands in A7/A12 (the load/hydration path). `report` is typed `unknown`
  // for now — it becomes the `LoadReport` shape once that task defines it (avoids owning it here).
  'document:load': { source: 'load' | 'reset'; recordCount: number; report?: unknown };
}

/** A concrete event: one of the closed arms, or a `custom:`-namespaced app event. */
export type NodusEvent =
  | { [K in keyof NodusEventMap]: { type: K } & NodusEventMap[K] }[keyof NodusEventMap]
  | ({ type: `custom:${string}` } & Record<string, unknown>);

/** The fully-typed event for a given key — `on()`'s narrowed handler payload. */
export type NodusEventOf<K extends keyof NodusEventMap> = { type: K } & NodusEventMap[K];

/** A `custom:`-namespaced app event. */
export type NodusCustomEvent = { type: `custom:${string}` } & Record<string, unknown>;

/** The narrowed `error` event, handed to unhandled-error sinks. */
export type NodusErrorEvent = NodusEventOf<'error'>;

type Handler = (event: NodusEvent) => void;

export interface EventBusOptions {
  /**
   * Invoked when an `error` event is emitted with NO `error` and NO wildcard subscriber, so it would
   * otherwise vanish silently. Also the sink for an `error`-handler that itself throws (re-dispatching
   * would loop). Default: a deduped `console.error`.
   */
  onUnhandledError?: (event: NodusErrorEvent) => void;
}

// Bounded dedupe so a persistently-failing handler doesn't flood the console with identical lines.
const loggedUnhandled = new Set<string>();
function defaultUnhandledError(event: NodusErrorEvent): void {
  const err = event.error;
  const key = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  if (loggedUnhandled.has(key)) return;
  if (loggedUnhandled.size > 100) loggedUnhandled.clear();
  loggedUnhandled.add(key);
  console.error('[nodus] unhandled error event:', err, event.context);
}

export class EventBus {
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly wildcard = new Set<Handler>();

  constructor(private readonly opts: EventBusOptions = {}) {}

  on<K extends keyof NodusEventMap>(type: K, handler: (event: NodusEventOf<K>) => void): Dispose;
  on(type: `custom:${string}`, handler: (event: NodusCustomEvent) => void): Dispose;
  on(type: '*', handler: (event: NodusEvent) => void): Dispose;
  on(type: string, handler: (event: never) => void): Dispose {
    const h = handler as Handler;
    if (type === '*') {
      this.wildcard.add(h);
      return () => this.wildcard.delete(h);
    }
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(h);
    return () => {
      const s = this.handlers.get(type);
      if (s) {
        s.delete(h);
        if (s.size === 0) this.handlers.delete(type); // don't leak an empty Set per unique event key
      }
    };
  }

  emit(event: NodusEvent): void {
    // Snapshot listeners so a handler that (un)subscribes during dispatch can't re-fire this event,
    // skip a sibling, or infinite-loop.
    const set = this.handlers.get(event.type);
    const hasDirect = (set?.size ?? 0) > 0;
    const hasWildcard = this.wildcard.size > 0;

    if (set) for (const h of [...set]) this.runHandler(h, event);
    if (hasWildcard) for (const h of [...this.wildcard]) this.runHandler(h, event);

    // An `error` event nobody is listening for must not vanish silently.
    if (event.type === 'error' && !hasDirect && !hasWildcard) {
      this.reportUnhandled(event as NodusErrorEvent);
    }
  }

  /** Run one handler, isolating a throw: siblings continue (the set was snapshotted), and the error
   *  is re-surfaced on the `error` channel — unless we're already dispatching an `error` event, in
   *  which case re-dispatching would loop, so it goes out-of-band to the unhandled sink. */
  private runHandler(h: Handler, event: NodusEvent): void {
    try {
      h(event);
    } catch (err) {
      if (event.type === 'error') {
        this.reportUnhandled({
          type: 'error',
          error: err,
          context: { phase: 'listener', while: 'error' },
          severity: 'error',
        });
      } else {
        this.emit({
          type: 'error',
          error: err,
          context: { phase: 'listener', eventType: event.type },
          severity: 'error',
        });
      }
    }
  }

  private reportUnhandled(event: NodusErrorEvent): void {
    if (this.opts.onUnhandledError) this.opts.onUnhandledError(event);
    else defaultUnhandledError(event);
  }
}
