/**
 * Pure, dependency-free fuzzy subsequence matcher + ranker for the command palette.
 *
 * No React, no DOM — fully unit-testable in the node env. A query matches a target when all of its
 * characters appear in the target in order (case-insensitive). The score rewards, in rough order of
 * weight: an exact whole-string match, matches at the start of a word (after a space / `-` / `_` /
 * `/` / `.` / `:` or a camelCase hump), consecutive runs of matched characters, matches at the very
 * start of the string, and matches that begin earlier in the target.
 *
 * The matcher is a single left-to-right greedy pass (each query character binds to its next
 * occurrence). That is simple, deterministic, and yields the matched indices for free — good enough
 * for short command titles; it is not a full optimal-alignment search.
 */

export interface FuzzyMatch {
  /** True when every query character was found in `target`, in order. */
  matched: boolean;
  /** Higher is a better match. `0` for an empty query; may be negative for a weak match. */
  score: number;
  /** Indices into `target` of the matched characters, in order. Present when `matched`. */
  indices?: number[];
}

export interface RankedItem<T> {
  item: T;
  score: number;
  indices?: number[];
}

// Scoring weights. Tuned (see fuzzy.test.ts) so an exact match dominates, a word-start match beats a
// mid-word one, and a tight consecutive run beats a scattered one.
const BASE = 1; // every matched character is worth at least this
const SEQUENTIAL_BONUS = 15; // matched char immediately follows the previous matched char
const WORD_START_BONUS = 10; // matched char begins a word
const FIRST_CHAR_BONUS = 8; // matched char is the very first character of the target
const LEADING_PENALTY = 2; // subtracted per character skipped before the first match…
const MAX_LEADING_PENALTY = 5; // …capped, so a late first match is not punished without bound
const EXACT_BONUS = 100; // query equals the entire target (case-insensitive)

/** Characters that end a word, so the next character begins a new one. */
const WORD_SEPARATORS = new Set([' ', '-', '_', '/', '.', ':', '\\', '(']);

/** Does `target[i]` begin a word — string start, after a separator, or a camelCase hump? */
function isWordStart(target: string, i: number): boolean {
  if (i === 0) return true;
  const prev = target[i - 1] ?? '';
  if (WORD_SEPARATORS.has(prev)) return true;
  // camelCase: a lower-case letter or digit followed by an upper-case letter starts a new word.
  const cur = target[i] ?? '';
  const prevIsLowerOrDigit = (prev >= 'a' && prev <= 'z') || (prev >= '0' && prev <= '9');
  const curIsUpper = cur >= 'A' && cur <= 'Z';
  return prevIsLowerOrDigit && curIsUpper;
}

/**
 * Score `query` against `target`. An empty (or whitespace-only) query matches everything with score
 * `0`; a query whose characters do not appear in order returns `{ matched: false, score: 0 }`.
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatch {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return { matched: true, score: 0, indices: [] };

  const t = target.toLowerCase();
  const indices: number[] = [];
  let score = 0;
  let qi = 0;
  let prevMatch = -2; // -2 so the first match can never read as "consecutive" (prevMatch + 1)

  for (let ti = 0; ti < target.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    let s = BASE;
    if (ti === prevMatch + 1) s += SEQUENTIAL_BONUS;
    if (isWordStart(target, ti)) s += WORD_START_BONUS;
    if (ti === 0) s += FIRST_CHAR_BONUS;
    if (indices.length === 0) s -= Math.min(ti, MAX_LEADING_PENALTY) * LEADING_PENALTY; // earlier is better
    score += s;
    indices.push(ti);
    prevMatch = ti;
    qi++;
  }

  if (qi < q.length) return { matched: false, score: 0 };
  if (q === t) score += EXACT_BONUS;
  return { matched: true, score, indices };
}

/**
 * Filter `items` to those whose `key` fuzzy-matches `query`, ranked by descending score. Ties are
 * broken by original input order (stable). An empty query keeps every item with score `0` in input
 * order.
 */
export function fuzzyRank<T>(query: string, items: T[], key: (t: T) => string): RankedItem<T>[] {
  const results: (RankedItem<T> & { i: number })[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as T;
    const m = fuzzyMatch(query, key(item));
    if (!m.matched) continue;
    results.push({ item, score: m.score, indices: m.indices, i });
  }
  results.sort((a, b) => b.score - a.score || a.i - b.i);
  return results.map(({ item, score, indices }) => ({ item, score, indices }));
}
