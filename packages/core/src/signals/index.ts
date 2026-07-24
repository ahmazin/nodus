/**
 * Nodus reactive substrate — a small, dependency-free signals engine.
 *
 * Provides fine-grained reactivity: `atom` (writable), `computed` (lazy, auto-tracked),
 * `effect`/`reaction` (re-run on dependency change), and `transact` (batched with rollback
 * on throw). This is the single source of derivation the whole engine reads from.
 *
 * Design: push-based dirty marking + pull-based lazy recompute. Reads inside a tracking
 * context (a computed or effect) record a dependency edge; writes mark observers dirty and
 * schedule downstream effects; effects run after the outermost batch/transaction settles.
 */

export type Eq<T> = (a: T, b: T) => boolean;
const defaultEq: Eq<unknown> = (a, b) => Object.is(a, b);

/** A node in the reactivity graph. Atoms have observers; effects have sources; computeds have both. */
abstract class ReactiveNode {
  /** Downstream nodes that depend on this node's value. */
  readonly observers = new Set<ReactiveNode>();
  /** Upstream nodes this node read during its last computation. */
  readonly sources = new Set<ReactiveNode>();
  /** For computeds/effects: needs recompute. */
  dirty = false;

  /** Mark this node dirty and propagate. Overridden by computed/effect. */
  markDirty(): void {}
}

// ----- global scheduler state -----
let activeNode: ReactiveNode | null = null; // the computed/effect currently tracking reads
let batchDepth = 0;
let flushing = false;
const pending = new Set<EffectNode>();

// transaction (rollback) state
let txDepth = 0;
let txBackups: Map<AtomNode<unknown>, unknown> | null = null;

/** Whether a `transact()` is currently on the stack. The store uses this to refuse a raw `apply()`
 *  nested inside a `transact()` (it would compose incorrectly — group with `editor.transaction`). */
export function inTransaction(): boolean {
  return txDepth > 0;
}

// ----- effect-error isolation -----

/** Handler invoked when an effect throws during a flush. Receives the thrown value. */
export type EffectErrorHandler = (err: unknown) => void;

let effectErrorHandler: EffectErrorHandler | null = null;

// Bounded dedupe cache so a permanently-throwing effect (re-run every flush) does not flood the
// console with identical lines. Keyed by name+message; cleared when it grows past the cap.
const loggedEffectErrors = new Set<string>();

function defaultEffectErrorHandler(err: unknown): void {
  const key = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  if (loggedEffectErrors.has(key)) return;
  if (loggedEffectErrors.size > 100) loggedEffectErrors.clear();
  loggedEffectErrors.add(key);
  console.error('[nodus] effect threw during flush:', err);
}

/**
 * Install a process-global handler for errors thrown by effects during a flush. Passing `null`
 * restores the built-in deduped-`console.error` default.
 *
 * A throwing effect is isolated: it is removed from the queue and the remaining pending effects
 * still run, so one broken consumer can never strand the rest of a batch. The handler is
 * **deliberately process-global** because the scheduler itself is process-global — there is a
 * single flush queue shared by every atom/effect in the process, so error routing must be too.
 */
export function setEffectErrorHandler(handler: EffectErrorHandler | null): void {
  effectErrorHandler = handler;
}

function reportEffectError(err: unknown): void {
  const handler = effectErrorHandler ?? defaultEffectErrorHandler;
  try {
    handler(err);
  } catch {
    /* a handler that itself throws must not break the flush loop it is reporting into */
  }
}

function link(dep: ReactiveNode, sub: ReactiveNode): void {
  dep.observers.add(sub);
  sub.sources.add(dep);
}

function clearSources(node: ReactiveNode): void {
  for (const s of node.sources) s.observers.delete(node);
  node.sources.clear();
}

function beginBatch(): void {
  batchDepth++;
}

function endBatch(): void {
  batchDepth--;
  if (batchDepth === 0) flush();
}

function flush(): void {
  if (flushing) return;
  flushing = true;
  try {
    while (pending.size > 0) {
      const e: EffectNode = pending.values().next().value!;
      pending.delete(e);
      // Isolate a throwing effect: it is already dequeued, so routing its error and continuing
      // keeps the remaining pending effects running. Critically, this also means the commit-path
      // flush inside `transact` can never throw back into that function's rollback catch (F16).
      if (!e.disposed) {
        try {
          e.run();
        } catch (err) {
          reportEffectError(err);
        }
      }
    }
  } finally {
    flushing = false;
  }
}

