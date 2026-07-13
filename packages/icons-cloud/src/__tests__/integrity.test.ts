/**
 * Integrity gate for the generated packs: guarantees the committed `src/generated/*-pack.ts` and
 * `provenance.json` stay in lockstep with `allowlist.ts`. Runs against the REAL generated packs, so
 * a stale/forgotten `pnpm build:icons` (missing icon, orphan, or gray-fallback color) fails here.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALLOWLIST } from '../allowlist.js';
import { awsPack } from '../generated/aws-pack.js';
import { azurePack } from '../generated/azure-pack.js';
import { gcpPack } from '../generated/gcp-pack.js';

const packs = { aws: awsPack, azure: azurePack, gcp: gcpPack } as const;

describe('generated pack integrity', () => {
  it('produces exactly one pack icon per allowlist entry — no missing, no orphans', () => {
    for (const e of ALLOWLIST) {
      const icon = packs[e.provider][e.name];
      expect(icon, `${e.name} missing from ${e.provider} pack — run pnpm build:icons`).toBeDefined();
      expect(icon!.sub.length, `${e.name} converted to no geometry`).toBeGreaterThan(0);
    }
    for (const p of ['aws', 'azure', 'gcp'] as const) {
      const allowed = new Set(ALLOWLIST.filter((e) => e.provider === p).map((e) => e.name));
      expect(Object.keys(packs[p]).length, `${p} pack size`).toBe(allowed.size);
      for (const key of Object.keys(packs[p])) {
        expect(allowed.has(key), `orphan ${key} not in allowlist`).toBe(true);
      }
    }
  });

  it('every icon carries a positive viewBox and real (non-fallback) fills', () => {
    for (const p of ['aws', 'azure', 'gcp'] as const) {
      for (const [name, icon] of Object.entries(packs[p])) {
        expect(icon.vb[0], `${name} viewBox width`).toBeGreaterThan(0);
        expect(icon.vb[1], `${name} viewBox height`).toBeGreaterThan(0);
        for (const sp of icon.sub) {
          expect(sp.fill, `${name} empty fill`).toBeTruthy();
          expect(sp.fill, `${name} unresolved paint`).not.toBe('#888888');
        }
      }
    }
  });

  it('provenance.json records every allowlist entry exactly once', () => {
    const prov = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../provenance.json', import.meta.url)), 'utf8'),
    ) as Array<{ name: string }>;
    expect(prov.length, 'provenance count').toBe(ALLOWLIST.length);
    const provNames = new Set(prov.map((p) => p.name));
    for (const e of ALLOWLIST) expect(provNames.has(e.name), `${e.name} absent from provenance`).toBe(true);
  });
});
