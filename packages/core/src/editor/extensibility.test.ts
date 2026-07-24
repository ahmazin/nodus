/**
 * Extensibility cluster (tasks E1/E3/E5). E1: idempotent plugin lifecycle + recording-host teardown +
 * once-wrapped disposer + active-tool reset. E3: one capability merge point (unset canRotate → false;
 * edge canEdit). E5: readOnly gates the interactive layer only; history limit evicts. Each `it` fails
 * on the pre-change engine.
 */
import { describe, expect, it, vi } from 'vitest';
import { Editor, Rectangle2d, ToolNode } from '../index.js';
import type { NodeRecord } from '../model.js';
import type { Plugin } from '../plugins/index.js';

const rectGeom = (n: NodeRecord): Rectangle2d => new Rectangle2d({ x: n.x, y: n.y, w: n.w, h: n.h });

class NamedTool extends ToolNode {
  constructor(readonly id: string) {
    super();
  }
}

const mkPlugin = (id: string): Plugin => ({
  id,
  register(host) {
    host.registerNodeType({ type: `${id}-node`, getDefaultProps: () => ({}), getGeometry: rectGeom, draw: () => {} });
    host.registerTool(new NamedTool(`${id}-tool`));
    return () => {}; // no-op own disposer — the recording host still tears down the register* calls
  },
});

describe('E1 — plugin lifecycle', () => {
  it('use() is idempotent by id: a second install returns the same disposer + a single registration', () => {
    const ed = new Editor();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const d1 = ed.use(mkPlugin('p'));
      const d2 = ed.use(mkPlugin('p'));
      expect(d2).toBe(d1);
      expect(ed.installedPlugins()).toEqual(['p']);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('disposing a plugin unregisters its node type + tool (even with a no-op own disposer)', () => {
    const ed = new Editor();
    const d = ed.use(mkPlugin('fh'));
    expect(ed.nodes.has('fh-node')).toBe(true);
    expect(ed.toolManager.has('fh-tool')).toBe(true);
    d();
    expect(ed.nodes.has('fh-node')).toBe(false);
    expect(ed.toolManager.has('fh-tool')).toBe(false);
    expect(ed.installedPlugins()).toEqual([]);
  });

  it('the plugin disposer runs at most once (called + editor.dispose() → no double-invoke)', () => {
    const ed = new Editor();
    let runs = 0;
    const d = ed.use({ id: 'p', register: () => () => void runs++ });
    d();
    ed.dispose();
    expect(runs).toBe(1);
  });

  it('unregistering the active tool resets to select', () => {
    const ed = new Editor();
    const d = ed.use(mkPlugin('t'));
    ed.setTool('t-tool');
    expect(ed.toolManager.currentToolId).toBe('t-tool');
    d();
    expect(ed.toolManager.currentToolId).toBe('select');
  });
});

describe('E3 — capability merge point', () => {
  it('capabilitiesOf merges DEFAULT with the util partial; unset canRotate resolves false', () => {
    const ed = new Editor();
    ed.registerNodeType({
      type: 'x',
      getDefaultProps: () => ({}),
      getGeometry: rectGeom,
      draw: () => {},
      capabilities: { canConnect: false },
    });
    const caps = ed.capabilitiesOf('x');
    expect(caps.canConnect).toBe(false); // from the partial
    expect(caps.canRotate).toBe(false); // unset → default false
    expect(caps.canResize).toBe(true); // default
  });

  it('rect (no capabilities) is not rotatable — rotate() is a no-op', () => {
    const ed = new Editor();
    expect(ed.capabilitiesOf('rect').canRotate).toBe(false);
    const id = ed.createNode({ type: 'rect', x: 0, y: 0 });
    ed.rotate([id], Math.PI / 4);
    expect((ed.store.peek(id) as NodeRecord).rotation ?? 0).toBe(0);
  });

  it('edge canEdit=false blocks canEdit(); a default edge is editable', () => {
    const ed = new Editor();
    ed.registerEdgeType({ type: 'noedit', getRoute: () => [], draw: () => {}, capabilities: { canEdit: false } });
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const b = ed.createNode({ type: 'rect', x: 100, y: 0 });
    const e = ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b }, 'noedit');
    expect(ed.canEdit(e)).toBe(false);
    const e2 = ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b });
    expect(ed.canEdit(e2)).toBe(true);
  });
});

describe('E5 — readOnly + history limit', () => {
  it('readOnly gates the pointer layer but allows programmatic mutation + selection', () => {
    const ed = new Editor({ readOnly: true });
    const id = ed.createNode({ type: 'rect', x: 0, y: 0, w: 50, h: 50 }); // programmatic still works
    expect(ed.store.has(id)).toBe(true);
    ed.select([id]);
    expect(ed.selectedIdsArray()).toEqual([id]); // selection still works

    const before = ed.store.nodes().length;
    ed.pointerDown({ x: 200, y: 200 }); // an interactive gesture is ignored
    ed.pointerMove({ x: 260, y: 260 });
    ed.pointerUp({ x: 260, y: 260 });
    expect(ed.store.nodes().length).toBe(before);
  });

  it('history limit evicts the oldest entry (undo stops at the limit)', () => {
    const ed = new Editor({ history: { limit: 2 } });
    ed.createNode({ type: 'rect', x: 0, y: 0 });
    ed.createNode({ type: 'rect', x: 10, y: 0 });
    ed.createNode({ type: 'rect', x: 20, y: 0 }); // 3 entries; the oldest is evicted (limit 2)
    expect(ed.store.nodes()).toHaveLength(3);
    expect(ed.undo()).toBe(true);
    expect(ed.undo()).toBe(true);
    expect(ed.undo()).toBe(false); // only the last 2 are undoable
    expect(ed.store.nodes()).toHaveLength(1); // the first create can't be undone
  });
});
