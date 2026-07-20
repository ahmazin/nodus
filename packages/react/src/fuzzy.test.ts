import { describe, expect, it } from 'vitest';
import { fuzzyMatch, fuzzyRank } from './fuzzy.js';

describe('fuzzyMatch', () => {
  it('matches an exact string and scores it higher than any partial match', () => {
    const exact = fuzzyMatch('graph', 'Graph');
    const prefix = fuzzyMatch('graph', 'Graph View');
    const substring = fuzzyMatch('graph', 'Paragraph');
    expect(exact.matched).toBe(true);
    expect(prefix.matched).toBe(true);
    expect(substring.matched).toBe(true);
    // Exact whole-string match is the single best outcome for a query.
    expect(exact.score).toBeGreaterThan(prefix.score);
    expect(prefix.score).toBeGreaterThan(substring.score);
  });

  it('matches a non-contiguous subsequence ("gph" ⊂ "Graph")', () => {
    const m = fuzzyMatch('gph', 'Graph');
    expect(m.matched).toBe(true);
    expect(m.indices).toEqual([0, 3, 4]); // G_ra_p_h
    // A gapped subsequence scores below the contiguous prefix it lives in.
    expect(m.score).toBeLessThan(fuzzyMatch('gra', 'Graph').score);
  });

  it('rewards start-of-word matches (after a space)', () => {
    // "od" hits two word starts in "Open Doc" but sits mid-word in "Download".
    const wordStarts = fuzzyMatch('od', 'Open Doc');
    const midWord = fuzzyMatch('od', 'Download');
    expect(wordStarts.matched).toBe(true);
    expect(midWord.matched).toBe(true);
    expect(wordStarts.score).toBeGreaterThan(midWord.score);
  });

  it('rewards consecutive matches over scattered ones of the same length', () => {
    const consecutive = fuzzyMatch('op', 'Open'); // o,p adjacent
    const scattered = fuzzyMatch('op', 'Order Panel'); // o…p far apart
    expect(consecutive.score).toBeGreaterThan(scattered.score);
  });

  it('is case-insensitive', () => {
    expect(fuzzyMatch('GRAPH', 'graph').matched).toBe(true);
    expect(fuzzyMatch('gRaPh', 'GRAPH').matched).toBe(true);
    expect(fuzzyMatch('OD', 'Open Doc').score).toBe(fuzzyMatch('od', 'Open Doc').score);
  });

  it('does not match when characters are absent or out of order', () => {
    expect(fuzzyMatch('xyz', 'Graph').matched).toBe(false);
    expect(fuzzyMatch('gg', 'Graph').matched).toBe(false); // only one "g"
    expect(fuzzyMatch('hparg', 'Graph').matched).toBe(false); // reversed order
    expect(fuzzyMatch('xyz', 'Graph').score).toBe(0);
  });

  it('treats an empty or whitespace-only query as matching everything with score 0', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ matched: true, score: 0, indices: [] });
    expect(fuzzyMatch('   ', 'anything')).toEqual({ matched: true, score: 0, indices: [] });
  });
});

describe('fuzzyRank', () => {
  const items = ['Zoom to fit', 'Zoom in', 'Zoom out', 'Undo', 'Redo', 'Group selection'];

  it('filters out non-matches and orders by descending score', () => {
    // "od" scores differently across these (two word-starts > consecutive > scattered), so sort.
    const mixed = fuzzyRank('od', ['Download', 'Code', 'Open Doc'], (s) => s);
    expect(mixed.map((r) => r.item)).toEqual(['Open Doc', 'Code', 'Download']);
    for (let i = 1; i < mixed.length; i++) {
      expect(mixed[i - 1]!.score).toBeGreaterThanOrEqual(mixed[i]!.score);
    }
    // A query that only some items contain drops the rest entirely.
    const ranked = fuzzyRank('zoom', items, (s) => s);
    expect(ranked.every((r) => r.item.startsWith('Zoom'))).toBe(true);
    expect(ranked).toHaveLength(3);
  });

  it('keeps every item at score 0 in input order for an empty query (stable)', () => {
    const ranked = fuzzyRank('', items, (s) => s);
    expect(ranked.map((r) => r.item)).toEqual(items);
    expect(ranked.every((r) => r.score === 0)).toBe(true);
  });

  it('breaks score ties by original input order (stable sort)', () => {
    // Both start with "Zo" at the same position → identical scores; input order must win.
    const tie = ['Zoom Beta', 'Zoom Alpha'];
    const ranked = fuzzyRank('zo', tie, (s) => s);
    expect(ranked[0]!.score).toBe(ranked[1]!.score);
    expect(ranked.map((r) => r.item)).toEqual(['Zoom Beta', 'Zoom Alpha']);
  });

  it('ranks by the provided key selector', () => {
    const objs = [
      { id: 'a', title: 'Align left' },
      { id: 'b', title: 'Bring to front' },
      { id: 'c', title: 'Align right' },
    ];
    const ranked = fuzzyRank('align', objs, (o) => o.title);
    expect(ranked.map((r) => r.item.id)).toEqual(['a', 'c']);
  });
});
