/** Regression tests for the core robustness-audit findings (and the fuzzer-found integrity bugs). */
import { describe, expect, it } from 'vitest';
import { Editor, Polyline2d, orthogonalRouter, type Change, type NodeRecord } from '../index.js';
import { EventBus } from '../events/index.js';

describe('serialization robustness', () => {
  it('rejects an edge with a non-finite point endpoint (would poison the R-tree)', () => {
    const ed = new Editor();
    ed.createNode({ type: 'rect' });
    const snap = ed.toJSON();
    (snap.document.records as unknown[]).push({
      id: 'edge:bad', typeName: 'edge', version: 0, type: 'line',
      from: { kind: 'point', x: NaN, y: 0 }, to: { kind: 'point', x: 0, y: 0 },
      visual: { state: 'solid' }, props: {},
    });
    const ed2 = new Editor();
    ed2.loadSnapshot(snap);
    expect(ed2.store.edges()).toHaveLength(0); // the NaN edge was dropped on restore
  });
});

describe('geometry / routing robustness', () => {
  it('a single-point polyline measures distance to the point (not Infinity)', () => {
    const line = new Polyline2d([{ x: 50, y: 50 }], 0);
    expect(line.distanceToPoint({ x: 50, y: 50 })).toBe(0);
    expect(line.distanceToPoint({ x: 53, y: 54 })).toBeCloseTo(5, 5);
  });

  it('trimEnd honors the arrowhead gap even when the last segment is shorter than it', () => {
    // from → waypoint → to, last leg only 3px, gap 12px
    const route = orthogonalRouter.route({ from: { x: 0, y: 0 }, to: { x: 103, y: 0 }, waypoints: [{ x: 100, y: 0 }], endGap: 12 });
    const end = route[route.length - 1]!;
    // the endpoint is pulled back ~12px from (103,0), i.e. well before it
    expect(end.x).toBeLessThan(103 - 6);
  });
});

describe('EventBus robustness', () => {
  it('does not re-fire an event for a listener subscribed during dispatch, and cleans up empty sets', () => {
    const bus = new EventBus();
    let a = 0;
    let b = 0;
    const off = bus.on('custom:x', () => {
      a++;
      if (a === 1) bus.on('custom:x', () => b++);
    });
    bus.emit({ type: 'custom:x' });
    expect(a).toBe(1);
    expect(b).toBe(0); // the listener added mid-dispatch does NOT run for this same event
    bus.emit({ type: 'custom:x' });
    expect(b).toBe(1); // it runs on the next emit
    off();
    // (empty-set cleanup on unsubscribe is internal; exercised here without leaking)
    expect(() => bus.emit({ type: 'custom:x' })).not.toThrow();
  });
});

describe('editor robustness', () => {
  it('duplicate() does not clobber the user clipboard', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, label: 'A' });
    const b = ed.createNode({ type: 'rect', x: 200, y: 0, label: 'B' });
    ed.copy([a]); // clipboard holds A
    ed.duplicate([b]); // must not overwrite the clipboard with B
    const pasted = ed.paste();
    const labels = pasted.map((id) => (ed.store.peek(id) as NodeRecord).label);
    expect(labels).toEqual(['A']); // pasted A, not B
  });

  it('deleting a group deletes its contents (no dangling parentId)', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const b = ed.createNode({ type: 'rect', x: 200, y: 0 });
    const g = ed.group([a, b])!;
    ed.deleteRecords([g]);
    expect(ed.store.has(a)).toBe(false);
    expect(ed.store.has(b)).toBe(false);
    expect(ed.store.has(g)).toBe(false);
  });

  it('a tool switch mid-drag closes the history group (drag is one undo entry)', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
    ed.select([a]);
    ed.pointerDown({ x: 50, y: 50 });
    ed.pointerMove({ x: 150, y: 50 }); // translating; opens a capture:'later' group
    expect((ed.store.peek(a) as NodeRecord).x).toBeGreaterThan(50);
    ed.setTool('hand'); // onExit must mark() to close the group
    ed.undo();
    expect((ed.store.peek(a) as NodeRecord).x).toBe(0); // the whole drag reverted in one undo
  });
});

describe('scene-index robustness', () => {
  it('an edge added before its endpoint node is indexed once the node arrives', () => {
    const ed = new Editor();
    const nid = 'node:future' as NodeRecord['id'];
    ed.store.apply([
      { op: 'add', record: { id: 'edge:e', typeName: 'edge', version: 0, type: 'line', from: { kind: 'outline', nodeId: nid }, to: { kind: 'point', x: 0, y: 0 }, visual: { state: 'solid' }, props: {} } } as Change,
    ]);
    expect(ed.sceneIndex.getItem('edge:e' as NodeRecord['id'])).toBeFalsy(); // dropped: endpoint missing
    ed.store.apply([
      { op: 'add', record: { id: nid, typeName: 'node', version: 0, type: 'rect', x: 0, y: 0, w: 100, h: 100, z: 'a0', visual: { state: 'accent' }, props: {} } } as Change,
    ]);
    expect(ed.sceneIndex.getItem('edge:e' as NodeRecord['id'])).toBeTruthy(); // rebuilt now
  });
});
