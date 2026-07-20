/**
 * Layers/outline engine foundation: per-node visibility (`hidden`), plus the visibility, lock, and
 * z-order editor methods a layers panel drives. The load-bearing invariants pinned here:
 *  - `hidden` is omit-when-false, so canonical `.nodus.json` bytes stay byte-stable (the git moat).
 *  - a hidden node stays in the document but is excluded from painting / hit-testing / marquee.
 *  - visibility, lock, and z-order ops are undoable and reachable as clean editor methods.
 */
import { describe, expect, it } from 'vitest';
import {
  Editor,
  restore,
  serializeRecords,
  toCanonicalString,
  type NodeRecord,
  type Snapshot,
} from '../index.js';

/** Two rects and an edge — mirrors the canonical suite's fixture so byte comparisons are meaningful. */
function build(): Editor {
  const ed = new Editor();
  ed.createNode({ type: 'rect', x: 100, y: 100 });
  ed.createNode({ type: 'rect', x: 300, y: 200 });
  const [a, b] = ed.store.nodes();
  ed.connect({ kind: 'outline', nodeId: a!.id }, { kind: 'outline', nodeId: b!.id });
  return ed;
}

describe('node visibility — canonical stability', () => {
  it('a. no hidden node ⇒ canonical bytes carry no "hidden" key', () => {
    const s = toCanonicalString(build().toJSON());
    expect(s).not.toContain('hidden');
  });

  it('a2. hide then show returns to byte-identical canonical output (omit-when-false)', () => {
    const ed = build();
    const before = toCanonicalString(ed.toJSON());
    const id = ed.store.nodes()[0]!.id;
    ed.setNodesHidden([id], true);
    expect(toCanonicalString(ed.toJSON())).not.toBe(before); // hiding does change the bytes
    ed.setNodesHidden([id], false);
    expect(toCanonicalString(ed.toJSON())).toBe(before); // clearing restores them exactly
  });

  it('b. hidden:true round-trips through restore → re-serialize and stays in canonical bytes', () => {
    const ed = build();
    const id = ed.store.nodes()[0]!.id;
    ed.setNodesHidden([id], true);
    const s1 = toCanonicalString(ed.toJSON());
    expect(s1).toContain('"hidden":true');

    const parsed = JSON.parse(s1) as Snapshot;
    const s2 = toCanonicalString(serializeRecords(restore(parsed).records));
    expect(s2).toBe(s1);
    const restored = restore(parsed).records.find((r) => r.id === id) as NodeRecord;
    expect(restored.hidden).toBe(true);
  });

  it('c. a loaded hidden:false normalizes away (no key, no bytes)', () => {
    const snap = build().toJSON();
    let injected = false;
    const withFalse: Snapshot = {
      ...snap,
      document: {
        records: snap.document.records.map((r) => {
          if (!injected && r.typeName === 'node') {
            injected = true;
            return { ...r, hidden: false };
          }
          return r;
        }),
      },
    };
    expect(injected).toBe(true); // the fixture really did carry a hidden:false
    const restored = restore(withFalse).records.find((r) => r.typeName === 'node') as NodeRecord;
    expect('hidden' in restored).toBe(false);
    // byte-identical to the same doc that never mentioned hidden
    expect(toCanonicalString(serializeRecords(restore(withFalse).records))).not.toContain('hidden');
  });
});

describe('setNodesHidden — mutation + undo', () => {
  it('sets hidden:true, clears the key on false, and is a single undoable step', () => {
    const ed = new Editor();
    const id = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
    expect(ed.isHidden(id)).toBe(false);

    ed.setNodesHidden([id], true);
    expect(ed.isHidden(id)).toBe(true);
    expect((ed.store.peek(id) as NodeRecord).hidden).toBe(true);

    ed.undo();
    expect(ed.isHidden(id)).toBe(false); // one undo restores visibility

    ed.setNodesHidden([id], true);
    ed.setNodesHidden([id], false);
    // cleared, not set to false, so serialization stays canonical
    expect('hidden' in (ed.store.peek(id) as NodeRecord)).toBe(false);
  });

  it('no-ops (no history entry) when nothing actually changes', () => {
    const ed = new Editor();
    const id = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const v = (ed.store.peek(id) as NodeRecord).version;
    ed.setNodesHidden([id], false); // already visible
    expect((ed.store.peek(id) as NodeRecord).version).toBe(v);
  });
});

