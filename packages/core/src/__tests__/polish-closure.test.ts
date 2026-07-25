/**
 * Regression pins for the audit-closure polish batch (task #49): each test reproduces a residual
 * gap the closure verifiers demonstrated on the pre-polish tree and fails without its fix.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  Editor,
  isNodusError,
  restore,
  type ChangeInfo,
  type LayoutEngine,
  type NodusRecord,
  type SerializationIssue,
  type Snapshot,
} from '../index.js';

const nodeRecord = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'node:n1',
  typeName: 'node',
  version: 0,
  type: 'rect',
  x: 10,
  y: 20,
  w: 100,
  h: 50,
  z: '00000001',
  visual: { state: 'solid' },
  props: {},
  ...extra,
});

const snapOf = (records: unknown[]): Snapshot =>
  ({ schemaVersion: 1, document: { records: records as NodusRecord[] } }) as Snapshot;

describe('F5 — unknown top-level fields are reported, never silently dropped', () => {
  it('emits an unknown-field issue naming the stripped keys and still loads the record', () => {
    const issues: SerializationIssue[] = [];
    const res = restore(snapOf([nodeRecord({ myAnnotation: 'keep-me', vendorTag: 1 })]), {
      onError: (i) => issues.push(i),
    });
    expect(res.records).toHaveLength(1);
    const unknown = issues.filter((i) => i.code === 'unknown-field');
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.value).toEqual(['myAnnotation', 'vendorTag']);
    expect(unknown[0]!.message).toContain('props/meta');
  });

  it('a fully-whitelisted record loads with zero issues (fixture-compatible)', () => {
    const issues: SerializationIssue[] = [];
    restore(snapOf([nodeRecord()]), { onError: (i) => issues.push(i) });
    expect(issues).toEqual([]);
  });
});

describe('F24 — null snapshot never raw-TypeErrors', () => {
  it('loadSnapshot(null) returns a LoadReport with an invalid-snapshot issue', () => {
    const ed = new Editor();
    const report = ed.loadSnapshot(null as never);
    expect(report.records ?? []).toEqual([]);
    expect(report.issues.map((i) => i.code)).toEqual(['invalid-snapshot']);
    ed.dispose();
  });
});

describe('F34 — plugin install failure throws the frozen typed code', () => {
  it("use() failure is NodusError('plugin-install-failed') with the plugin id in context", () => {
    const ed = new Editor();
    let caught: unknown;
    try {
      ed.use({
        id: 'exploder',
        register() {
          throw new Error('boom');
        },
      });
    } catch (e) {
      caught = e;
    }
    expect(isNodusError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe('plugin-install-failed');
    expect((caught as { context?: { pluginId?: string } }).context?.pluginId).toBe('exploder');
    ed.dispose();
  });
});

describe('F13 — animation-callback faults surface on the error channel', () => {
  it('a throwing tween onTick emits an error event and does not console.error', () => {
    const ed = new Editor();
    const errors: unknown[] = [];
    ed.on('error', (e) => errors.push(e));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    ed.animate({
      from: 0,
      to: 1,
      durationMs: 100,
      onTick: () => {
        throw new Error('bad tween');
      },
    });
    ed.animClockStep(0); // seeds start
    ed.animClockStep(16); // first real tick → throws inside the clock
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
    ed.dispose();
  });
});

describe('F14 — tool/router id collisions are observable, garbage tools refused', () => {
  it('duplicate router and tool registrations emit warning-severity override events', () => {
    const ed = new Editor();
    const warnings: Array<Record<string, unknown>> = [];
    ed.on('error', (e) => {
      if (e.severity === 'warning') warnings.push(e.context as Record<string, unknown>);
    });
    ed.routers.register({ id: 'zigzag', route: () => [] });
    ed.routers.register({ id: 'zigzag', route: () => [] });
    const tool = ed.toolManager.current; // re-register an existing tool id via a stub sharing it
    ed.registerTool(Object.assign(Object.create(Object.getPrototypeOf(tool)), tool));
    const kinds = warnings.map((w) => w.kind ?? w.label ?? JSON.stringify(w));
    expect(JSON.stringify(kinds)).toContain('router');
    expect(JSON.stringify(kinds)).toContain('tool');
    ed.dispose();
  });

  it('registering a malformed tool throws invalid-util', () => {
    const ed = new Editor();
    expect(() => ed.registerTool({} as never)).toThrowError(/invalid|ToolNode/i);
    ed.dispose();
  });
});

describe('F38 — locked nodes survive a misbehaving layout adapter', () => {
  it('positions returned for a locked node are discarded editor-side', async () => {
    const ed = new Editor();
    const free = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const locked = ed.createNode({ type: 'rect', x: 50, y: 60 });
    ed.lock([locked]);
    const rogue: LayoutEngine = {
      id: 'rogue',
      // deliberately moves EVERY node it is given, ignoring `fixed`
      layout: async (graph) => ({
        positions: Object.fromEntries(graph.nodes.map((n) => [n.id, { x: 999, y: 888 }])),
      }),
    };
    ed.registerLayout(rogue);
    await ed.layout('rogue');
    expect(ed.store.peek(free)).toMatchObject({ x: 999, y: 888 });
    expect(ed.store.peek(locked)).toMatchObject({ x: 50, y: 60 });
    ed.dispose();
  });
});

describe('F28 — dev freeze is deep enough to protect shared undo references', () => {
  it('mutating a dispatched Change record/patch throws in dev', () => {
    const ed = new Editor();
    let seen: ChangeInfo | null = null;
    ed.onChange((info) => {
      seen = info;
    });
    ed.createNode({ type: 'rect', x: 1, y: 2 });
    expect(seen).not.toBeNull();
    const change = seen!.changes[0]!;
    expect(() => {
      (change as { op: string }).op = 'remove';
    }).toThrow();
    if ('record' in change) {
      expect(() => {
        (change.record as { x: number }).x = 12345;
      }).toThrow();
    }
    ed.dispose();
  });
});
