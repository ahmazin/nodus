import { describe, expect, it } from 'vitest';
import { Editor, getIcon } from '@nodus/core';
import { installDiagrams } from '@nodus/preset-diagrams';
import { installCloudIcons } from '../index.js';

describe('cloud icons on iconNode', () => {
  it('resolves a provider glyph for an icon node props.icon', () => {
    installCloudIcons();
    const ed = new Editor();
    installDiagrams(ed);

    const id = ed.createNode({ type: 'icon', x: 0, y: 0, props: { icon: 'aws:lambda' } });
    const rec = ed.store.nodes().find((n) => n.id === id);

    expect(rec?.props.icon).toBe('aws:lambda');
    expect(getIcon('aws:lambda')).toBeTypeOf('function');
  });

  it('resolves the azure and gcp fixture glyphs too', () => {
    installCloudIcons();
    expect(getIcon('azure:functions')).toBeTypeOf('function');
    expect(getIcon('gcp:run')).toBeTypeOf('function');
  });
});