function scheduleEffect(e: EffectNode): void {
  pending.add(e);
  if (batchDepth === 0) flush();
}

// ============================================================================
// Atom
// ============================================================================

export interface Atom<T> {
  /** Read the value AND, when called inside a reactive context (an `effect`/`computed`/`reaction` or
   *  React's `useValue`), subscribe to it — the context re-runs when this atom next changes. Outside a
   *  reactive context it is a plain read. Use {@link peek} to read without subscribing. */
  get(): T;
  /** Set the value. Equal values (by the atom's `eq`, default `Object.is`) are a no-op; otherwise
   *  observers are marked dirty and dependent effects are scheduled (run at the end of the batch). */
  set(v: T): void;
  /** Set from the previous value (`set(f(peek()))`). */
  update(f: (prev: T) => T): void;
  /** Read WITHOUT registering a dependency — never subscribes, even inside a reactive context. */
  peek(): T;
}

class AtomNode<T> extends ReactiveNode implements Atom<T> {
  constructor(
    private value: T,
    private readonly eq: Eq<T>,
  ) {
    super();
  }

  get(): T {
    if (activeNode) link(this, activeNode);
    return this.value;
  }

  peek(): T {
    return this.value;
  }

  set(v: T): void {
    if (this.eq(this.value, v)) return;
    if (txBackups && !txBackups.has(this as AtomNode<unknown>)) {
      txBackups.set(this as AtomNode<unknown>, this.value);
    }
    this.value = v;
    beginBatch();
    for (const obs of [...this.observers]) obs.markDirty();
    endBatch();
  }

  update(f: (prev: T) => T): void {
    this.set(f(this.value));
  }

  /** Restore a value during rollback without notifying observers. */
  restore(v: T): void {
    this.value = v;
  }
}

export function atom<T>(initial: T, eq: Eq<T> = defaultEq as Eq<T>): Atom<T> {
  return new AtomNode(initial, eq);
}

// ============================================================================
// Computed
// ============================================================================

export interface Computed<T> {
  /** Read the lazily-recomputed value AND subscribe when inside a reactive context (like {@link Atom.get}). */
  get(): T;
  /** Read the value without subscribing (recomputes if dirty; see {@link Atom.peek}). */
  peek(): T;
  /** Unlink from upstream sources so they no longer retain this computed. Call when discarding a
   *  throwaway computed over long-lived atoms; otherwise the atoms hold it (and its closure) forever. */
  dispose(): void;
}

class ComputedNode<T> extends ReactiveNode implements Computed<T> {
  private value!: T;
  private initialized = false;

  constructor(
    private readonly fn: () => T,
    private readonly eq: Eq<T>,
  ) {
    super();
    this.dirty = true;
  }

  override markDirty(): void {
    if (this.dirty) return;
    this.dirty = true;
    // propagate to downstream so effects depending on us get scheduled
    for (const obs of [...this.observers]) obs.markDirty();
  }

  private recompute(): void {
    clearSources(this);
    const prevActive = activeNode;
    activeNode = this;
    try {
      const next = this.fn();
      this.dirty = false;
      if (!this.initialized || !this.eq(this.value, next)) {
        this.value = next;
        this.initialized = true;
      }
    } finally {
      activeNode = prevActive;
    }
  }

  get(): T {
    if (this.dirty) this.recompute();
    if (activeNode) link(this, activeNode);
    return this.value;
  }

  peek(): T {
    if (this.dirty) this.recompute();
    return this.value;
  }

  dispose(): void {
    clearSources(this); // upstream atoms no longer hold this computed
    this.dirty = true;
    this.initialized = false;
  }
}

export function computed<T>(fn: () => T, eq: Eq<T> = defaultEq as Eq<T>): Computed<T> {
  return new ComputedNode(fn, eq);
}

// ============================================================================
// Effect / reaction
// ============================================================================

export type Dispose = () => void;

class EffectNode extends ReactiveNode {
  disposed = false;

