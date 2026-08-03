/**
 * Pure-logic tests for the branch comparison. `computeBranch` is framework-free, so these run
 * headless (node env, no React render): build real `Snapshot`s from a headless `Editor` and assert
 * the line diff (`adds`/`dels`) and the record-level `semantic` diff stay in agreement.
 *
 * The reactive `useBranch` hook and the review UI are DOM/browser surface, covered by the Playwright
 * drive of the example app — not here.
 */

import { describe, expect, it } from 'vitest';
import { Editor } from '@nodus-dev/core';
import { computeBranch, pushVersion, type VersionEntry } from './use-branch.js';

function makeEditor(): Editor {
  return new Editor({ viewport: { w: 800, h: 600 } });
}

/** A minimal `VersionEntry` — `pushVersion` only touches ordering/length, not the snapshot payload. */
function makeVersion(id: string, at = 0): VersionEntry {
  return { id, label: `v-${id}`, at, snapshot: makeEditor().toJSON() };
}

describe('computeBranch', () => {
  it('reports a clean tree for a snapshot compared against itself', () => {
    const ed = makeEditor();
    ed.createNode({ type: 'rect', x: 10, y: 20, label: 'alpha' });
    const snap = ed.toJSON();

    const c = computeBranch(snap, snap);

    expect(c.dirty).toBe(false);
    expect(c.adds).toBe(0);
    expect(c.dels).toBe(0);
    expect(c.semantic.added).toHaveLength(0);
    expect(c.semantic.removed).toHaveLength(0);
    expect(c.semantic.changed).toHaveLength(0);
  });

  it('detects an added node (one semantic add, +lines, no dels)', () => {
    const ed = makeEditor();
    ed.createNode({ type: 'rect', x: 0, y: 0 });
    const baseline = ed.toJSON();

    ed.createNode({ type: 'rect', x: 200, y: 120, label: 'new' });
    const working = ed.toJSON();

    const c = computeBranch(baseline, working);

    expect(c.dirty).toBe(true);
    expect(c.semantic.added).toHaveLength(1);
    expect(c.semantic.removed).toHaveLength(0);
    expect(c.adds).toBeGreaterThanOrEqual(1);
    // NB: `dels` is not asserted 0 — if the new record sorts last, the previously-last record's
    // canonical line only differs by a trailing comma, which registers as 1 del + 1 add. The
    // deterministic signal is the semantic diff (added === 1, removed === 0) above.
  });

  it('detects a removed node (one semantic remove, -lines)', () => {
    const ed = makeEditor();
    ed.createNode({ type: 'rect', x: 0, y: 0, label: 'keep' });
    const doomed = ed.createNode({ type: 'rect', x: 300, y: 300, label: 'gone' });
    const baseline = ed.toJSON();

    ed.deleteRecords([doomed]);
    const working = ed.toJSON();

    const c = computeBranch(baseline, working);

    expect(c.dirty).toBe(true);
    expect(c.semantic.removed).toHaveLength(1);
    expect(c.semantic.added).toHaveLength(0);
    expect(c.dels).toBeGreaterThanOrEqual(1);
    // NB: `adds` is not asserted 0 — removing the last record turns the new-last record's canonical
    // line from `…,` to `…` (a trailing-comma flip), registering as 1 del + 1 add. The deterministic
    // signal is the semantic diff (removed === 1, added === 0) above.
  });

  it('detects an in-place field change as exactly one del + one add', () => {
    const ed = makeEditor();
    const id = ed.createNode({ type: 'rect', x: 0, y: 0, label: 'movable' });
    const baseline = ed.toJSON();

    ed.updateNode(id, { x: 999, y: 777 });
    const working = ed.toJSON();

    const c = computeBranch(baseline, working);

    expect(c.semantic.changed).toHaveLength(1);
    expect(c.semantic.changed[0]?.id).toBe(id);
    // canonical = one record per line, sorted by identity, so a single edited record is 1 del + 1 add
    expect(c.dels).toBe(1);
    expect(c.adds).toBe(1);
    expect(c.dirty).toBe(true);
  });

  it('keeps adds/dels/dirty in lock-step with the unified diff across every case', () => {
    const ed = makeEditor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const b = ed.createNode({ type: 'rect', x: 100, y: 100 });
    const baseline = ed.toJSON();

    // A mixed edit: add a node, remove one, and move another.
    ed.createNode({ type: 'rect', x: 400, y: 0 });
    ed.deleteRecords([b]);
    ed.updateNode(a, { x: 42 });
    const working = ed.toJSON();

    for (const [oldSnap, newSnap] of [
      [baseline, baseline],
      [baseline, working],
      [working, baseline],
    ] as const) {
      const c = computeBranch(oldSnap, newSnap);
      expect(c.adds).toBe(c.unified.adds);
      expect(c.dels).toBe(c.unified.dels);
      expect(c.dirty).toBe(c.adds + c.dels > 0);
    }

    // The mixed forward edit is genuinely dirty (sanity that the invariant isn't vacuously true).
    const fwd = computeBranch(baseline, working);
    expect(fwd.dirty).toBe(true);
    expect(fwd.semantic.added).toHaveLength(1);
    expect(fwd.semantic.removed).toHaveLength(1);
    expect(fwd.semantic.changed).toHaveLength(1);
  });
});

describe('pushVersion', () => {
  it('prepends the newest entry (newest-first order)', () => {
    const a = makeVersion('a');
    const b = makeVersion('b');

    const list = pushVersion([a], b);

    expect(list.map((v) => v.id)).toEqual(['b', 'a']);
  });

  it('caps the list at the given length, dropping the oldest', () => {
    let list: VersionEntry[] = [];
    for (const id of ['a', 'b', 'c', 'd']) {
      list = pushVersion(list, makeVersion(id), 3);
    }

    // Newest-first and capped at 3, so the oldest ('a') fell off the end.
    expect(list).toHaveLength(3);
    expect(list.map((v) => v.id)).toEqual(['d', 'c', 'b']);
  });

  it('does not mutate the input array', () => {
    const a = makeVersion('a');
    const input = [a];

    const out = pushVersion(input, makeVersion('b'));

    expect(out).not.toBe(input);
    expect(input).toHaveLength(1);
    expect(input[0]).toBe(a);
  });
});
