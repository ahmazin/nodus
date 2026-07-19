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

import { useEffect, useRef, type DependencyList } from 'react';
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
 *                 then again only when `deps` change — never on an ordinary re-render.
 * @param deps     When any entry changes (by `Object.is`), the current editor is disposed and `factory`
 *                 is re-run. Defaults to `[]` (built once, disposed on unmount). Must have a stable
 *                 length across renders, exactly like a `useEffect` dependency array.
 * @returns        A stable `Editor` — the same instance every render until `deps` change.
 */
export function useNodusEditor(factory: () => Editor, deps: DependencyList = []): Editor {
  // Hold the live instance alongside the deps it was built for. We build synchronously *during render*
  // so the editor is ready for the same render that mounts `<Nodus editor={editor}>`. We deliberately do
  // NOT dispose here — disposal is deferred to the effect below, so a render React later throws away
  // (Suspense, or StrictMode's double-invoked render) can never tear down an editor that is still in use.
  const ref = useRef<{ editor: Editor; deps: DependencyList } | null>(null);
  if (ref.current === null || !sameDeps(ref.current.deps, deps)) {
    ref.current = { editor: factory(), deps };
  }
  const editor = ref.current.editor;

  // Disposal keyed on the user's `deps`: React runs this cleanup on unmount AND just before re-running on
  // a deps change. `editor` is captured per-render, so it is exactly the instance built for this deps
  // tuple — the old editor is disposed while the newly-built one is already live in the ref above.
  // `Editor.dispose()` is idempotent (its disposer list is cleared on first call), so StrictMode's
  // dev-only mount→unmount→mount, which disposes the instance during the simulated unmount, neither
  // leaks nor double-frees.
  useEffect(
    () => () => editor.dispose(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `deps` intentionally drives recreation + disposal
    deps,
  );

  return editor;
}
