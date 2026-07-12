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
      if (!e.disposed) e.run();
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
  get(): T;
  set(v: T): void;
  update(f: (prev: T) => T): void;
  /** Read without registering a dependency. */
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
  get(): T;
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

/** Run `fn` now and re-run it whenever any signal it read changes. Returns a disposer. */
export function effect(fn: () => void): Dispose {
  const node = new EffectNode(fn);
  return () => node.dispose();
}

/**
 * Run `track` reactively; whenever its dependencies change, call `effectFn` with the
 * latest tracked value. The `effectFn` body itself does not track dependencies.
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
 * Run `fn` as an atomic transaction. Writes are batched; if `fn` throws, every atom write
 * made during the (outermost) transaction is rolled back and pending effects are discarded,
 * so observers never see a partially-applied mutation.
 */
export function transact<T>(fn: () => T): T {
  const outer = txDepth === 0;
  if (outer) txBackups = new Map();
  txDepth++;
  beginBatch();
  try {
    const result = fn();
    txDepth--;
    if (outer) txBackups = null;
    endBatch();
    return result;
  } catch (err) {
    txDepth--;
    if (outer) {
      const backups = txBackups!;
      txBackups = null;
      // Restore each atom AND re-notify its observers, so computeds that recomputed mid-transaction
      // are invalidated (not left with a stale cache) and dependent effects re-run against the
      // restored state. We must NOT `pending.clear()` — that would also drop effects scheduled by
      // committed writes OUTSIDE this transaction (e.g. an enclosing batch).
      for (const [node, value] of backups) {
        node.restore(value);
        for (const obs of [...node.observers]) obs.markDirty();
      }
      // unwind this transaction's batch and flush (an effect throwing here must not mask `err`)
      try {
        endBatch();
      } catch {
        /* an effect threw while reacting to the rollback; the original transaction error wins */
      }
    } else {
      endBatch();
    }
    throw err;
  }
}
