/**
 * The façade failure convention (task A1 / CONTRACT §façade): a synchronous programmer error
 * (unknown registered type) THROWS a typed NodusError; a stale/missing id — a runtime reality from
 * async UI — RETURNS `false` rather than throwing or silently succeeding. Each `it` fails on the
 * pre-change editor (silent fallback / void returns).
 */
import { describe, expect, it } from 'vitest';
import { Editor } from './index.js';
import { NodusError, isNodusError } from '../errors/index.js';
import type { Id } from '../model.js';
import type { NodeUtil } from '../registries/index.js';

describe('editor façade — synchronous programmer errors throw a typed NodusError', () => {
  it('createNode throws unknown-node-type for an unregistered type (no silently-dropped node)', () => {
    const ed = new Editor();
    let err: unknown;
    try {
      ed.createNode({ type: 'does-not-exist' });
    } catch (e) {
      err = e;
    }
    expect(isNodusError(err)).toBe(true);
    expect((err as NodusError).code).toBe('unknown-node-type');
    expect((err as NodusError).context).toEqual({ type: 'does-not-exist' });
    expect(ed.store.nodes()).toHaveLength(0); // the invisible-dropped-node "success" is gone
  });

  it('connect throws unknown-edge-type for an unregistered edge type', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const b = ed.createNode({ type: 'rect', x: 100, y: 0 });
    let err: unknown;
    try {
      ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b }, 'ghost-edge');
    } catch (e) {
      err = e;
    }
    expect(isNodusError(err)).toBe(true);
    expect((err as NodusError).code).toBe('unknown-edge-type');
    expect(ed.store.edges()).toHaveLength(0);
  });

  it('layout rejects with unknown-layout for an unregistered engine', async () => {
    const ed = new Editor();
    await expect(ed.layout('nope')).rejects.toMatchObject({
      brand: '@nodus-dev/core:NodusError',
      code: 'unknown-layout',
    });
  });

  it('registerNodeType throws invalid-util for a util missing a required method', () => {
    const ed = new Editor();
    const bad = { type: 'broken' } as unknown as NodeUtil; // no getGeometry/draw
    let err: unknown;
    try {
      ed.registerNodeType(bad);
    } catch (e) {
      err = e;
    }
    expect(isNodusError(err)).toBe(true);
    expect((err as NodusError).code).toBe('invalid-util');
  });
});

describe('editor façade — stale/missing ids return false, live ids return true', () => {
  it('edge helpers return false on a stale id and true once the edge exists', () => {
    const ed = new Editor();
    const stale = 'edge:gone' as Id<'edge'>;
    expect(ed.setEdgeRouter(stale, 'orthogonal')).toBe(false);
    expect(ed.setEdgeLabel(stale, 'x')).toBe(false);
    expect(ed.addWaypoint(stale, { x: 1, y: 2 })).toBe(false);
    expect(ed.setWaypoints(stale, [{ x: 1, y: 2 }])).toBe(false);

    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const b = ed.createNode({ type: 'rect', x: 100, y: 0 });
    const e = ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b });
    expect(ed.setEdgeRouter(e, 'orthogonal')).toBe(true);
    expect(ed.setEdgeLabel(e, 'depends on')).toBe(true);
    expect(ed.addWaypoint(e, { x: 10, y: 10 })).toBe(true);
    expect(ed.setWaypoints(e, [{ x: 5, y: 5 }])).toBe(true);

    // a node id is not an edge → false, without throwing
    expect(ed.setEdgeRouter(a as unknown as Id<'edge'>, 'straight')).toBe(false);
  });

  it('renamePage/moveToPage return false for a missing target page, true otherwise', () => {
    const ed = new Editor();
    expect(ed.renamePage('page:gone' as Id<'page'>, 'X')).toBe(false);
    expect(ed.moveToPage([], 'page:gone' as Id<'page'>)).toBe(false);
    const p = ed.createPage('Second');
    expect(ed.renamePage(p, 'Renamed')).toBe(true);
    expect(ed.moveToPage([], p)).toBe(true);
  });
});

describe('editor façade — paste returns ALL created ids (nodes AND edges)', () => {
  it('paste returns the pasted edge id, not just the node ids', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const b = ed.createNode({ type: 'rect', x: 200, y: 0 });
    ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b });
    ed.copy([a, b]); // captures both nodes and the interconnecting edge

    const pasted = ed.paste();
    const kinds = pasted.map((id) => id.split(':')[0]);
    expect(kinds.filter((k) => k === 'node')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'edge')).toHaveLength(1); // dropped from the return before
    expect(ed.store.edges()).toHaveLength(2); // original + pasted
  });
});
