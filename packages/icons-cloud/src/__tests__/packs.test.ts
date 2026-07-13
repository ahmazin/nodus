import { describe, expect, it } from 'vitest';
import { getIcon, getIconMeta } from '@nodus/core';
import { installCloudIcons, installPack } from '../index.js';

function stubCtx() {
  return {
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {},
    closePath() {}, fill() {}, fillStyle: '',
  } as unknown as Parameters<NonNullable<ReturnType<typeof getIcon>>>[0];
}

describe('cloud icon packs', () => {
  it('registers namespaced provider icons that render without throwing', () => {
    installCloudIcons();
    for (const name of ['aws:lambda', 'azure:functions', 'gcp:run']) {
      const draw = getIcon(name);
      expect(draw, name).toBeTypeOf('function');
      expect(() => draw!(stubCtx(), 0, 0, 40, '#fff')).not.toThrow();
    }
  });

  it('carries needsChip metadata through registration when set', () => {
    installCloudIcons();
    // fixture icons have no needsChip; real packs may. Just assert the lookup path works.
    expect(getIconMeta('aws:lambda')).toBeUndefined();
  });

  it('passes needsChip: true through installPack for icons that declare it', () => {
    installPack({
      'test:chip': { vb: [10, 10], sub: [{ fill: '#fff', cmds: [0, 0, 0, 1, 10, 10, 3] }], needsChip: true },
    });
    expect(getIconMeta('test:chip')?.needsChip).toBe(true);
  });
});
