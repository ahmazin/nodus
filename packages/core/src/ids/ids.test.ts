/**
 * Instance id factory (task A6). `sessionIdFactory` gives each editor its OWN counter+prefix so two
 * editors mint disjoint ids (no module-global to collide over); `deterministicIdFactory` stays
 * byte-identical to the legacy `makeId` for fixtures. Each `it` fails on the pre-change (global) path.
 */
import { describe, expect, it, vi } from 'vitest';
import { sessionIdFactory, deterministicIdFactory, type IdFactory } from './index.js';
import { Store } from '../store/index.js';
import type { Id, NodeRecord } from '../model.js';

function mkNode(id: string): NodeRecord {
  return {
    id: id as Id<'node'>,
    typeName: 'node',
    version: 0,
    type: 'rect',
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    z: 'a0',
    visual: { state: 'solid' },
    props: {},
  };
}

describe('sessionIdFactory — per-instance isolation', () => {
  it('two instances mint DISJOINT ids for the same creation sequence', () => {
    const a = sessionIdFactory();
    const b = sessionIdFactory();
    const aIds = [a.make('node'), a.make('node'), a.make('edge')];
    const bIds = [b.make('node'), b.make('node'), b.make('edge')];
    // With a module-global counter these would interleave/collide; per-instance prefixes keep them apart.
    expect(new Set([...aIds, ...bIds]).size).toBe(aIds.length + bIds.length);
  });

  it('a keyed seed passes through verbatim as the suffix (stencil `n0`, façade key)', () => {
    const f = sessionIdFactory();
    expect(f.make('node', 'n0')).toBe('node:n0');
    expect(f.make('edge', 'e0')).toBe('edge:e0');
    expect(f.make('node', 's3-prod')).toBe('node:s3-prod');
  });

  it('seed() advances the counter past a same-prefix loaded id, preventing a post-load collision', () => {
    const f = sessionIdFactory();
    const first = f.make('node'); // node:<prefix>-0 ; counter now 1
    const prefix = first.slice('node:'.length, first.lastIndexOf('-'));
    // a reloaded doc already contains an id THIS factory could otherwise regenerate
    f.seed([`node:${prefix}-5`]);
    const next = f.make('node');
    expect(next).toBe(`node:${prefix}-6`); // jumped past 5, not back to counter 1
    expect(next).not.toBe(`node:${prefix}-5`);
  });

  it('seed() ignores ids with a different prefix (they can never collide with ours)', () => {
    const f = sessionIdFactory();
    const first = f.make('node'); // node:<prefix>-0
    const prefix = first.slice('node:'.length, first.lastIndexOf('-'));
    f.seed(['node:zzzz-9', 'node:someOtherKey', 'edge:abcd-3']); // none share our prefix
    expect(f.make('node')).toBe(`node:${prefix}-1`); // counter untouched → the next in sequence
  });
});

describe('deterministicIdFactory — legacy byte compatibility', () => {
  it('is byte-identical to the legacy module-global makeId for a fresh context', async () => {
    vi.resetModules(); // fresh model.js → counter 0
    const ids = await import('./index.js');
    // same expectation as model.identity.test.ts: counter 0 → `0` + `x` + hash
    expect(ids.deterministicIdFactory().make('node')).toBe('node:0x25xe7');
  });

  it('two deterministic factories SHARE the process counter (determinism over isolation)', async () => {
    vi.resetModules();
    const ids = await import('./index.js');
    const a = ids.deterministicIdFactory();
    const b = ids.deterministicIdFactory();
    const first = a.make('node');
    const second = b.make('node'); // continues the shared sequence, does not repeat `first`
    expect(second).not.toBe(first);
  });
});

describe('Store.load — id factory seed hook', () => {
  it('advances the injected factory past every id just loaded', () => {
    const seen: string[] = [];
    const factory: IdFactory = {
      make: <T extends string>(t: T) => `${t}:x` as Id<T>,
      seed: (ids) => {
        for (const i of ids) seen.push(i);
      },
    };
    const store = new Store({ idFactory: factory });
    store.load([mkNode('node:a'), mkNode('node:b')]);
    expect(seen).toEqual(expect.arrayContaining(['node:a', 'node:b']));
  });
});
