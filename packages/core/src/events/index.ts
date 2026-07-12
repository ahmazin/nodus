/**
 * A tiny typed event bus. Read-only observers (a11y mirror, analytics, mode adapters) subscribe
 * here; the engine emits selection/camera/edit/change/pointer plus arbitrary custom events.
 */

import type { Dispose } from '../signals/index.js';
import type { Camera, Id } from '../model.js';
import type { ChangeInfo } from '../store/index.js';

export type NodusEvent =
  | { type: 'change'; info: ChangeInfo }
  | { type: 'selection'; ids: Id[] }
  | { type: 'camera'; camera: Camera }
  | { type: 'hover'; id: Id | null }
  | { type: 'edit:start'; id: Id }
  | { type: 'edit:end'; id: Id; committed: boolean }
  | { type: 'tool'; id: string }
  | { type: string; [key: string]: unknown };

type Handler = (event: NodusEvent) => void;

export class EventBus {
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly wildcard = new Set<Handler>();

  on(type: string, handler: Handler): Dispose {
    if (type === '*') {
      this.wildcard.add(handler);
      return () => this.wildcard.delete(handler);
    }
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => {
      const s = this.handlers.get(type);
      if (s) {
        s.delete(handler);
        if (s.size === 0) this.handlers.delete(type); // don't leak an empty Set per unique event key
      }
    };
  }

  emit(event: NodusEvent): void {
    // snapshot listeners so a handler that (un)subscribes during dispatch can't re-fire this event,
    // skip a sibling, or infinite-loop
    const set = this.handlers.get(event.type);
    if (set) for (const h of [...set]) h(event);
    if (this.wildcard.size) for (const h of [...this.wildcard]) h(event);
  }
}
