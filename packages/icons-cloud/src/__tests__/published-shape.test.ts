/**
 * Publish-safety invariant for the option-2 licensing model (PRE-PUBLICATION-AUDIT.md H4).
 *
 * The committed `src/generated/*-pack.ts` — the ONLY source the package's `tsup` build compiles
 * into the shipped `dist/` — MUST be empty placeholders, so the published npm tarball redistributes
 * NO AWS/Azure/GCP provider artwork. Real packs are a transient local build artifact produced by
 * `pnpm build:icons` (see integrity.test.ts, which validates that pipeline directly).
 *
 * This test FAILS if real artwork has been committed into the generated packs — including the
 * common footgun of running `pnpm build:icons` and then committing its output. That is the guard:
 * do not commit regenerated packs. (Running build:icons locally makes this fail until you revert
 * the generated files, mirroring the "trust committed bytes" gallery/PNG convention.)
 */
import { describe, expect, it } from 'vitest';
import { awsPack } from '../generated/aws-pack.js';
import { azurePack } from '../generated/azure-pack.js';
import { gcpPack } from '../generated/gcp-pack.js';
import { installCloudIcons } from '../index.js';
import { getIcon } from '@nodus-dev/core';

const committed = { aws: awsPack, azure: azurePack, gcp: gcpPack } as const;

describe('published shape ships placeholder (empty) packs — no provider artwork', () => {
  for (const p of ['aws', 'azure', 'gcp'] as const) {
    it(`${p} committed pack is empty`, () => {
      expect(
        Object.keys(committed[p]).length,
        `${p} pack must be an empty placeholder in the committed tree — did you commit \`pnpm build:icons\` output?`,
      ).toBe(0);
    });
  }

  it('installCloudIcons() over placeholder packs registers nothing and does not throw', () => {
    expect(() => installCloudIcons()).not.toThrow();
    // No provider glyph resolves from the placeholder packs alone.
    expect(getIcon('aws:ec2')).toBeUndefined();
  });
});
