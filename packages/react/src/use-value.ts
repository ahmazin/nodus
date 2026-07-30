import { useCallback, useRef, useSyncExternalStore } from 'react';
import { effect, type Dispose } from '@ahmazin/core';

/**
 * Subscribe a React component to any core signal expression. Re-renders when its deps change
 * (anything `get` reads via `.get()` registers; `.peek()` reads do not).
 *
 * REFERENTIAL-STABILITY CONTRACT: `get` must return a primitive or a STABLE reference —
 * `useSyncExternalStore` compares snapshots with `Object.is`, so a getter that builds a fresh
 * array/object every call (e.g. `useValue(() => editor.selectedIdsArray())`) never compares equal
 * and re-renders forever. Select a primitive instead (`.size`, an id, a version counter) or derive
 * a string key (`ids.join(',')`) and parse outside the getter.
 */
export function useValue<T>(get: () => T): T {
  const getRef = useRef(get);
  getRef.current = get;
  const subscribe = useCallback(
    (onChange: () => void): Dispose => effect(() => {
      getRef.current();
      onChange();
    }),
    [],
  );
  // Signals are DOM-free, so the same peek serves the client snapshot AND the server snapshot
  // (third arg). Without getServerSnapshot, React 18 throws "Missing getServerSnapshot" on any
  // server render, taking down every panel that reads engine state.
  const snapshot = useCallback((): T => getRef.current(), []);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
