/**
 * Record-identity regressions around the module-global id counter and `createNode` record shape:
 *   - `makeId` output is unchanged after the refactor (byte-identical), and `seedIdCounter` advances
 *     the counter past loaded ids so a reopened document can't regenerate — and thus can't lose — a
 *     loaded node (data loss). Robust even when the counter's base-36 head contains the `x` separator.
 *   - `createNode` never writes an explicit `label: undefined` own-key.
 *   - `setFlowMetric` ignores an id with no live record (no orphan metrics).
 * Each `it` fails on the pre-fix code.
 */
import { describe, expect, it, vi } from 'vitest';
import { Editor } from './index.js';
import { makeId, seedIdCounter } from './model.js';
import type { Id, NodeRecord } from './model.js';

describe('makeId — stable, byte-identical identity after the refactor', () => {
  it('honors an explicit seed verbatim', () => {
    expect(makeId('node', 'abc')).toBe('node:abc');
    expect(makeId('page', 'home')).toBe('page:home');
  });

  it('first auto id in a fresh context is byte-identical to the legacy inline formula', async () => {
    vi.resetModules();
    const m = await import('./model.js');
    // counter 0 → `0` + `x` + `((0+1)*2654435761 % 0xffffff).toString(36)`
    expect(m.makeId('node')).toBe('node:0x25xe7');
  });
});

describe('id counter — a reopened document does not silently overwrite loaded nodes (data loss)', () => {
  it('an unseeded fresh context regenerates a saved id; seedIdCounter prevents the collision', async () => {
    // Session 1: mint an id and "save" the document.
    vi.resetModules();
    const s1 = await import('./model.js');
    const savedId = s1.makeId('node');

    // Session 2 (new JS context → counter reset): WITHOUT seeding the next auto id is identical —
    // the exact data-loss hazard (a redraw would regenerate the loaded node's id).
    vi.resetModules();
    const s2 = await import('./model.js');
    expect(s2.makeId('node')).toBe(savedId);

    // Session 3: the fix — seed from the loaded ids before minting; the next id no longer collides.
    vi.resetModules();
    const s3 = await import('./model.js');
    s3.seedIdCounter([savedId]);
    expect(s3.makeId('node')).not.toBe(savedId);
  });

  it('seedIdCounter recovers counter values whose base-36 head contains the "x" separator', async () => {
    // Mint enough ids that the counter passes 33 (base36 "x") and 34 ("y").
    vi.resetModules();
    const s1 = await import('./model.js');
    const ids: string[] = [];
    for (let i = 0; i < 40; i++) ids.push(s1.makeId('node'));
    const idAt33 = ids[33]!; // counter value 33 → head "x"
    expect(idAt33.startsWith('node:x')).toBe(true);

    // Fresh context: seed ONLY from that x-headed id. A naive `indexOf('x')` split would fail to
    // recognize it, leave the counter at 0, and mint `ids[0]`; the robust parse recovers 33 → mints ids[34].
    vi.resetModules();
    const s2 = await import('./model.js');
    s2.seedIdCounter([idAt33]);
    expect(s2.makeId('node')).toBe(ids[34]);
  });

  it('seedIdCounter ignores keyed/custom-seeded ids (they never perturb the counter)', async () => {
    vi.resetModules();
    const m = await import('./model.js');
    const first = m.makeId('node'); // counter 0 → the canonical first id
    // Custom seeds and non-auto shapes must be ignored, so the counter is untouched.
    vi.resetModules();
    const m2 = await import('./model.js');
    m2.seedIdCounter(['node:s3-prod', 'node:nginx', 'node:n0', 'edge:e0', 'node:proxy']);
    expect(m2.makeId('node')).toBe(first);
  });
});

describe('Editor.createNode — record shape', () => {
  it('omits the `label` key entirely when no label is provided', () => {
    const ed = new Editor();
    const id = ed.createNode({ type: 'rect' });
    const rec = ed.store.peek(id) as NodeRecord;
    expect('label' in rec).toBe(false); // pre-fix wrote `label: undefined` as an own-key
  });

  it('keeps an explicit label', () => {
    const ed = new Editor();
    const id = ed.createNode({ type: 'rect', label: 'DB' });
    expect((ed.store.peek(id) as NodeRecord).label).toBe('DB');
  });
});

describe('Editor.setFlowMetric — validates the target id exists', () => {
  it('drops a metric for an id with no live record (no orphan accumulation)', () => {
    const ed = new Editor();
    ed.setFlowMetric('edge:ghost' as Id, 5);
    expect(ed.flowMetric('edge:ghost' as Id)).toBeUndefined();
  });

  it('stores a metric for a live edge', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const b = ed.createNode({ type: 'rect', x: 300, y: 0 });
    const e = ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b })!;
    ed.setFlowMetric(e, 7);
    expect(ed.flowMetric(e)).toBe(7);
  });
});