describe('hidden nodes are excluded from hit-testing and marquee', () => {
  it('hitTest skips a hidden node but still hits a visible sibling', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const b = ed.createNode({ type: 'rect', x: 200, y: 0, w: 100, h: 100 });

    expect(ed.sceneIndex.hitTest({ x: 50, y: 50 })?.id).toBe(a);
    ed.setNodesHidden([a], true);
    expect(ed.sceneIndex.hitTest({ x: 50, y: 50 })).toBeNull(); // hidden — not pickable
    expect(ed.sceneIndex.hitTest({ x: 250, y: 50 })?.id).toBe(b); // sibling still pickable

    ed.setNodesHidden([a], false);
    expect(ed.sceneIndex.hitTest({ x: 50, y: 50 })?.id).toBe(a); // showing restores picking
  });

  it('enclosedNodes (marquee) omits a hidden node, keeps a visible sibling', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const b = ed.createNode({ type: 'rect', x: 200, y: 0, w: 100, h: 100 });
    const box = { x: -10, y: -10, w: 340, h: 140 };

    expect(new Set(ed.sceneIndex.enclosedNodes(box))).toEqual(new Set([a, b]));
    ed.setNodesHidden([a], true);
    expect(ed.sceneIndex.enclosedNodes(box)).toEqual([b]);
  });
});

describe('z-order editor methods', () => {
  const z = (ed: Editor, id: string): string => (ed.store.peek(id as NodeRecord['id']) as NodeRecord).z;

  it('bringForward / sendBackward move a node one step relative to its neighbors', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const b = ed.createNode({ type: 'rect', x: 10, y: 0 });
    const c = ed.createNode({ type: 'rect', x: 20, y: 0 });
    expect(z(ed, a) < z(ed, b) && z(ed, b) < z(ed, c)).toBe(true); // creation order: A < B < C

    ed.bringForward([a]); // A hops above B, still below C
    expect(z(ed, b) < z(ed, a)).toBe(true);
    expect(z(ed, a) < z(ed, c)).toBe(true);

    ed.sendBackward([a]); // back down past B → original relative order
    expect(z(ed, a) < z(ed, b)).toBe(true);
    expect(z(ed, b) < z(ed, c)).toBe(true);
  });

  it('bringToFront / sendToBack move a node to the extremes', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const b = ed.createNode({ type: 'rect', x: 10, y: 0 });
    const c = ed.createNode({ type: 'rect', x: 20, y: 0 });

    ed.bringToFront([a]);
    expect(z(ed, a) > z(ed, b) && z(ed, a) > z(ed, c)).toBe(true);

    ed.sendToBack([a]);
    expect(z(ed, a) < z(ed, b) && z(ed, a) < z(ed, c)).toBe(true);
  });
});

describe('lock toggle via the exposed method', () => {
  it('setNodesHidden is independent of lock; lock/unlock/isLocked round-trip', () => {
    const ed = new Editor();
    const id = ed.createNode({ type: 'rect', x: 0, y: 0 });
    expect(ed.isLocked(id)).toBe(false);
    ed.lock([id]);
    expect(ed.isLocked(id)).toBe(true);
    // hiding a locked node is orthogonal — both flags coexist
    ed.setNodesHidden([id], true);
    expect(ed.isLocked(id)).toBe(true);
    expect(ed.isHidden(id)).toBe(true);
    ed.unlock([id]);
    expect(ed.isLocked(id)).toBe(false);
    expect('locked' in (ed.store.peek(id) as NodeRecord)).toBe(false);
  });
});
