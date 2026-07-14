/**
 * Property / fuzz tests for the core invariants a robust library must never break:
 *   1. store ↔ scene-index bijection (every node/edge has exactly one RenderItem, no orphans)
 *   2. no dangling edge endpoints and no dangling parentId, ever
 *   3. undo-all → empty document, then redo-all → the exact prior document (undo∘redo = identity)
 *   4. fromJSON(toJSON(state)) is structurally identical (sans per-record version)
 * A seeded PRNG makes any failure reproducible from its seed.
 */
import { describe, expect, it } from 'vitest';
import { Editor, stableStringify, type EdgeRecord, type Id, type NodeRecord } from '../index.js';

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Canonical document string, stripped of per-record `version` (which legitimately differs after
 *  undo). Uses the production `stableStringify` (promoted from this test's former local `stable`),
 *  so this fuzz suite doubles as the regression guard for that promotion. */
function canon(ed: Editor): string {
  const recs = ed.store
    .allRecords()
    .filter((r) => r.typeName === 'node' || r.typeName === 'edge')
    .map(({ version, ...r }) => r as Record<string, unknown>)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return stableStringify(recs);
}

function assertConsistent(ed: Editor, label: string): void {
  const recIds = new Set<Id>([...ed.store.nodes(), ...ed.store.edges()].map((r) => r.id));
  const itemIds = new Set<Id>(ed.sceneIndex.all().map((i) => i.id));
  expect(itemIds, `${label}: scene-index ↔ store bijection`).toEqual(recIds);
  for (const e of ed.store.edges() as EdgeRecord[]) {
    for (const side of [e.from, e.to]) {
      if (side.kind === 'node' || side.kind === 'outline') {
        expect(ed.store.has(side.nodeId), `${label}: edge ${e.id} points at a missing node ${side.nodeId}`).toBe(true);
      }
    }
  }
  for (const n of ed.store.nodes() as NodeRecord[]) {
    if (n.parentId) expect(ed.store.has(n.parentId), `${label}: node ${n.id} has a dangling parentId`).toBe(true);
  }
}

function pick<T>(rand: () => number, arr: T[]): T | undefined {
  return arr.length ? arr[Math.floor(rand() * arr.length)] : undefined;
}

describe('core invariants (fuzz)', () => {
  for (const seed of [1, 7, 42, 99, 1234, 55555, 987654, 2_000_000_011]) {
    it(`seed ${seed}: index bijection + no dangling refs + undo∘redo identity`, () => {
      const rand = mulberry32(seed);
      const ed = new Editor();

      for (let step = 0; step < 60; step++) {
        const nodes = ed.store.nodes();
        const edges = ed.store.edges();
        const op = Math.floor(rand() * 7);
        if (op === 0 || nodes.length < 2) {
          ed.createNode({ type: 'rect', x: Math.floor(rand() * 800), y: Math.floor(rand() * 600) });
        } else if (op === 1) {
          const n = pick(rand, nodes)!;
          ed.updateNode(n.id, { x: Math.floor(rand() * 800), y: Math.floor(rand() * 600) });
        } else if (op === 2) {
          const n = pick(rand, nodes)!;
          ed.setStyle([n.id], { stroke: rand() > 0.5 ? '#ef4444' : '#10b981' });
        } else if (op === 3) {
          const a = pick(rand, nodes)!;
          const b = pick(rand, nodes)!;
          if (a.id !== b.id) ed.connect({ kind: 'outline', nodeId: a.id }, { kind: 'outline', nodeId: b.id });
        } else if (op === 4) {
          const victim = pick(rand, [...nodes, ...edges]);
          if (victim) ed.deleteRecords([victim.id]);
        } else if (op === 5) {
          const a = pick(rand, nodes)!;
          const b = pick(rand, nodes.filter((n) => n.id !== a.id));
          if (b) ed.group([a.id, b.id]);
        } else {
          const grp = nodes.find((n) => n.type === 'group');
          if (grp) ed.ungroup(grp.id);
        }
        assertConsistent(ed, `seed ${seed} step ${step}`);
      }

      // round-trip identity (sans version)
      const before = canon(ed);
      const reloaded = new Editor();
      reloaded.loadSnapshot(ed.toJSON());
      expect(canon(reloaded), `seed ${seed}: toJSON→loadSnapshot identity`).toBe(before);
      assertConsistent(reloaded, `seed ${seed} reloaded`);

      // undo everything → empty; redo everything → back to `before` (undo∘redo = identity)
      let guard = 0;
      while (ed.history.canUndo() && guard++ < 500) ed.undo();
      assertConsistent(ed, `seed ${seed} fully-undone`);
      expect(canon(ed), `seed ${seed}: undo-all empties the document`).toBe('[]');
      guard = 0;
      while (ed.history.canRedo() && guard++ < 500) ed.redo();
      assertConsistent(ed, `seed ${seed} fully-redone`);
      expect(canon(ed), `seed ${seed}: redo-all restores the document`).toBe(before);
    });
  }
});
