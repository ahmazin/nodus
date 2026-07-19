import { describe, expect, it } from 'vitest';
import { Editor, toCanonicalString, type NodeUtil, type Snapshot } from '../index.js';

// A custom node type at version 2: v0 {r} -> {radius}; v1 doubles radius.
const boxUtil: NodeUtil = {
  type: 'box',
  getDefaultProps: () => ({ radius: 1 }),
  getGeometry: (n) => ({ bounds: () => ({ x: n.x, y: n.y, w: n.w, h: n.h }) }) as never,
  draw: () => {},
  migrations: [(p) => ({ radius: p.r }), (p) => ({ radius: (p.radius as number) * 2 })],
};

function oldDoc(props: Record<string, unknown>, typeVersions?: Record<string, number>): Snapshot {
  return {
    schemaVersion: 1,
    ...(typeVersions ? { typeVersions } : {}),
    document: {
      records: [
        { id: 'n1', typeName: 'node', version: 0, type: 'box', x: 0, y: 0, w: 10, h: 10, z: 'a0', visual: { state: 'solid' }, props } as never,
      ],
    },
  };
}

describe('Editor migration integration', () => {
  it('migrates custom-shape props on load', () => {
    const ed = new Editor();
    ed.registerNodeType(boxUtil);
    ed.loadSnapshot(oldDoc({ r: 5 })); // v0 -> v2
    expect((ed.store.nodes()[0] as unknown as { props: { radius: number } }).props.radius).toBe(10);
  });

  it('stamps typeVersions at the current version on save', () => {
    const ed = new Editor();
    ed.registerNodeType(boxUtil);
    ed.loadSnapshot(oldDoc({ r: 5 }));
    expect(ed.toJSON().typeVersions).toEqual({ box: 2 });
  });

  it('preserves a forward-version document byte-identically (max rule)', () => {
    const ed = new Editor(); // this client only knows box@2
    ed.registerNodeType(boxUtil);
    const future = oldDoc({ radius: 999 }, { box: 5 }); // written by a newer client
    ed.loadSnapshot(future);
    // kept raw, and re-stamped at 5 (not downgraded to 2)
    expect(ed.toJSON().typeVersions).toEqual({ box: 5 });
    expect((ed.store.nodes()[0] as unknown as { props: { radius: number } }).props.radius).toBe(999);
  });

  it('omits typeVersions for types with no migrations', () => {
    const ed = new Editor();
    const id = ed.createNode({ type: 'rect', x: 0, y: 0 });
    expect(id).toBeTruthy();
    expect(ed.toJSON().typeVersions).toBeUndefined();
  });

  it('a forward-version document is a stable fixed point: canonical bytes are identical across repeated saves', () => {
    const ed = new Editor(); // this client only knows box@2
    ed.registerNodeType(boxUtil);
    ed.loadSnapshot(oldDoc({ radius: 999 }, { box: 5 })); // written by a newer client (box@5)
    const first = toCanonicalString(ed.toJSON());
    const second = toCanonicalString(ed.toJSON());
    expect(first).toBe(second);
    expect(first).toContain('"typeVersions":{"box":5}'); // re-stamped at 5, never downgraded to 2
  });
});
