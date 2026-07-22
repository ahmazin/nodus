/**
 * The reactive record store — the single source of truth and the *only* mutation channel.
 * `apply()` is the one door: it computes inverse changes (for undo), updates per-record signal
 * atoms inside a transaction (all-or-nothing), then notifies listeners through one path so the
 * scene index, history, and observers can never drift from the document.
 */

import { atom, batch, transact, type Atom, type Dispose } from '../signals/index.js';
import type {
  ApplyOptions,
  Change,
  CapturePolicy,
  ChangeSource,
  EdgeRecord,
  Id,
  NodeRecord,
  NodusRecord,
  PageRecord,
} from '../model.js';
import { isEdge, isNode, isPage, seedIdCounter } from '../model.js';

export interface ChangeInfo {
  changes: Change[];
  inverse: Change[];
  source: ChangeSource;
  capture: CapturePolicy;
}

export type StoreListener = (info: ChangeInfo) => void;

/** Context handed to `StoreOptions.onError` so a consumer can tell what failed and why. */
export type StoreErrorContext =
  | {
      /** A registered change listener threw while being dispatched (post-commit). */
      phase: 'listener';
      info: ChangeInfo;
    }
  | {
      /**
       * An `add` targeted an id that already exists. The store refuses it rather than silently
       * clobbering the live record (which would be data loss — e.g. a regenerated `makeId` colliding
       * with a loaded node). The change is skipped and surfaced here.
       */
      phase: 'duplicate-add';
      id: Id;
    };

export interface StoreOptions {
  /**
   * Surface — never swallow — an error thrown by a change listener during dispatch. The throwing
   * listener is isolated (siblings still run and `apply()` never throws), and the error is routed
   * here so it stays observable. Default: a safe no-op; wire this to the EventBus for visibility.
   */
  onError?: (err: unknown, ctx: StoreErrorContext) => void;
}

export class Store {
  private readonly atoms = new Map<Id, Atom<NodusRecord>>();
  /**
   * Canonical membership, mutated **incrementally** (O(1) per add/remove). The immutable snapshot
   * exposed by `ids()` is derived from it lazily and memoized, so a per-op `apply` never deep-clones
   * the whole set (which made bulk per-op builds O(N²)). Structurally invisible to `transact`, so — like
   * the `atoms` Map — it is hand-unwound on a mid-apply throw.
   */
  private readonly idSet = new Set<Id>();
  /** Bumped whenever membership changes; the reactive dependency behind `ids()`. */
  private readonly idsVersion: Atom<number> = atom(0);
  /** Memoized immutable snapshot of `idSet` (stable ref between changes); nulled on every change. */
  private idsSnapshot: ReadonlySet<Id> | null = null;
  /** Coarse "something changed" counter for consumers that want a single signal. */
  readonly sceneNonce: Atom<number> = atom(0);
  private readonly listeners = new Set<StoreListener>();

  constructor(private readonly opts: StoreOptions = {}) {}

  // ---- reads ----

  /** Tracked read — registers a dependency when called inside a computed/effect. */
  get(id: Id): NodusRecord | undefined {
    return this.atoms.get(id)?.get();
  }

  /** Untracked read. */
  peek(id: Id): NodusRecord | undefined {
    return this.atoms.get(id)?.peek();
  }

  has(id: Id): boolean {
    return this.atoms.has(id);
  }

  /** Tracked membership signal (changes only on add/remove). */
  ids(): ReadonlySet<Id> {
    this.idsVersion.get(); // subscribe: re-run dependents when membership changes
    return (this.idsSnapshot ??= new Set(this.idSet));
  }

  allRecords(): NodusRecord[] {
    const out: NodusRecord[] = [];
    for (const a of this.atoms.values()) out.push(a.peek());
    return out;
  }

  nodes(): NodeRecord[] {
    return this.allRecords().filter(isNode);
  }
  edges(): EdgeRecord[] {
    return this.allRecords().filter(isEdge);
  }
  pages(): PageRecord[] {
    return this.allRecords().filter(isPage);
  }

  get size(): number {
    return this.atoms.size;
  }

  // ---- writes ----

