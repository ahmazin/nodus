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

export class History {
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private open: HistoryEntry | null = null;
  readonly version: Atom<number> = atom(0);

  constructor(private readonly applyFn: ApplyFn) {}

  /** Called for every store change; records into history unless capture is `never`. */
  record(info: ChangeInfo): void {
    if (info.capture === 'never' || info.changes.length === 0) return;
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
    this.bump();
  }

  /** Close the current accumulation group (e.g. on pointer-up). */
  mark(): void {
    this.open = null;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    this.open = null;
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.applyFn(entry.inverse, { capture: 'never', source: 'program' });
    this.redoStack.push(entry);
    this.bump();
  }

  redo(): void {
    this.open = null;
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.applyFn(entry.forward, { capture: 'never', source: 'program' });
    this.undoStack.push(entry);
    this.bump();
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
