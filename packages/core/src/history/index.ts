/**
 * Delta-based undo/redo. History records forward + inverse `Change[]` per user transaction.
 * `capture` policy is 3-state: `immediately` = its own undo entry; `later` = accumulate into the
 * open group (a drag) until `mark()` closes it; `never` = ignored (loads, remote, undo/redo apply).
 */

import { atom, type Atom } from '../signals/index.js';
import type { ApplyOptions, Change } from '../model.js';
import type { ChangeInfo } from '../store/index.js';

interface HistoryEntry {
  forward: Change[];
  inverse: Change[];
}

export type ApplyFn = (changes: Change[], opts: ApplyOptions) => void;

/** Delta-based undo/redo. Records forward + inverse `Change[]` per user transaction; `capture`
 * controls grouping (see {@link CapturePolicy}). Reactive: `version` bumps so `canUndo`/`canRedo` track it. */
export class History {
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private open: HistoryEntry | null = null;
  readonly version: Atom<number> = atom(0);

  /** @param limit Max undo entries kept; the oldest are evicted past it. Undefined ⇒ unbounded. */
  constructor(
    private readonly applyFn: ApplyFn,
    private readonly limit?: number,
  ) {}

  /** Called for every store change; records into history unless capture is `never` or the change came
   *  from a remote peer (a remote edit is authoritative, not a local action to undo — see ChangeSource). */
  record(info: ChangeInfo): void {
    if (info.capture === 'never' || info.source === 'remote' || info.changes.length === 0) return;
    this.redoStack.length = 0;

    if (info.capture === 'immediately') {
      this.open = null;
      this.undoStack.push({ forward: [...info.changes], inverse: [...info.inverse] });
    } else {
      // 'later' — accumulate into the open group (create it if needed)
      if (!this.open) {
        this.open = { forward: [], inverse: [] };
        this.undoStack.push(this.open);
      }
      this.open.forward.push(...info.changes);
      // inverse must undo newest first -> prepend
      this.open.inverse.unshift(...info.inverse);
    }
    // Evict the oldest entries past the limit (the open group, if any, is the newest — never evicted).
    if (this.limit !== undefined) {
      while (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.bump();
  }

  /** Close the current `capture: 'later'` accumulation group (e.g. on pointer-up), so the whole
   *  gesture becomes ONE undo entry and the next change starts a fresh entry. No-op if none is open. */
  mark(): void {
    this.open = null;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Undo the most recent entry. Returns `true` if something was undone, `false` on an empty stack. */
  undo(): boolean {
    this.open = null;
    const entry = this.undoStack.pop();
    if (!entry) return false;
    // Replay the recorded inverse verbatim: `intercept: false` so interceptors don't re-transform it
    // (that would double-apply constraints and corrupt the recorded deltas).
    this.applyFn(entry.inverse, { capture: 'never', source: 'program', intercept: false });
    this.redoStack.push(entry);
    this.bump();
    return true;
  }

  /** Redo the most recently undone entry. Returns `true` if something was redone, else `false`. */
  redo(): boolean {
    this.open = null;
    const entry = this.redoStack.pop();
    if (!entry) return false;
    // Replay the recorded forward deltas verbatim (see undo) — no re-interception.
    this.applyFn(entry.forward, { capture: 'never', source: 'program', intercept: false });
    this.undoStack.push(entry);
    this.bump();
    return true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.open = null;
    this.bump();
  }

  private bump(): void {
    this.version.update((v) => v + 1);
  }
}
