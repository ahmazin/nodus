/**
 * `useNodusEditor` — the turnkey lifecycle hook for owning an `Editor` from React.
 *
 * Consumers previously hand-rolled `const editor = useMemo(() => { const e = new Editor(); …; return e }, [])`,
 * which (a) leaks — nothing ever calls `editor.dispose()`, so event-bus subscriptions and flow-source
 * timers outlive the component — and (b) is fragile: any accidental `new Editor()` in render hands
 * `<Nodus>` a fresh identity every frame, thrashing its rAF loop and DOM listeners (they re-attach on
 * `editor` identity; see `nodus-host.tsx`).
 *
 * This hook is the fix: it builds the editor once (recreating only when `deps` change) and disposes the
 * old instance on unmount and on every deps change.
 *
 *   const editor = useNodusEditor(() => {
 *     const e = new Editor();
 *     e.registerNodeType(myNodeUtil);
 *     return e;
 *   });
 *   return <Nodus editor={editor} />;
 */

import { useEffect, useReducer, useRef, type DependencyList } from 'react';
import { type Editor } from '@nodus/core';

/** Shallow `Object.is` comparison of two dependency tuples, matching React's own deps semantics. */
function sameDeps(a: DependencyList, b: DependencyList): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

/**
 * Own an `Editor` instance across a component's lifetime.
 *
 * @param factory  Builds the editor (construct + register types/tools/plugins). Called once up front,
 *                 then again only when `deps` change or after the current editor has been disposed
 *                 (StrictMode's dev remount) — never on an ordinary re-render.
 * @param deps     When any entry changes (by `Object.is`), the current editor is disposed and `factory`
 *                 is re-run. Defaults to `[]` (built once, disposed on unmount). Must have a stable
 *                 length across renders, exactly like a `useEffect` dependency array.
 * @returns        A stable `Editor` — the same live instance every render until `deps` change.
 */
export function useNodusEditor(factory: () => Editor, deps: DependencyList = []): Editor {
  const ref = useRef<{ editor: Editor; deps: DependencyList } | null>(null);
  // Forces a re-render so the render guard below can rebuild after StrictMode disposes the editor.
  const [, bump] = useReducer((n: number) => n + 1, 0);

  // Build during render — the editor is ready for the same render that mounts `<Nodus editor={editor}>`.
  // Rebuild when there is no instance yet, when `deps` changed, OR when the current instance has been
  // disposed. That last case is the StrictMode fix: React's dev-only mount→unmount→remount disposes the
  // editor in the unmount cleanup, and the render guard is what swaps in a fresh one.
  if (ref.current === null || !sameDeps(ref.current.deps, deps) || ref.current.editor.disposed) {
    ref.current = { editor: factory(), deps };
  }
  const editor = ref.current.editor;

  // Disposal is keyed on the editor's IDENTITY, not the user's `deps`: React runs cleanup on unmount and
  // whenever `editor` changes, so each instance is disposed exactly once — the one THIS render captured.
  // The StrictMode remount re-runs only this effect (never the render), leaving the ref pointing at the
  // just-disposed editor; the setup detects that and calls `bump()` to force the re-render that lets the
  // render guard rebuild a live instance. `Editor.dispose()` is idempotent, so no path double-frees.
  useEffect(() => {
    if (editor.disposed) {
      bump();
      return;
    }
    return () => editor.dispose();
  }, [editor]);

  return editor;
}
