import { describe, expect, it } from 'vitest';
import { ALLOWLIST } from '../allowlist.js';

describe('allowlist', () => {
  it('has unique canonical names matching provider:service', () => {
    const names = new Set<string>();
    for (const e of ALLOWLIST) {
      expect(e.name, `${e.name} format`).toBe(`${e.provider}:${e.service}`);
      expect(names.has(e.name), `duplicate ${e.name}`).toBe(false);
      names.add(e.name);
    }
  });
  it('covers all three providers', () => {
    const provs = new Set(ALLOWLIST.map((e) => e.provider));
    expect(provs).toEqual(new Set(['aws', 'azure', 'gcp']));
  });
});
