# Changelog

All notable changes to `@ahmazin/core` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This package is pre-1.0 and unpublished; breaking changes may land without a major bump.

## [Unreleased]

### Added

- Schema & custom-shape migrations: `Migration` on `NodeUtil`/`EdgeUtil`, `Snapshot.typeVersions`,
  and `restore()` migrates a document's records on load (fault-isolated per record).

### Changed

- **BREAKING:** `serializeRecords(records, meta?)` → `serializeRecords(records, { meta?,
  typeVersions? })`. The second parameter is now an options object instead of the bare `meta`
  value; callers passing `meta` positionally must wrap it as `{ meta }`.
