# @nodus/persistence

Document persistence for [Nodus](../../README.md): debounced autosave plus named documents over a
pluggable `DocStore`. Because `@nodus/core` already serializes to a versioned `Snapshot` with
defensive restore, this is a thin, trustworthy layer — it saves `editor.toJSON()` and loads it back.

Three `DocStore` implementations ship in the box:

- `HttpDocStore(baseUrl)` — talks to a doc HTTP API; writes **canonical** bytes for clean git diffs.
- `LocalDocStore(prefix?)` — `localStorage`, for crash recovery.
- `MemoryDocStore()` — in-memory, for tests.

## Install

```bash
pnpm add @nodus/persistence @nodus/core
```

## Usage

```ts
import { autosave, loadDoc, LocalDocStore } from '@nodus/persistence';

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
storage.

## Exports

`autosave(editor, store, name, opts?)`, `loadDoc(editor, store, name, opts?)`, the stores
`HttpDocStore` / `LocalDocStore` / `MemoryDocStore`, and the `DocStore`, `DocMeta`, `AutosaveOptions`
types.

## See also

- [`@nodus/core`](../core/README.md) — the `Snapshot` format and `toJSON` / `loadSnapshot`.
- [`docs/EXTENDING.md`](../../docs/EXTENDING.md)

**Stability: pre-1.0 (0.x) — the public API may change before 1.0.**
</content>
