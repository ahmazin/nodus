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
  return useSyncExternalStore(subscribe, () => getRef.current());
}
