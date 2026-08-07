import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Editor, getIcon, type VectorIcon } from '@nodus-dev/core';
import { installDiagrams } from '@nodus-dev/preset-diagrams';
import { installCloudIcons, installPack } from '../index.js';
import { ALLOWLIST } from '../allowlist.js';
import { svgToVectorIcon } from '../codegen/svg-to-vector.js';

// Option-2: the committed packs are empty placeholders, so installCloudIcons() alone registers
// nothing. We register REAL glyphs via the same conversion `pnpm build:icons` runs (from committed
// svg/), so the iconNode-resolution behavior is exercised in every environment — not just after a
// maintainer has regenerated packs locally.
function realPackFor(...names: string[]): Record<string, VectorIcon> {
  const pack: Record<string, VectorIcon> = {};
  for (const name of names) {
    const e = ALLOWLIST.find((x) => x.name === name)!;
    const src = fileURLToPath(new URL(`../../svg/${e.provider}/${e.file}`, import.meta.url));
    pack[name] = svgToVectorIcon(readFileSync(src, 'utf8')).icon;
  }
  return pack;
}

describe('cloud icons on iconNode', () => {
  it('resolves a provider glyph for an icon node props.icon', () => {
    installPack(realPackFor('aws:lambda'));
    const ed = new Editor();
    installDiagrams(ed);

    const id = ed.createNode({ type: 'icon', x: 0, y: 0, props: { icon: 'aws:lambda' } });
    const rec = ed.store.nodes().find((n) => n.id === id);

    expect(rec?.props.icon).toBe('aws:lambda');
    expect(getIcon('aws:lambda')).toBeTypeOf('function');
  });

  it('resolves the azure and gcp glyphs too', () => {
    installPack(realPackFor('azure:functions', 'gcp:run'));
    expect(getIcon('azure:functions')).toBeTypeOf('function');
    expect(getIcon('gcp:run')).toBeTypeOf('function');
  });

  it('installCloudIcons() over the shipped placeholder packs is a no-op (registers nothing)', () => {
    expect(() => installCloudIcons()).not.toThrow();
    expect(getIcon('aws:ec2')).toBeUndefined();
  });
});
