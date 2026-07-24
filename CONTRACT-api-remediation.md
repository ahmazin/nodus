# Team Contract — API Contract Remediation

**Branch:** `team/api-contracts` · **Baseline:** `ac0e000203acebc12d07b66d18b503cdc862b97e` (mainline)
**Source of truth:** `API-CONTRACTS-AUDIT.md` (findings F1–F45) + the approved remediation plan (task descriptions carry the relevant design excerpts).
**Recovery:** `git reset --hard ac0e000` — never incremental unpicking.

## The façade convention (governs every lane)

> A synchronous programmer error (unknown registered type, unsupported file, use-after-dispose) THROWS a typed `NodusError`; an expected empty outcome (stale/missing id) RETURNS `boolean`/`null`; an async or third-party fault (listener, event handler, plugin, flow poll, paint/effect throw) is ROUTED to the `error` EVENT, never thrown.

## Frozen shared contracts (changing any of these requires messaging the lead AND every affected owner)

### Errors — `@nodus/core/src/errors/index.ts` (new)
```ts
export type NodusErrorCode =
  | 'unknown-node-type' | 'unknown-edge-type' | 'unknown-layout' | 'unknown-command'
  | 'invalid-util' | 'invalid-migrations' | 'invalid-props'
  | 'schema-too-new' | 'invalid-snapshot'
  | 'editor-disposed' | 'plugin-install-failed'
  | 'reentrant-apply' | 'apply-in-transaction';
export class NodusError<C extends string = NodusErrorCode> extends Error {
  readonly brand: '@nodus/core:NodusError';   // dual-package-safe discriminant — never instanceof
  readonly code: C;
  readonly context?: Record<string, unknown>;
  constructor(code: C, message: string, opts?: { context?: Record<string, unknown>; cause?: unknown });
}
export function isNodusError(e: unknown): e is NodusError<string>;
```
Package-scoped codes elsewhere use a slash namespace, e.g. `'persistence/load-failed'`.

### Events — `@nodus/core/src/events/index.ts`
```ts
export interface ErrorEventContext {
  phase: 'listener'|'duplicate-add'|'build'|'non-finite'|'missing-util'
       |'plugin'|'register'|'flow'|'paint'|'effect'|'layout'|'before-apply'|'load';
  // 'load' added 2026-07-24 (lead-authorized amendment): serialization issues forwarded
  // during hydrateSnapshot use phase 'load' (previously shoehorned into 'build').
  [k: string]: unknown;
}
export interface NodusEventMap {
  change: { info: ChangeInfo }; selection: { ids: Id[] }; camera: { camera: Camera };
  hover: { id: Id | null }; 'edit:start': { id: Id }; 'edit:end': { id: Id; committed: boolean };
  tool: { id: string }; theme: { name: string };
  error: { error: unknown; context: ErrorEventContext; severity: 'error' | 'warning' };
  'document:load': { source: 'load' | 'reset'; recordCount: number; report?: LoadReport };
}
export type NodusEvent =
  | { [K in keyof NodusEventMap]: { type: K } & NodusEventMap[K] }[keyof NodusEventMap]
  | ({ type: `custom:${string}` } & Record<string, unknown>);
// on() overloads narrow by key; EventBus isolates handler throws (recursion-guarded re-surface on 'error').
```

### Ids — `@nodus/core/src/ids/index.ts` (new)
```ts
export interface IdFactory {
  make<T extends string>(typeName: T, seed?: string): Id<T>;
  seed(ids: Iterable<string>): void;
}
export function sessionIdFactory(): IdFactory;        // default: node:<4char-random>-<counter b36>
export function deterministicIdFactory(): IdFactory;  // legacy-byte-compatible (golden fixtures)
```
`makeId`/`seedIdCounter` become `@internal` and leave the public barrel.

### Interception — `@nodus/core/src/store/index.ts`
```ts
export type BeforeApply =
  (changes: readonly Change[], ctx: { source: ChangeSource }) => Change[] | null | void;
// registration-order fold · null vetoes · void passes through · throwing interceptor isolated+reported
// runs BEFORE the transact loop · reentrant apply throws 'reentrant-apply'
registerBeforeApply(fn: BeforeApply): Dispose;
onReset(fn: (info: { records: NodusRecord[]; reason: 'load' }) => void): Dispose;
```
`ApplyOptions` gains `intercept?: boolean` (default true; undo/redo/applyRemote pass false).

### Commands — `@nodus/core/src/commands/index.ts` (new)
```ts
export interface Command<A = unknown> {
  id: string; label: string;
  run(editor: Editor, args?: A): void | Promise<void>;
  enabled?(editor: Editor): boolean;
}
// CommandRegistry: register/get/list/isEnabled/execute (unknown id throws 'unknown-command'; disabled → no-op)
// Editor.commands + installDefaultCommands(editor); EngineHost.registerCommand
```

