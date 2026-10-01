---
"@nodus-dev/react": patch
---

Support React 19. `useNodusEditor` now defers editor disposal to a microtask so React 19's StrictMode dev remount (a synchronous unmount→remount) keeps one live editor instead of stranding the component tree on a disposed instance — which was stopping the inline label editor from opening on double-click under React 19. Also switches to an importable `JSX` type (the global `JSX` namespace was removed in `@types/react` 19). Verified on both React 18 and React 19.
