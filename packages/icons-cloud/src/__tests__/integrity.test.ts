/**
 * Integrity gate for the icon SOURCE + CODEGEN (`pnpm build:icons`).
 *
 * Under the option-2 licensing model (PRE-PUBLICATION-AUDIT.md H4) the committed
 * `src/generated/*-pack.ts` are EMPTY placeholders — no provider artwork ships in the tarball
 * (see published-shape.test.ts for that invariant). Real packs are (re)generated on demand from
 * committed `svg/**` by the same conversion the CLI uses. So this suite validates that pipeline
 * DIRECTLY — running `svgToVectorIcon` over every allowlisted SVG — rather than the (empty)
 * generated packs. It therefore proves "build:icons would populate real, valid packs" and still
 * catches a missing source SVG, a bad conversion, or an unresolved (gray-fallback) paint —
 * regardless of whether a maintainer has run build:icons locally.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getIcon } from '@nodus-dev/core';
import { ALLOWLIST } from '../allowlist.js';
import { svgToVectorIcon } from '../codegen/svg-to-vector.js';
import { installPack } from '../install.js';
import { cloudIconCatalog } from '../catalog.js';

const svgPath = (provider: string, file: string): string =>
  fileURLToPath(new URL(`../../svg/${provider}/${file}`, import.meta.url));

/** The pack build:icons would emit — computed here from committed svg/ + allowlist. */
function buildPack(provider: 'aws' | 'azure' | 'gcp'): Record<string, ReturnType<typeof svgToVectorIcon>['icon']> {
  const pack: Record<string, ReturnType<typeof svgToVectorIcon>['icon']> = {};
  for (const e of ALLOWLIST) {
    if (e.provider !== provider) continue;
    const { icon } = svgToVectorIcon(readFileSync(svgPath(e.provider, e.file), 'utf8'));
    if (e.needsChip) icon.needsChip = true;
    pack[e.name] = icon;
  }
  return pack;
}

describe('source + codegen (build:icons) produces valid real packs', () => {
  it('converts exactly one valid icon per allowlist entry — every source SVG present & non-empty', () => {
    for (const e of ALLOWLIST) {
      const { icon } = svgToVectorIcon(readFileSync(svgPath(e.provider, e.file), 'utf8'));
      expect(icon.sub.length, `${e.name} (${e.file}) converted to no geometry`).toBeGreaterThan(0);
      expect(icon.vb[0], `${e.name} viewBox width`).toBeGreaterThan(0);
      expect(icon.vb[1], `${e.name} viewBox height`).toBeGreaterThan(0);
      for (const sp of icon.sub) {
        expect(sp.fill, `${e.name} empty fill`).toBeTruthy();
        expect(sp.fill, `${e.name} unresolved paint (gray fallback)`).not.toBe('#888888');
      }
    }
  });

  it('registers a codegen-produced (real-data) pack end to end through installPack', () => {
    const pack = buildPack('aws');
    expect(Object.keys(pack).length, 'aws pack size from svg').toBe(
      ALLOWLIST.filter((e) => e.provider === 'aws').length,
    );
    installPack(pack);
    for (const name of ['aws:ec2', 'aws:lambda', 'aws:s3']) {
      const draw = getIcon(name);
      expect(draw, name).toBeTypeOf('function');
    }
  });
});

describe('cloudIconCatalog', () => {
  it('mirrors the allowlist one-to-one (name/provider/service/category)', () => {
    expect(cloudIconCatalog.length).toBe(ALLOWLIST.length);
    const byName = new Map(cloudIconCatalog.map((c) => [c.name, c]));
    for (const e of ALLOWLIST) {
      const c = byName.get(e.name);
      expect(c, `${e.name} present in catalog`).toBeDefined();
      expect(c).toEqual({ name: e.name, provider: e.provider, service: e.service, category: e.category });
    }
  });
});
