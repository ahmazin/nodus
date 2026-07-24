import { useEffect, useLayoutEffect } from 'react';

/**
 * `useLayoutEffect` on the client, `useEffect` on the server. React logs a warning when
 * `useLayoutEffect` runs during server rendering (there is no layout to read synchronously), so
 * SSR-safe code selects the effect variant by whether a DOM is present. The callback still runs
 * synchronously after paint in the browser; on the server it is simply skipped, exactly like every
 * other effect.
 */
export const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;
