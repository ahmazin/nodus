/**
 * `useNodusEditor` — the turnkey lifecycle hook for owning an `Editor` from React.
 *
 * Builds the editor once (rebuilding only when `deps` change) and disposes the old instance on a
 * real unmount and on every deps change, so event-bus subscriptions and flow-source timers never
 * outlive the component.
 *
 *   const editor = useNodusEditor(() => {
 *     const e = new Editor();
 *     e.registerNodeType(myNodeUtil);
 *     return e;
 *   });
 *   return <Nodus editor={editor} />;
 *
 * STRICTMODE: React's dev StrictMode mounts, synchronously unmounts, then remounts. We must NOT
 * dispose the editor on that fake unmount — a disposed editor's signals stop driving re-renders, and
 * under React 19's commit/effect timing the committed tree was left bound to that dead instance
 * (symptom: the inline label editor never opening on double-click). So disposal is DEFERRED to a
 * microtask: a real unmount leaves it pending and frees the editor; StrictMode's immediate remount
 * cancels it first. One live editor survives the whole cycle — no rebuild, no stranding.
 */

import { useEffect, useRef, type DependencyList } from 'react';
import { type Editor } from '@nodus-dev/core';

/** Shallow `Object.is` comparison of two dependency tuples, matching React's own deps semantics. */
function sameDeps(a: DependencyList, b: DependencyList): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

interface Entry {
  editor: Editor;
  deps: DependencyList;
  keep: boolean;
}

/**
 * Own an `Editor` instance across a component's lifetime.
 *
 * @param factory  Builds the editor (construct + register types/tools/plugins). Called once up front,
 *                 then again only when `deps` change — never on an ordinary re-render or a StrictMode
 *                 remount.
 * @param deps     When any entry changes (by `Object.is`), the current editor is disposed and
 *                 `factory` is re-run. Defaults to `[]`. Must have a stable length across renders.
 * @returns        A stable `Editor` — the same live instance every render until `deps` change.
 */
export function useNodusEditor(factory: () => Editor, deps: DependencyList = []): Editor {
  const ref = useRef<Entry | null>(null);

  // Build during render (ready for the same render that mounts `<Nodus editor={editor}>`), and only
  // when there is no instance yet or `deps` changed. We never rebuild for a disposed editor, because
  // disposal is deferred and cancelled on remount — the instance is never dead while still mounted.
  if (ref.current === null || !sameDeps(ref.current.deps, deps)) {
    ref.current = { editor: factory(), deps, keep: true };
  }
  const entry = ref.current;
  const editor = entry.editor;

  useEffect(() => {
    entry.keep = true; // (re)mounted — cancel any pending disposal (this is StrictMode's remount)
    return () => {
      entry.keep = false;
      // Defer past the synchronous StrictMode unmount→remount. A real unmount (or a deps change that
      // swapped `entry`) leaves keep=false and disposes; the immediate remount sets keep=true first.
      queueMicrotask(() => {
        if (!entry.keep && !editor.disposed) editor.dispose();
      });
    };
  }, [editor, entry]);

  return editor;
}