  constructor(private readonly fn: () => void) {
    super();
    this.run();
  }

  override markDirty(): void {
    if (this.disposed) return;
    scheduleEffect(this);
  }

  run(): void {
    if (this.disposed) return;
    clearSources(this);
    const prevActive = activeNode;
    activeNode = this;
    try {
      this.fn();
    } finally {
      activeNode = prevActive;
    }
  }

  dispose(): void {
    this.disposed = true;
    clearSources(this);
    pending.delete(this);
  }
}

/**
 * Run `fn` now (fires IMMEDIATELY), then re-run it whenever any signal it read via `.get()` changes.
 * Returns a disposer that stops it. A throw inside `fn` during a flush is ISOLATED (the other pending
 * effects still run) and routed to the handler set via {@link setEffectErrorHandler} — it never
 * propagates out of the write that scheduled it.
 */
export function effect(fn: () => void): Dispose {
  const node = new EffectNode(fn);
  return () => node.dispose();
}

/**
 * Subscribe-and-run: evaluate `track` reactively (its `.get()` reads are the dependencies) and call
 * `effectFn` with the latest tracked value — IMMEDIATELY on registration and again on every change.
 * `effectFn`'s own body does NOT track dependencies (it runs untracked). Returns a disposer.
 */
export function reaction<T>(track: () => T, effectFn: (value: T) => void): Dispose {
  let first = true;
  return effect(() => {
    const value = track();
    untrack(() => {
      // Skip nothing — fire on initial run too, matching a "subscribe + immediate" contract.
      first = false;
      effectFn(value);
    });
    void first;
  });
}

/** Read signals inside `fn` without registering dependencies. */
export function untrack<T>(fn: () => T): T {
  const prev = activeNode;
  activeNode = null;
  try {
    return fn();
  } finally {
    activeNode = prev;
  }
}

// ============================================================================
// Batching & transactions
// ============================================================================

/** Batch multiple writes so effects run once at the end. No rollback. */
export function batch<T>(fn: () => T): T {
  beginBatch();
  try {
    return fn();
  } finally {
    endBatch();
  }
}

/**
 * Run `fn` as an atomic transaction. Writes are batched; if `fn` throws, every atom write made during
 * the (outermost) transaction is rolled back and pending effects are discarded, so observers never see
 * a partially-applied mutation.
 *
 * This is the LOW-LEVEL signal primitive. Do NOT call `store.apply` inside it — the store refuses that
 * (`NodusError('apply-in-transaction')`) because a nested apply would compose incorrectly. To group
 * document edits into one undo entry, use `editor.transaction(fn)` instead (see {@link inTransaction}).
 */
export function transact<T>(fn: () => T): T {
  const outer = txDepth === 0;
  if (outer) txBackups = new Map();
  txDepth++;
  beginBatch();
  let result: T;
  try {
    result = fn();
  } catch (err) {
    txDepth--;
    // Guard on `txBackups` as well as `outer`: even if some future change let the commit path
    // fall in here, a null backups map must never be dereferenced (that was the F16 corruption
    // that left txDepth negative and disabled rollback for the whole session).
    if (outer && txBackups) {
      const backups = txBackups;
      txBackups = null;
      // Restore each atom AND re-notify its observers, so computeds that recomputed mid-transaction
      // are invalidated (not left with a stale cache) and dependent effects re-run against the
      // restored state. We must NOT `pending.clear()` — that would also drop effects scheduled by
      // committed writes OUTSIDE this transaction (e.g. an enclosing batch).
      for (const [node, value] of backups) {
        node.restore(value);
        for (const obs of [...node.observers]) obs.markDirty();
      }
    } else if (outer) {
      txBackups = null;
    }
    // unwind this transaction's batch and flush (a throwing effect is isolated by flush() and can
    // never mask `err`; the try is belt-and-suspenders for any other unwind fault)
    try {
      endBatch();
    } catch {
      /* the original transaction error wins over anything raised while unwinding the rollback */
    }
    throw err;
  }
  // Commit path — kept OUTSIDE the try above so its endBatch()/flush can never re-enter the
  // rollback catch. txDepth and txBackups are already settled before any effect runs.
  txDepth--;
  if (outer) txBackups = null;
  endBatch();
  return result;
}
