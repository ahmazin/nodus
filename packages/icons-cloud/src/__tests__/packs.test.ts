import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getIcon, getIconMeta, type VectorIcon } from '@nodus-dev/core';
import { installCloudIcons, installPack } from '../index.js';
import { ALLOWLIST } from '../allowlist.js';
import { svgToVectorIcon } from '../codegen/svg-to-vector.js';

function stubCtx() {
  return {
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {},
    closePath() {}, fill() {}, fillStyle: '',
  } as unknown as Parameters<NonNullable<ReturnType<typeof getIcon>>>[0];
}

// Real glyphs, converted from committed svg/ the same way `pnpm build:icons` does. Used so the
// registration + draw path is exercised with real data even though the shipped packs are empty
// placeholders (option-2, PRE-PUBLICATION-AUDIT.md H4).
function realPackFor(...names: string[]): Record<string, VectorIcon> {
  const pack: Record<string, VectorIcon> = {};
  for (const name of names) {
    const e = ALLOWLIST.find((x) => x.name === name)!;
    const src = fileURLToPath(new URL(`../../svg/${e.provider}/${e.file}`, import.meta.url));
    pack[name] = svgToVectorIcon(readFileSync(src, 'utf8')).icon;
  }
  return pack;
}

describe('cloud icon packs', () => {
  it('installCloudIcons() over the shipped placeholder packs is a no-op that never throws', () => {
    expect(() => installCloudIcons()).not.toThrow();
    expect(getIcon('aws:lambda')).toBeUndefined();
  });

  it('registers namespaced provider glyphs that render without throwing (real data via codegen)', () => {
    installPack(realPackFor('aws:lambda', 'azure:functions', 'gcp:run'));
    for (const name of ['aws:lambda', 'azure:functions', 'gcp:run']) {
      const draw = getIcon(name);
      expect(draw, name).toBeTypeOf('function');
      expect(() => draw!(stubCtx(), 0, 0, 40, '#fff')).not.toThrow();
    }
  });

  it('passes needsChip: true through installPack for icons that declare it', () => {
    installPack({
      'test:chip': { vb: [10, 10], sub: [{ fill: '#fff', cmds: [0, 0, 0, 1, 10, 10, 3] }], needsChip: true },
    });
    expect(getIconMeta('test:chip')?.needsChip).toBe(true);
  });
});
