# @nodus-dev/import-infra

## 1.0.0

### Minor Changes

- 3bbb8ce: Re-baseline all published packages onto a single synchronized pre-1.0 line: **0.3.0**.

  Previously the scope shipped mixed majors (`core`/`cli`/`mcp` at 0.2.0, everything else at
  1.0.0), which contradicted the "everything is pre-1.0" stability policy and left the
  `react → core` peer semantics undefined. Every `@nodus-dev/*` package now shares version
  `0.3.0`; internal peer/dependency ranges resolve to `^0.3.0` (minor-locked under 0.x).
  `@nodus-dev/icons-cloud` is also re-based to `0.3.0` and unheld for its option-2 (placeholder
  packs) publish.

  No API changes — this is a version-coherence release. Under 0.x, a minor may break.

  > Note: this file is a human-readable CHANGELOG record for the manual re-baseline. Do NOT run
  > `changeset version` against it — changesets can only bump versions up, so it would push the
  > 1.0.0 packages to 1.1.0 and re-introduce the mixed-version incoherence. The `version` fields
  > were set manually to `0.3.0`; publish is `changeset publish` only.

### Patch Changes

- Updated dependencies [3bbb8ce]
  - @nodus-dev/core@0.4.0
  - @nodus-dev/preset-infra@1.0.0

## 1.0.0

### Minor Changes

- 9770244: API contract remediation (audit F1–F45). Breaking under the 0.x policy (a minor may break):

  - **Dependency topology**: `@nodus-dev/core` is now a `peerDependency` of every extension package (published as `^0.1.0` ranges, never exact pins); install core alongside any preset/layout/plugin.
  - **Errors**: one façade convention — programmer errors throw a typed `NodusError` (dual-package-safe `isNodusError()` guard), stale-id helpers return `boolean`, third-party faults route to the typed `error` event. `createNode`/`connect` now **throw** on unregistered types (previously silent). Importers/persistence share the namespaced-code convention.
  - **Events**: closed `NodusEventMap` with typed `on()` narrowing; `custom:*` escape hatch; handler isolation; warnings no longer hit the console by default.
  - **Ids**: `sessionIdFactory()` (collision-resistant session-prefixed ids) is the default; `makeId`/`seedIdCounter` are internal. Injectable via `EditorOptions.idFactory`; `deterministicIdFactory()` for reproducible fixtures.
  - **Serialization**: files with a newer `schemaVersion` are **refused** (`schema-too-new`) instead of silently downgraded; `loadSnapshot` returns a `LoadReport`; golden byte fixtures pin the canonical format (byte changes are breaking).
  - **Migrations**: `Migration` is now `{ id, migrate }` with append-only validation (positional arrays throw).
  - **Extensibility**: plugin install is idempotent + fully reversible (register\* return `Dispose`); `CommandRegistry`; `registerBeforeApply` interception; `capabilitiesOf()` merge point (`canRotate` honestly defaults false); `EditorOptions.readOnly` + `history.limit`; `editor.transaction()`; `applyRemote()`.
  - **React**: `useNodusEditor` survives StrictMode; SSR-safe (`'use client'` shipped); keyboard scoped to the host by default (`keyboardScope`); zero network by default (web fonts opt-in); `onMount`/`onChange`/`onSelectionChange`/`onCameraChange`; `forwardRef` `NodusHandle`.
  - **CLI**: `fmt` refuses lossy writes without `--force`; exit codes 0/1/2/3 are a contract; `diff` accepts `REV:path` git revs.

### Patch Changes

- Updated dependencies [9770244]
  - @nodus-dev/core@0.2.0
  - @nodus-dev/preset-infra@1.0.0
