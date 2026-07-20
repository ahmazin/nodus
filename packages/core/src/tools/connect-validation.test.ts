import { describe, expect, it } from 'vitest';
import { Editor, Rectangle2d } from '../index.js';
import type { EdgeRecord, Endpoint, Id, NodeRecord, NodeUtil, Port } from '../index.js';

/**
 * Port-drag connection validity (SelectTool.finishPorting + the mid-drag draft). Default camera is
 * identity, so screen == world. These lock in the two connection-validity axes the interaction layer
 * enforces — target `capabilities.canConnect` and a source port's `isValidConnection` — which the
 * low-level `editor.connect()` deliberately does NOT enforce (importers wire anything).
 */
describe('SelectTool — port-drag connection validity', () => {
  it('drags from a port and drops on another node → creates an edge binding the ports', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 40, h: 40 });
    const b = ed.createNode({ type: 'rect', x: 200, y: 0, w: 40, h: 40 });
    expect(ed.store.edges()).toHaveLength(0);

    // 'out' anchor of A is (1, 0.5) → (40, 20); 'in' anchor of B is (0, 0.5) → (200, 20)
    ed.pointerDown({ x: 40, y: 20 }, {});
    ed.pointerMove({ x: 200, y: 20 }, {});
    ed.pointerUp({ x: 200, y: 20 }, {});

    const edges = ed.store.edges();
    expect(edges).toHaveLength(1);
    const e = edges[0]!;
    expect(e.from.kind).toBe('node');
    expect(e.to.kind).toBe('node');
    expect((e.from as { nodeId: Id }).nodeId).toBe(a);
    expect((e.to as { nodeId: Id }).nodeId).toBe(b);
  });

  it('drags into empty space → quick-creates a node AND connects it, as one undo entry', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 40, h: 40 });

    ed.pointerDown({ x: 40, y: 20 }, {});
    ed.pointerMove({ x: 400, y: 400 }, {});
    ed.pointerUp({ x: 400, y: 400 }, {});

    expect(ed.store.nodes()).toHaveLength(2); // A + the quick-created node
    expect(ed.store.edges()).toHaveLength(1);
    const e = ed.store.edges()[0]!;
    expect((e.from as { nodeId: Id }).nodeId).toBe(a);

    ed.undo(); // a single entry unwinds both the create and the connect
    expect(ed.store.nodes()).toHaveLength(1);
    expect(ed.store.edges()).toHaveLength(0);
  });

  it('dropping onto a non-connectable node (group, canConnect:false) creates no edge', () => {
    const ed = new Editor();
    ed.createNode({ type: 'rect', x: 0, y: 0, w: 40, h: 40 });
    ed.createNode({ type: 'group', x: 200, y: 0, w: 120, h: 120 });

    ed.pointerDown({ x: 40, y: 20 }, {}); // A's 'out' port
    ed.pointerMove({ x: 250, y: 50 }, {}); // inside the group
    ed.pointerUp({ x: 250, y: 50 }, {});

    expect(ed.store.edges()).toHaveLength(0);
  });

  it("respects a source port's isValidConnection: a false verdict creates no edge", () => {
    const ed = new Editor();
    // A node type whose lone 'out' port refuses every connection.
    const pickyUtil: NodeUtil = {
      type: 'picky',
      getDefaultProps: () => ({}),
      getDefaultSize: () => ({ w: 40, h: 40 }),
      getGeometry: (n: NodeRecord) => new Rectangle2d({ x: n.x, y: n.y, w: n.w, h: n.h }),
      getPorts: (): Port[] => [{ id: 'out', kind: 'source', anchor: { x: 1, y: 0.5 }, isValidConnection: () => false }],
      draw: () => {},
    };
    ed.registerNodeType(pickyUtil);
    ed.createNode({ type: 'picky', x: 0, y: 0, w: 40, h: 40 });
    ed.createNode({ type: 'rect', x: 200, y: 0, w: 40, h: 40 });

    ed.pointerDown({ x: 40, y: 20 }, {}); // picky's 'out' port
    ed.pointerMove({ x: 200, y: 20 }, {}); // rect's 'in' port
    ed.pointerUp({ x: 200, y: 20 }, {});

    expect(ed.store.edges()).toHaveLength(0);
  });

  it('flags the mid-drag draft target port valid over a connectable node, invalid when refused', () => {
    const ed = new Editor();
    const pickyUtil: NodeUtil = {
      type: 'picky',
      getDefaultProps: () => ({}),
      getDefaultSize: () => ({ w: 40, h: 40 }),
      getGeometry: (n: NodeRecord) => new Rectangle2d({ x: n.x, y: n.y, w: n.w, h: n.h }),
      getPorts: (): Port[] => [{ id: 'out', kind: 'source', anchor: { x: 1, y: 0.5 }, isValidConnection: () => false }],
      draw: () => {},
    };
    ed.registerNodeType(pickyUtil);

    // Valid case: a normal source port over a normal target port.
    ed.createNode({ type: 'rect', x: 0, y: 0, w: 40, h: 40 });
    ed.createNode({ type: 'rect', x: 200, y: 0, w: 40, h: 40 });
    ed.pointerDown({ x: 40, y: 20 }, {});
    ed.pointerMove({ x: 200, y: 20 }, {});
    let tp = ed.connectDraftAtom.peek()!.targetPort;
    expect(tp).toBeDefined();
    expect(tp!.valid).toBe(true);
    ed.pointerUp({ x: 200, y: 20 }, {});

    // Invalid case: the picky source port refuses, so its draft target reads as invalid.
    const ed2 = new Editor();
    ed2.registerNodeType(pickyUtil);
    ed2.createNode({ type: 'picky', x: 0, y: 0, w: 40, h: 40 });
    ed2.createNode({ type: 'rect', x: 200, y: 0, w: 40, h: 40 });
    ed2.pointerDown({ x: 40, y: 20 }, {});
    ed2.pointerMove({ x: 200, y: 20 }, {});
    tp = ed2.connectDraftAtom.peek()!.targetPort;
    expect(tp).toBeDefined();
    expect(tp!.valid).toBe(false);
    ed2.pointerUp({ x: 200, y: 20 }, {});
  });
});

describe('Editor.connectAllowed — the shared interaction gate', () => {
  it('rejects a non-connectable target but leaves the low-level connect() unvalidated', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 40, h: 40 });
    const g = ed.createNode({ type: 'group', x: 200, y: 0, w: 120, h: 120 });
    const from: Endpoint = { kind: 'node', nodeId: a as Id<'node'>, portId: 'out' };
    const toGroup: Endpoint = { kind: 'outline', nodeId: g as Id<'node'> };
    expect(ed.connectAllowed(from, toGroup)).toBe(false);
    expect(ed.canConnectTo(g)).toBe(false);
    expect(ed.canConnectTo(a)).toBe(true);

    // programmatic connect() bypasses the gate on purpose
    expect(ed.connect(from, toGroup)).not.toBeNull();
    expect(ed.store.edges()).toHaveLength(1);
  });
});
