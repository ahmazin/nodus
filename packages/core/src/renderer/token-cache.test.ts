import { beforeEach, describe, expect, it } from 'vitest';
import { defaultLightTheme, defaultTheme, type NodeRecord } from '../index.js';
import { clearTokenCache, resolveTokensCached } from './token-cache.js';

function rec(over: Partial<NodeRecord> = {}): NodeRecord {
  return {
    id: 'node:a', typeName: 'node', version: 0, type: 'solid',
    x: 0, y: 0, w: 1, h: 1, z: '0', visual: { state: 'solid' }, props: {}, ...over,
  } as NodeRecord;
}

beforeEach(() => clearTokenCache());

describe('resolveTokensCached', () => {
  it('returns the identical token object for unchanged inputs', () => {
    const r = rec();
    const a = resolveTokensCached(defaultTheme, r);
    const b = resolveTokensCached(defaultTheme, r);
    expect(b).toBe(a); // memo hit — no recompute, no object churn
  });

  it('recomputes when record.version changes, then stabilizes at the new version', () => {
    const r = rec();
    const a = resolveTokensCached(defaultTheme, r);
    r.version = 1;
    const b = resolveTokensCached(defaultTheme, r);
    expect(b).not.toBe(a); // version guard invalidated the slot
    expect(resolveTokensCached(defaultTheme, r)).toBe(b); // cached again at v1
  });

  it('recomputes when the theme identity changes', () => {
    const r = rec();
    const dark = resolveTokensCached(defaultTheme, r);
    const light = resolveTokensCached(defaultLightTheme, r);
    expect(light).not.toBe(dark);
    expect(light.fill).not.toBe(dark.fill); // light vs dark genuinely resolve differently
  });

  it('recomputes when the visual state changes without a version bump', () => {
    const r = rec();
    const solid = resolveTokensCached(defaultTheme, r);
    r.visual = { state: 'accent' };
    const accent = resolveTokensCached(defaultTheme, r);
    expect(accent).not.toBe(solid);
    expect(accent.stroke).not.toBe(solid.stroke);
  });

  it('keeps separate slots per record object', () => {
    const r1 = rec({ id: 'node:1' as NodeRecord['id'] });
    const r2 = rec({ id: 'node:2' as NodeRecord['id'] });
    const a = resolveTokensCached(defaultTheme, r1);
    const b = resolveTokensCached(defaultTheme, r2);
    expect(resolveTokensCached(defaultTheme, r1)).toBe(a);
    expect(resolveTokensCached(defaultTheme, r2)).toBe(b);
  });
});
