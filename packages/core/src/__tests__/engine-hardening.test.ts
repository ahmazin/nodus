/**
 * Regression tests for the GA engine-hardening pass (WS-A). Each `it` fails on the pre-fix code:
 *   1. `store.apply` is genuinely atomic — a throw mid-apply rolls back store, history, and index.
 *   2. the mutation channel is crash-isolated from third-party utils/listeners (surfaced via onError).
 *   3. (covered elsewhere) migration API removed — its absence is enforced by typecheck.
 *   4. scene-index `nodeEdges` adjacency no longer leaks for an edge that never built.
 *   5. undo of a key-introducing update DELETES the key (strict in-memory `load(save(x)) === x`).
 *   6. `rebuild()` bulk-loads the R-tree; every record stays queryable.
 */
import { describe, expect, it } from 'vitest';
import {
  Editor,
  Registry,
  SceneIndex,
  Store,
  stableStringify,
  type Change,
  type EdgeUtil,
  type Id,
  type NodeRecord,
  type NodeUtil,
  type NodusRecord,
} from '../index.js';

/** A minimal, fully-formed `NodeRecord` with no optional keys (no `label`/`rotation`/`meta`). */
function mkNode(id: string, type = 'rect', extra: Partial<NodeRecord> = {}): NodeRecord {
  return {
    id: id as Id<'node'>,
    typeName: 'node',
    version: 0,
    type,
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    z: 'a0',
    visual: { state: 'solid' },
    props: {},
    ...extra,
  };
}

/** Document fingerprint: records sans the (legitimately churny) `version`, canonically ordered. */
function fingerprint(store: Store): string {
  const recs = store
    .allRecords()
    .map(({ version, ...r }) => r as Record<string, unknown>)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return stableStringify(recs);
}

describe('1. store.apply is genuinely atomic (transact + structural rollback)', () => {
  it('a throw partway rolls back the store, history, and the scene index — nothing drifts', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 10, y: 20 });

    const before = fingerprint(ed.store);
    const idsBefore = [...ed.store.ids()].sort();
    const sceneBefore = ed.sceneIndex.all().map((i) => i.id).sort();
    const historyVersionBefore = ed.history.version.peek();

    // An update patch whose value throws when read (during the merge) — a deterministic mid-apply throw
    // that lands AFTER the batch's add has already inserted a new atom.
    const throwingPatch: Record<string, unknown> = {};
    Object.defineProperty(throwingPatch, 'x', {
      enumerable: true,
      get() {
        throw new Error('mid-apply boom');
      },
    });

    expect(() =>
      ed.store.apply([
        { op: 'add', record: mkNode('node:ghost') },
        { op: 'update', id: a, patch: throwingPatch },
      ]),
    ).toThrow('mid-apply boom');

    // the half-added record was unwound (transact can't see the Map insert; apply's catch undoes it)
    expect(ed.store.has('node:ghost' as Id<'node'>)).toBe(false);
    expect([...ed.store.ids()].sort()).toEqual(idsBefore);
    expect(fingerprint(ed.store)).toBe(before);
    // listeners never fired (apply threw before dispatch) → index and history untouched
    expect(ed.sceneIndex.all().map((i) => i.id).sort()).toEqual(sceneBefore);
    expect(ed.history.version.peek()).toBe(historyVersionBefore);
  });
});

