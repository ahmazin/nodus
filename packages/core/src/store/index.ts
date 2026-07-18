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
import { isEdge, isNode, isPage } from '../model.js';

export interface ChangeInfo {
  changes: Change[];
  inverse: Change[];
  source: ChangeSource;
  capture: CapturePolicy;
}

export type StoreListener = (info: ChangeInfo) => void;

/** Context handed to `StoreOptions.onError` so a consumer can tell what failed and why. */
export interface StoreErrorContext {
  /** A registered change listener threw while being dispatched (post-commit). */
  phase: 'listener';
  info: ChangeInfo;
}

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
  private readonly idsAtom: Atom<ReadonlySet<Id>> = atom<ReadonlySet<Id>>(new Set());
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
    return this.idsAtom.get();
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
   * updates/removes are skipped. Listeners are notified once, after the transaction commits.
   *
   * Genuinely all-or-nothing: the mutation loop runs inside `transact`, so a throw partway rolls
   * back every atom value it wrote. Because `transact` only tracks atom *values*, the structural
   * `atoms`-Map edits it can't see (a fresh atom created for an add, an atom removed) are unwound
   * by hand in the catch — leaving the store, and therefore history and the scene index (which
   * only ever sync via the listeners below, never reached on throw), exactly as they were.
   */
  apply(changes: Change[], opts: ApplyOptions = {}): ChangeInfo {
    const source: ChangeSource = opts.source ?? 'user';
    const capture: CapturePolicy = opts.capture ?? 'immediately';
    const applied: Change[] = [];
    const inverse: Change[] = [];
    let idsChanged = false;
    let nextIds: Set<Id> | null = null;
    // Structural Map edits `transact` cannot roll back on its own — unwound by hand on throw.
    const addedAtoms: Id[] = [];
    const removedAtoms: Array<[Id, Atom<NodusRecord>]> = [];

    const ensureIds = (): Set<Id> => {
      if (!nextIds) nextIds = new Set(this.idsAtom.peek());
      return nextIds;
    };

    try {
      transact(() => {
        for (const c of changes) {
          if (c.op === 'add') {
            const rec = { ...c.record, version: c.record.version ?? 0 };
            if (this.atoms.has(rec.id)) {
              // treat as replace
              const prev = this.atoms.get(rec.id)!.peek();
              this.atoms.get(rec.id)!.set(rec);
              applied.push(c);
              inverse.push({ op: 'add', record: prev });
            } else {
              this.atoms.set(rec.id, atom<NodusRecord>(rec));
              addedAtoms.push(rec.id);
              ensureIds().add(rec.id);
              idsChanged = true;
              applied.push({ op: 'add', record: rec });
              inverse.push({ op: 'remove', id: rec.id });
            }
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
            ensureIds().delete(c.id);
            idsChanged = true;
            applied.push(c);
            inverse.push({ op: 'add', record: prev });
          }
        }
        if (idsChanged && nextIds) this.idsAtom.set(nextIds);
        if (applied.length > 0) this.sceneNonce.update((v) => v + 1);
      });
    } catch (err) {
      // `transact` restored all atom values + `idsAtom`; undo the Map structural edits it can't see.
      for (const id of addedAtoms) this.atoms.delete(id);
      for (const [id, a] of removedAtoms) this.atoms.set(id, a);
      throw err;
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
      const ids = new Set<Id>();
      for (const r of records) {
        this.atoms.set(r.id, atom<NodusRecord>({ ...r, version: r.version ?? 0 }));
        ids.add(r.id);
      }
      this.idsAtom.set(ids);
      this.sceneNonce.update((v) => v + 1);
    });
  }
}
