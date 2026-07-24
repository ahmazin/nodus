import { useCallback, useRef, useSyncExternalStore } from 'react';
import { effect, type Dispose } from '@nodus/core';

/** Subscribe a React component to any core signal expression. Re-renders when its deps change. */
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
