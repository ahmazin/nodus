# @ahmazin/icons-cloud

Cloud-provider icon packs (AWS, Azure, GCP) for Nodus, registered into `@ahmazin/core`'s icon
registry as namespaced `provider:service` glyphs (e.g. `aws:lambda`, `azure:functions`,
`gcp:run`).

This package commits a **curated subset** of each provider's official service icons — the
~90 most-diagrammed services — under `svg/<provider>/`, together with the compact `VectorIcon`
"packs" (`src/generated/*-pack.ts`) generated from them. The icons are used under each provider's
architecture-icon terms, which permit use in architecture diagrams. The full downloaded toolkits
are **not** committed — only the specific files referenced by `src/allowlist.ts`.

> **Using these icons carries obligations.** Each provider's icons are that provider's own
> artwork and trademarks, distributed under that provider's own terms (see `NOTICE` and
> `LICENSES/{aws,azure,gcp}.md`). Nothing in this repository's LICENSE grants you rights to
> those trademarks or artwork. Review each provider's current icon terms before redistributing
> this package or building on the curated subset.

## Curation policy

`src/allowlist.ts` is the single source of truth for which `provider:service` names exist and
which source file each is converted from. Curation favors the primary/current icon per service
(Classic/deprecated variants are excluded) across compute, containers, storage, database,
networking, integration, security, analytics, AI, and management.

- **AWS** uses the 48px architecture tiles (self-contained colored square + white glyph).
- **Azure** and **GCP** use the transparent-background service glyphs.
- `needsChip: true` may be set on any low-contrast glyph that would wash out on a dark tile.

## Adding or regenerating icons

1. **Download the toolkits yourself** (accepting each provider's current icon terms) and drop the
   bulk archives under `vendor/icons/<provider>/` (gitignored):
   - AWS Architecture Icons: https://aws.amazon.com/architecture/icons/
   - Azure Architecture Icons: https://learn.microsoft.com/en-us/azure/architecture/icons/
   - Google Cloud icons: https://cloud.google.com/icons

2. **Add entries to `src/allowlist.ts`**, each `AllowEntry.file` matching a vendored file name
   exactly, then copy just those files into `packages/icons-cloud/svg/<provider>/` (only the
   allowlisted subset is committed — never dump a whole toolkit here).

3. **Run the codegen CLI**:

   ```sh
   pnpm build:icons
   ```

   This reads `src/allowlist.ts`, converts each SVG under `svg/<provider>/` into a compact
   `VectorIcon` via `src/codegen/svg-to-vector.ts`, and writes `src/generated/{aws,azure,gcp}-pack.ts`
   plus `provenance.json` (which source file each generated icon came from). If any allowlisted
   source file is missing under `svg/<provider>/`, the script prints the missing list and exits
   non-zero **without writing anything**.

4. **Verify**: `pnpm typecheck && pnpm test && pnpm gallery`, then eyeball
   `examples/output/gallery/cloud-icons.png`. The `integrity` test guarantees the committed packs
   and `provenance.json` stay in lockstep with `src/allowlist.ts`.

## License note

See `NOTICE` and `LICENSES/{aws,azure,gcp}.md`. You are responsible for reviewing and complying
with each provider's terms before redistributing anything derived from their icons.