  listen(fn: StoreListener): Dispose {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Apply changes atomically. Returns the `ChangeInfo` (including computed inverse). Unknown
   * updates/removes are skipped; an `add` onto an already-existing id is *refused* (not a silent
   * replace) and surfaced via `onError` — see `duplicate-add`. Listeners are notified once, after
   * the transaction commits.
   *
   * Genuinely all-or-nothing: the mutation loop runs inside `transact`, so a throw partway rolls
   * back every atom value it wrote. Because `transact` only tracks atom *values*, the structural
   * edits it can't see — the `atoms` Map (a fresh atom created for an add, an atom removed) and the
   * incremental `idSet` — are unwound by hand in the catch, leaving the store, and therefore history
   * and the scene index (which only ever sync via the listeners below, never reached on throw),
   * exactly as they were.
   */
  apply(changes: Change[], opts: ApplyOptions = {}): ChangeInfo {
    const source: ChangeSource = opts.source ?? 'user';
    const capture: CapturePolicy = opts.capture ?? 'immediately';
    const applied: Change[] = [];
    const inverse: Change[] = [];
    let idsChanged = false;
    // Structural edits `transact` cannot roll back on its own — unwound by hand on throw.
    const addedAtoms: Id[] = [];
    const removedAtoms: Array<[Id, Atom<NodusRecord>]> = [];
    // Adds refused because their id already exists — surfaced via `onError` after commit.
    const duplicateAdds: Id[] = [];

    try {
      transact(() => {
        for (const c of changes) {
          if (c.op === 'add') {
            const rec = { ...c.record, version: c.record.version ?? 0 };
            if (this.atoms.has(rec.id)) {
              // Refuse: overwriting a live record via `add` is data loss (e.g. a regenerated id
              // colliding with a loaded node). Skip the change and report the collision post-commit.
              duplicateAdds.push(rec.id);
              continue;
            }
            this.atoms.set(rec.id, atom<NodusRecord>(rec));
            addedAtoms.push(rec.id);
            this.idSet.add(rec.id);
            idsChanged = true;
            applied.push({ op: 'add', record: rec });
            inverse.push({ op: 'remove', id: rec.id });
          } else if (c.op === 'update') {
            const a = this.atoms.get(c.id);
            if (!a) continue;
            const prev = a.peek();
            const prevRec = prev as unknown as Record<string, unknown>;
            const invPatch: Record<string, unknown> = {};
            const next = { ...prevRec } as Record<string, unknown>;
            for (const k of Object.keys(c.patch)) {
              // Inverse restores the prior value; for a key ABSENT before, `prevRec[k]` is
              // `undefined`, which the loop below treats as "delete this key on undo" — so undo
              // removes the key rather than leaving it set to `undefined` (strict `load(save(x))`).
              invPatch[k] = prevRec[k];
              const v = c.patch[k];
              if (v === undefined) delete next[k];
              else next[k] = v;
            }
            next.version = prev.version + 1;
            a.set(next as unknown as NodusRecord);
            applied.push(c);
            inverse.push({ op: 'update', id: c.id, patch: invPatch });
          } else if (c.op === 'remove') {
            const a = this.atoms.get(c.id);
            if (!a) continue;
            const prev = a.peek();
            this.atoms.delete(c.id);
            removedAtoms.push([c.id, a]);
            this.idSet.delete(c.id);
            idsChanged = true;
            applied.push(c);
            inverse.push({ op: 'add', record: prev });
          }
        }
        if (idsChanged) {
          this.idsSnapshot = null;
          this.idsVersion.update((v) => v + 1);
        }
        if (applied.length > 0) this.sceneNonce.update((v) => v + 1);
      });
    } catch (err) {
      // `transact` restored all atom values (incl. `idsVersion`); undo the structural edits it can't
      // see — the `atoms` Map and the incremental `idSet` — so the store is exactly as it was.
      for (const id of addedAtoms) {
        this.atoms.delete(id);
        this.idSet.delete(id);
      }
      for (const [id, a] of removedAtoms) {
        this.atoms.set(id, a);
        this.idSet.add(id);
      }
      this.idsSnapshot = null;
      throw err;
    }

    for (const id of duplicateAdds) {
      this.opts.onError?.(
        new Error(`Store.apply: refused to overwrite existing record "${id}" via 'add' (duplicate id)`),
        { phase: 'duplicate-add', id },
      );
    }

    const info: ChangeInfo = { changes: applied, inverse: inverse.reverse(), source, capture };
    if (applied.length > 0) {
      for (const l of [...this.listeners]) {
        // Isolate a throwing listener: siblings still run and `apply()` never throws. The store's
        // atoms are already committed and consistent here, so we do NOT roll back — a buggy
        // observer must not corrupt the mutation channel. Route the error out; never swallow it.
        try {
          l(info);
        } catch (err) {
          this.opts.onError?.(err, { phase: 'listener', info });
        }
      }
    }
    return info;
  }

  /** Replace the entire document (used by load/restore). Does not notify change listeners. */
  load(records: NodusRecord[]): void {
    batch(() => {
      this.atoms.clear();
      this.idSet.clear();
      for (const r of records) {
        this.atoms.set(r.id, atom<NodusRecord>({ ...r, version: r.version ?? 0 }));
        this.idSet.add(r.id);
      }
      this.idsSnapshot = null;
      this.idsVersion.update((v) => v + 1);
      this.sceneNonce.update((v) => v + 1);
    });
    // Advance the id counter past every auto-generated id just loaded, so ids minted after this load
    // can't collide with loaded records (a collision would be refused by `apply`, blocking the add).
    seedIdCounter(this.idSet);
  }
}
