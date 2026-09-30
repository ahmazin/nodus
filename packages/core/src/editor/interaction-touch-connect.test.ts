import { describe, expect, it } from 'vitest';
import { Editor } from '../index.js';

/**
 * Two host-agnostic interaction affordances that live in the engine so any host (not just the React
 * binding) gets them:
 *   A. `PointerMods.tolerance` — a per-pointer, screen-px hit radius the host widens for coarse
 *      (touch) pointers, so fat-finger taps still land on thin/small targets.
 *   B. keyboard "connect from selection" — `beginConnectFromSelection` / `stepPendingConnect` /
 *      `commitPendingConnect` / `cancelPendingConnect` + `pendingConnectAtom`, lifted verbatim from
 *      the former host-local closures.
 * Default camera is identity (screen == world, z = 1), so screen-px tolerances == world units here.
 */
describe('PointerMods.tolerance — coarse-pointer hit radius', () => {
  it('widens the pointer hit radius: a point that misses at the mouse radius (5) is hit at the touch radius (12)', () => {
    const ed = new Editor();
    const node = ed.createNode({ type: 'rect', x: 0, y: 0, w: 40, h: 40 });
    // A point 8 world units BELOW the node's bottom edge, at the node's horizontal center: OUTSIDE
    // the 5px mouse radius, INSIDE the 12px touch radius (distance to the rect is exactly 8), and
    // clear of any port handle so we observe the pointer hit radius, not port-drag pickup. Hover is
    // set straight from `pointerInfo`'s tolerance-aware hitTest, so it reflects the target directly.
    const p = { x: 20, y: 48 };

    // Default (mouse) tolerance → the pointer misses the node (hover stays null).
    ed.pointerMove(p);
    expect(ed.hoveredAtom.peek()).toBeNull();

    // Touch tolerance (12) → the same point now hits the node. Fails without the `PointerMods.tolerance`
    // plumbing (the pointer path would keep using the hard-coded 5 and still miss).
    ed.pointerMove(p, { tolerance: 12 });
    expect(ed.hoveredAtom.peek()).toBe(node);
  });
});

describe('keyboard connect-from-selection — portable core flow', () => {
  it('begins from a sole connectable node, steps to a target, and commits an edge', () => {
    const ed = new Editor();
    const src = ed.createNode({ type: 'rect', x: 0, y: 0, w: 40, h: 40 }); // top in reading order
    const dst = ed.createNode({ type: 'rect', x: 0, y: 200, w: 40, h: 40 }); // below src

    ed.select([src]);
    expect(ed.beginConnectFromSelection()).toBe(true);
    expect(ed.pendingConnectAtom.peek()).toBe(src);

    // Step the candidate target (reading-order traversal): src is above dst, so dir 1 lands on dst.
    ed.stepPendingConnect(1);
    expect(ed.selectedIdsArray()).toEqual([dst]);

    const before = ed.store.edges().length;
    expect(ed.commitPendingConnect()).toBe(true);
    expect(ed.pendingConnectAtom.peek()).toBeNull();

    const edges = ed.store.edges();
    expect(edges.length).toBe(before + 1);
    const edge = edges[edges.length - 1]!;
    expect(edge.from).toMatchObject({ kind: 'node', nodeId: src });
    expect(edge.to).toMatchObject({ kind: 'node', nodeId: dst });
  });

  it('does not begin when the selection is not exactly one connectable node', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 40, h: 40 });
    const b = ed.createNode({ type: 'rect', x: 0, y: 200, w: 40, h: 40 });
    const group = ed.createNode({ type: 'group', x: 300, y: 0, w: 120, h: 120 });

    ed.clearSelection(); // nothing selected
    expect(ed.beginConnectFromSelection()).toBe(false);
    expect(ed.pendingConnectAtom.peek()).toBeNull();

    ed.select([a, b]); // two selected
    expect(ed.beginConnectFromSelection()).toBe(false);
    expect(ed.pendingConnectAtom.peek()).toBeNull();

    ed.select([group]); // one, but not connectable (group.capabilities.canConnect === false)
    expect(ed.beginConnectFromSelection()).toBe(false);
    expect(ed.pendingConnectAtom.peek()).toBeNull();
  });

  it('cancel clears the pending source without creating an edge', () => {
    const ed = new Editor();
    const src = ed.createNode({ type: 'rect', x: 0, y: 0, w: 40, h: 40 });
    ed.createNode({ type: 'rect', x: 0, y: 200, w: 40, h: 40 });

    ed.select([src]);
    expect(ed.beginConnectFromSelection()).toBe(true);
    expect(ed.pendingConnectAtom.peek()).toBe(src);

    ed.cancelPendingConnect();
    expect(ed.pendingConnectAtom.peek()).toBeNull();
    expect(ed.store.edges()).toHaveLength(0);
  });

  it('commit is a no-op (no edge, atom cleared) when the target is the source itself', () => {
    const ed = new Editor();
    const src = ed.createNode({ type: 'rect', x: 0, y: 0, w: 40, h: 40 });

    ed.select([src]);
    expect(ed.beginConnectFromSelection()).toBe(true);
    // no step → the sole selection is still the source
    expect(ed.commitPendingConnect()).toBe(false);
    expect(ed.pendingConnectAtom.peek()).toBeNull();
    expect(ed.store.edges()).toHaveLength(0);
  });
});
