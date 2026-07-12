/**
 * The reactive record store — the single source of truth and the *only* mutation channel.
 * `apply()` is the one door: it computes inverse changes (for undo), updates per-record signal
 * atoms inside a transaction (all-or-nothing), then notifies listeners through one path so the
 * scene index, history, and observers can never drift from the document.
 */

import { atom, batch, type Atom, type Dispose } from '../signals/index.js';
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

export class Store {
  private readonly atoms = new Map<Id, Atom<NodusRecord>>();
  private readonly idsAtom: Atom<ReadonlySet<Id>> = atom<ReadonlySet<Id>>(new Set());
  /** Coarse "something changed" counter for consumers that want a single signal. */
  readonly sceneNonce: Atom<number> = atom(0);
  private readonly listeners = new Set<StoreListener>();

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
   */
  apply(changes: Change[], opts: ApplyOptions = {}): ChangeInfo {
    const source: ChangeSource = opts.source ?? 'user';
    const capture: CapturePolicy = opts.capture ?? 'immediately';
    const applied: Change[] = [];
    const inverse: Change[] = [];
    let idsChanged = false;
    let nextIds: Set<Id> | null = null;

    const ensureIds = (): Set<Id> => {
      if (!nextIds) nextIds = new Set(this.idsAtom.peek());
      return nextIds;
    };

    batch(() => {
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
          for (const k of Object.keys(c.patch)) {
            invPatch[k] = prevRec[k];
          }
          const next = { ...prevRec, ...c.patch, version: prev.version + 1 } as unknown as NodusRecord;
          a.set(next);
          applied.push(c);
          inverse.push({ op: 'update', id: c.id, patch: invPatch });
        } else if (c.op === 'remove') {
          const a = this.atoms.get(c.id);
          if (!a) continue;
          const prev = a.peek();
          this.atoms.delete(c.id);
          ensureIds().delete(c.id);
          idsChanged = true;
          applied.push(c);
          inverse.push({ op: 'add', record: prev });
        }
      }
      if (idsChanged && nextIds) this.idsAtom.set(nextIds);
      if (applied.length > 0) this.sceneNonce.update((v) => v + 1);
    });

    const info: ChangeInfo = { changes: applied, inverse: inverse.reverse(), source, capture };
    if (applied.length > 0) {
      for (const l of [...this.listeners]) l(info);
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
