# @nodus-dev/persistence

Document persistence for [Nodus](../../README.md): debounced autosave plus named documents over a
pluggable `DocStore`. Because `@nodus-dev/core` already serializes to a versioned `Snapshot` with
defensive restore, this is a thin, trustworthy layer — it saves `editor.toJSON()` and loads it back.

Three `DocStore` implementations ship in the box:

- `HttpDocStore(baseUrl)` — talks to a doc HTTP API; writes **canonical** bytes for clean git diffs.
- `LocalDocStore(prefix?)` — `localStorage`, for crash recovery.
- `MemoryDocStore()` — in-memory, for tests.

## Install

```bash
pnpm add @nodus-dev/persistence @nodus-dev/core
```

## Usage

```ts
import { autosave, loadDoc, LocalDocStore } from '@nodus-dev/persistence';

const store = new LocalDocStore();

// restore a named doc (returns false if it doesn't exist):
await loadDoc(editor, store, 'my-diagram');

// debounced autosave — one save per burst of edits; returns a disposer:
const stop = autosave(editor, store, 'my-diagram', {
  debounceMs: 800,
  onSaved: (name) => console.log('saved', name),
});
// ... later: stop();   // flushes any pending edit, then detaches
```

`autosave` also flushes on `pagehide` so an edit made in the last debounce window is never dropped.
Implement the `DocStore` interface (`list` / `load` / `save` / `remove`) to back it with your own
storage — following the failure semantics below.

## Failure semantics

Every `DocStore` operation fails the same way, so an app can tell "empty" and "absent" apart from "the
request failed":

- A failed operation **throws** a `NodusError` (from `@nodus-dev/core`) with `code`
  `'persistence/<op>-failed'` — `persistence/list-failed`, `persistence/load-failed`,
  `persistence/save-failed`, `persistence/remove-failed` — and `context` `{ op, status, body? }`.
- `load(name)` returns `null` **only** when the document does not exist (HTTP 404); every other
  failure throws. So `null` is unambiguously "absent", never "the request failed".
- `list()` never swallows a failure into an empty array, and `remove()` never resolves a rejected
  delete (403/500) as success.

Match thrown errors with `isNodusError(e)` and branch on `e.code` / `e.context.status` — never
`instanceof` (it breaks across a duplicated `@nodus-dev/core`):

```ts
import { isNodusError } from '@nodus-dev/core';

try {
  await store.remove('my-diagram');
} catch (e) {
  if (isNodusError(e) && e.code === 'persistence/remove-failed') {
    console.error('delete rejected:', e.context); // { op: 'remove', status: 403, body? }
  }
}
```

## Exports

`autosave(editor, store, name, opts?)`, `loadDoc(editor, store, name, opts?)`, the stores
`HttpDocStore` / `LocalDocStore` / `MemoryDocStore`, and the `DocStore`, `DocMeta`, `AutosaveOptions`
types.

## See also

- [`@nodus-dev/core`](../core/README.md) — the `Snapshot` format and `toJSON` / `loadSnapshot`.
- [`docs/EXTENDING.md`](../../docs/EXTENDING.md)

**Stability: pre-1.0 (0.x) — the public API may change before 1.0.**
</content>