### Migrations — `@nodus/core/src/registries/index.ts`
```ts
export interface Migration<P extends Record<string, unknown> = Record<string, unknown>> {
  id: string;               // stable, unique per type; APPEND-ONLY (prefix rule on re-register)
  migrate(props: P): P;
}
// version === migrations.length (unchanged semantics)
```

### Editor lifecycle
`editor.disposed: boolean` · `dispose()` idempotent, additionally: cancel pan momentum, `animClock.clear()`, exit active tool, null layer cache, disposers in REVERSE order · `assertLive()` throws `'editor-disposed'` at pointer/key/load/history/paint entry points.
`editor.transaction(fn)` = ambient `capture:'later'` + `mark()` → one undo entry. `store.apply` inside a raw `transact()` throws `'apply-in-transaction'`.
`editor.applyRemote(changes)` = `apply(changes, { source:'remote', capture:'never', intercept:false })`; History skips `source==='remote'`.
`loadSnapshot(snap, opts?): LoadReport` where `LoadReport = { droppedEdges: number; migrationErrors: number; unmigrated: number; repointedPageRefs: number; issues: SerializationIssue[] }`.

### Serialization
`restore()` THROWS `NodusError('schema-too-new')` only for well-formed `schemaVersion > SCHEMA_VERSION`; malformed versions still best-effort repair with `bad-schema-version` issue. New issue code `'invalid-snapshot'` (null/non-object input → empty result + issue, no raw TypeError).

### CLI exit codes (fmt; render/diff/drift adopt 3)
`0` clean · `1` would-reformat (check mode) · `2` lossy-refused (file untouched; `--force` overrides + prints loss) · `3` newer-file (schema-too-new → "upgrade the CLI").

### Packaging (Part B policy)
Class A (13 extension libs): `@nodus/core` → `peerDependencies: "workspace:^"` + `devDependencies: "workspace:*"`; companion @nodus deps stay `dependencies` at `workspace:^`. Class B (react): peer specifiers → `workspace:^`. Class C (cli/mcp): keep hard deps, de-pin to `workspace:^`. All 18 publishConfigs get per-condition types (`import`→`.d.ts`, `require`→`.d.cts`, types first) + `"./package.json"` export + repository{url,directory}/homepage/bugs (parameterized; `OWNER` placeholder rejected by verify-dist) + `engines.node >=20`.

## Ownership map (one writer per path)

| Owner | Paths |
|---|---|
| **lead** (this session) | all `packages/*/package.json`, root `package.json`, `pnpm-*.yaml`, `.github/workflows/**`, `scripts/**`, `.changeset/**`, `CONTRACT-api-remediation.md`, all git write ops |
| **core** | `packages/core/src/**` (editor, store, signals, events, errors, ids, commands, registries, plugins, serialization, scene-index, renderer, icons, builtins, history, tools, model.ts) + `packages/core/README.md` |
| **react** | `packages/react/src/**`, `packages/react/tsup.config.ts` (banner change routed through lead at integration), `packages/react/README.md`, `examples/browser/src/**` (StrictMode hook switch), `scripts/browser-verify.mjs` → *exception: browser-verify edits coordinated with lead (scripts/ is lead-owned; react lane submits the diff via task report)* |
| **cli** | `packages/cli/src/**`, `packages/cli/README.md` |
| **persistence** | `packages/persistence/src/**`, `packages/persistence/README.md` |
| **presets** | `packages/preset-*/src/**`, `packages/plugin-freehand/src/**`, `packages/layout-*/src/**`, importer packages `src/**` + their READMEs |
| **docs** | `apps/site/**`, root `README.md`, `docs/**` (new), `examples/minimal-*/**`, remaining `packages/*/README.md` |
| **fixtures** | `packages/core/src/__tests__/fixtures/**`, `packages/core/src/__tests__/golden-fixtures.test.ts`, `scripts/gen-fixtures.ts` (script file routed through lead) |

## Gates (every task, owned scope)
`pnpm typecheck` (whole repo, read-only) · owned tests: `pnpm exec vitest run <owned paths>` · every new contract lands with a test that fails without it · no console.log/debug leftovers · no swallowed errors · public-interface changes update TSDoc + README. Lead runs the full suite (`pnpm test`, `verify:render`, `verify:dist`, browser suites) at integration checkpoints. NEVER weaken or delete a test to pass — message the lead (the one sanctioned rewrite: `hardening.test.ts` schema-999 case per locked decision F5).