describe('2. the mutation channel is crash-isolated (per-listener + per-build), surfaced via onError', () => {
  it('a throwing listener is isolated: siblings still run, apply never throws, error is reported', () => {
    const errors: unknown[] = [];
    const store = new Store({
      onError: (err, ctx) => {
        expect(ctx.phase).toBe('listener');
        errors.push(err);
      },
    });
    let siblingRuns = 0;
    store.listen(() => {
      throw new Error('bad-listener');
    });
    store.listen(() => {
      siblingRuns++;
    });

    expect(() => store.apply([{ op: 'add', record: mkNode('node:x') }])).not.toThrow();
    expect(siblingRuns).toBe(1); // the sibling ran despite the earlier listener throwing
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('bad-listener');
  });

  it('SceneIndex: a throwing getGeometry leaves the record unindexed and reports via onError', () => {
    const records = new Map<Id, NodusRecord>();
    const nodes = new Registry<NodeUtil>();
    const edges = new Registry<EdgeUtil>();
    nodes.register({
      type: 'boom',
      getDefaultProps: () => ({}),
      getGeometry() {
        throw new Error('kaboom');
      },
      draw() {},
    });

    let capturedCtx: { phase: string; kind: string; id: Id } | null = null;
    let capturedErr: unknown = null;
    const idx = new SceneIndex({
      getRecord: (id) => records.get(id),
      nodes,
      edges,
      onError: (err, ctx) => {
        capturedErr = err;
        capturedCtx = ctx;
      },
    });

    const rec = mkNode('node:b', 'boom');
    records.set(rec.id, rec);
    idx.applyChanges([{ op: 'add', record: rec }]);

    expect(idx.getItem(rec.id)).toBeUndefined(); // build threw → left unindexed, no crash
    expect(capturedCtx).toEqual({ phase: 'build', kind: 'node', id: rec.id });
    expect((capturedErr as unknown as Error).message).toBe('kaboom');
  });

  it('Editor: a throwing getGeometry commits the atom but keeps undo history in sync', () => {
    const ed = new Editor();
    ed.registerNodeType({
      type: 'boom',
      getDefaultProps: () => ({}),
      getGeometry() {
        throw new Error('kaboom');
      },
      draw() {},
    });

    const id = ed.createNode({ type: 'boom', x: 0, y: 0 });
    expect(ed.store.has(id)).toBe(true); // the store committed the record
    expect(ed.sceneIndex.getItem(id)).toBeUndefined(); // index skipped it (build threw), no crash
    // undo did NOT drift: the create is recorded and reverts cleanly
    expect(ed.history.canUndo()).toBe(true);
    ed.undo();
    expect(ed.store.has(id)).toBe(false);
  });
});

describe('4. scene-index nodeEdges adjacency does not leak', () => {
  it('removing an edge that never built reclaims its adjacency entry', () => {
    const ed = new Editor();
    const nid = 'node:absent' as Id<'node'>;
    const eid = 'edge:leak' as Id<'edge'>;

    ed.store.apply([
      {
        op: 'add',
        record: {
          id: eid,
          typeName: 'edge',
          version: 0,
          type: 'line',
          from: { kind: 'outline', nodeId: nid },
          to: { kind: 'point', x: 0, y: 0 },
          visual: { state: 'solid' },
          props: {},
        },
      } as Change,
    ]);

    expect(ed.sceneIndex.getItem(eid)).toBeUndefined(); // endpoint missing → never built
    expect(ed.sceneIndex.edgesForNode(nid)).toContain(eid); // …but its linkage was tracked

    ed.store.apply([{ op: 'remove', id: eid }]);
    expect(ed.sceneIndex.edgesForNode(nid)).toEqual([]); // pre-fix: still [eid] (leak)
  });
});

describe('5. undo of a key-introducing update deletes the key', () => {
  it('the inverse removes a key that was absent before, restoring exact record identity', () => {
    const store = new Store();
    const rec = mkNode('node:k');
    store.apply([{ op: 'add', record: rec }]);

    const before = store.peek(rec.id)!;
    expect('rotation' in before).toBe(false);

    const info = store.apply([{ op: 'update', id: rec.id, patch: { rotation: 45 } }]);
    expect((store.peek(rec.id) as NodeRecord).rotation).toBe(45);

    // apply the computed inverse — exactly what history.undo() does
    store.apply(info.inverse, { capture: 'never' });
    const after = store.peek(rec.id) as NodeRecord;

    expect('rotation' in after).toBe(false); // key DELETED, not left set to `undefined`
    const strip = (r: NodusRecord): Record<string, unknown> => {
      const { version, ...rest } = r;
      return rest;
    };
    expect(strip(after)).toEqual(strip(before)); // strict structural identity (sans version)
  });
});

describe('6. rebuild() bulk-loads the R-tree', () => {
  it('every record lands in the tree and stays queryable after a full rebuild', () => {
    const ed = new Editor();
    const ids: Id<'node'>[] = [];
    for (let i = 0; i < 6; i++) {
      ids.push(ed.createNode({ type: 'rect', x: i * 200, y: 0, w: 100, h: 60 }));
    }

    const ed2 = new Editor();
    ed2.loadSnapshot(ed.toJSON()); // triggers a full rebuild (the bulk-load path)

    expect(ed2.sceneIndex.all()).toHaveLength(6);
    // a viewport query proves the entries reached the R-tree, not just the items map
    const inView = ed2.sceneIndex.visible({ x: -50, y: -50, w: 2000, h: 200 });
    expect(inView.map((i) => i.id).sort()).toEqual([...ids].sort());
  });
});
