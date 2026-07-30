# @ahmazin/mcp

## 0.2.0

### Minor Changes

- 9770244: API contract remediation (audit F1–F45). Breaking under the 0.x policy (a minor may break):

  - **Dependency topology**: `@ahmazin/core` is now a `peerDependency` of every extension package (published as `^0.1.0` ranges, never exact pins); install core alongside any preset/layout/plugin.
  - **Errors**: one façade convention — programmer errors throw a typed `NodusError` (dual-package-safe `isNodusError()` guard), stale-id helpers return `boolean`, third-party faults route to the typed `error` event. `createNode`/`connect` now **throw** on unregistered types (previously silent). Importers/persistence share the namespaced-code convention.
  - **Events**: closed `NodusEventMap` with typed `on()` narrowing; `custom:*` escape hatch; handler isolation; warnings no longer hit the console by default.
  - **Ids**: `sessionIdFactory()` (collision-resistant session-prefixed ids) is the default; `makeId`/`seedIdCounter` are internal. Injectable via `EditorOptions.idFactory`; `deterministicIdFactory()` for reproducible fixtures.
  - **Serialization**: files with a newer `schemaVersion` are **refused** (`schema-too-new`) instead of silently downgraded; `loadSnapshot` returns a `LoadReport`; golden byte fixtures pin the canonical format (byte changes are breaking).
  - **Migrations**: `Migration` is now `{ id, migrate }` with append-only validation (positional arrays throw).
  - **Extensibility**: plugin install is idempotent + fully reversible (register\* return `Dispose`); `CommandRegistry`; `registerBeforeApply` interception; `capabilitiesOf()` merge point (`canRotate` honestly defaults false); `EditorOptions.readOnly` + `history.limit`; `editor.transaction()`; `applyRemote()`.
  - **React**: `useNodusEditor` survives StrictMode; SSR-safe (`'use client'` shipped); keyboard scoped to the host by default (`keyboardScope`); zero network by default (web fonts opt-in); `onMount`/`onChange`/`onSelectionChange`/`onCameraChange`; `forwardRef` `NodusHandle`.
  - **CLI**: `fmt` refuses lossy writes without `--force`; exit codes 0/1/2/3 are a contract; `diff` accepts `REV:path` git revs.

- 8458548: MCP audit remediation. Harden the JSON-RPC / stdio transport (a lone `null` / non-object line no longer wedges the read loop; add a `-32600` Invalid Request path, a serialization-queue rejection backstop, an `unhandledRejection` net, and protocol-version negotiation up to `2025-06-18`) and add seven tools: `import_terraform`, `import_kubernetes`, `diff_docs`, `update_edge`, `set_theme`, `export_svg`, and `author_from_spec`. Also register `tree` + `force` layouts (widening the `layout` / `import_mermaid` engine enums), clamp `export_png` `pixelRatio` to a safe range, surface ambiguous label references instead of silently picking the first match, coerce mistyped array args, and source `serverInfo.version` from `package.json`.

### Patch Changes

- Updated dependencies [9770244]
  - @ahmazin/core@0.2.0
  - @ahmazin/preset-infra@1.0.0
  - @ahmazin/preset-diagrams@1.0.0
  - @ahmazin/preset-draw@1.0.0
  - @ahmazin/layout-dagre@1.0.0
  - @ahmazin/layout-tree@1.0.0
  - @ahmazin/layout-force@1.0.0
  - @ahmazin/layout-elk@1.0.0
  - @ahmazin/import-infra@1.0.0
  - @ahmazin/from-mermaid@1.0.0
  - @ahmazin/text-to-diagram@1.0.0
