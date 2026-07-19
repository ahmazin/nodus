/**
 * The extension registration surface must be robust: a third party's malformed node/edge type,
 * layout, or a plugin that throws cannot silently corrupt or crash the engine. Each `it` fails on
 * the pre-hardening code (bare `map.set` / `layouts.set` / un-guarded `plugin.register`).
 *
 *   1. malformed node/edge utils are rejected at registration time (fail fast, clear message),
 *   2. a valid util still registers and works end-to-end,
 *   3. a re-registration overrides (presets do this) without throwing, but stays observable,
 *   4. `registerLayout` rejects a malformed engine,
 *   5. `use()` isolates a throwing plugin: contextual error, reported, editor stays usable.
 */
import { describe, expect, it } from 'vitest';
import {
  Editor,
  Rectangle2d,
  Registry,
  type EdgeUtil,
  type Geometry2d,
  type LayoutEngine,
  type NodeRecord,
  type NodeUtil,
  type NodusEvent,
  type Plugin,
} from '../index.js';

function validNodeUtil(type = 'custom'): NodeUtil {
  return {
    type,
    getDefaultProps: () => ({}),
    getGeometry: (n: NodeRecord): Geometry2d => new Rectangle2d({ x: n.x, y: n.y, w: n.w, h: n.h }),
    draw: () => {},
  };
}

function validEdgeUtil(type = 'custom.edge'): EdgeUtil {
  return {
    type,
    getRoute: () => [],
    draw: () => {},
  };
}

/** Collect `error`-channel events so tests can assert an override/plugin fault was surfaced. */
function captureErrors(ed: Editor): NodusEvent[] {
  const events: NodusEvent[] = [];
  ed.on('error', (e) => events.push(e));
  return events;
}

function contextPhase(e: NodusEvent): string | undefined {
  return (e as { context?: { phase?: string } }).context?.phase;
}

describe('1. malformed node/edge utils are rejected at registration (fail fast)', () => {
  it('rejects a node util whose `type` is empty or not a string', () => {
    const ed = new Editor();
    expect(() => ed.registerNodeType({ ...validNodeUtil(), type: '' })).toThrow(/non-empty string/);
    expect(() => ed.registerNodeType({ ...validNodeUtil(), type: undefined as unknown as string })).toThrow(
      /non-empty string/,
    );
    expect(ed.nodes.has('')).toBe(false); // nothing phantom-registered
  });

  it('rejects a node util missing `getGeometry` or `draw`', () => {
    const ed = new Editor();
    const noGeom = { type: 'a', getDefaultProps: () => ({}), draw: () => {} } as unknown as NodeUtil;
    const noDraw = {
      type: 'b',
      getDefaultProps: () => ({}),
      getGeometry: () => new Rectangle2d({ x: 0, y: 0, w: 1, h: 1 }),
    } as unknown as NodeUtil;
    expect(() => ed.registerNodeType(noGeom)).toThrow(/getGeometry.*must be a function/);
    expect(() => ed.registerNodeType(noDraw)).toThrow(/draw.*must be a function/);
    expect(ed.nodes.has('a')).toBe(false);
    expect(ed.nodes.has('b')).toBe(false);
  });

  it('rejects an edge util missing `getRoute` or `draw`', () => {
    const ed = new Editor();
    const noRoute = { type: 'e1', draw: () => {} } as unknown as EdgeUtil;
    const noDraw = { type: 'e2', getRoute: () => [] } as unknown as EdgeUtil;
    expect(() => ed.registerEdgeType(noRoute)).toThrow(/getRoute.*must be a function/);
    expect(() => ed.registerEdgeType(noDraw)).toThrow(/draw.*must be a function/);
  });

  it('the generic Registry validates `type` on the direct .register() path (used by presets)', () => {
    const reg = new Registry<NodeUtil>();
    expect(() => reg.register({ type: '' } as unknown as NodeUtil)).toThrow(/non-empty string/);
    expect(() => reg.register(null as unknown as NodeUtil)).toThrow(/util object/);
    expect(reg.size).toBe(0);
  });
});

describe('2. a valid util still registers and works end-to-end', () => {
  it('registers a valid node type and it drives create + indexing', () => {
    const ed = new Editor();
    ed.registerNodeType(validNodeUtil('widget'));
    expect(ed.nodes.get('widget')?.type).toBe('widget');

    const id = ed.createNode({ type: 'widget', x: 5, y: 6, w: 20, h: 10 });
    expect(ed.store.has(id)).toBe(true);
    expect(ed.sceneIndex.getItem(id)).toBeDefined(); // getGeometry ran and indexed cleanly
  });
});

describe('3. re-registration overrides without throwing but stays observable', () => {
  it('last write wins, no throw, and an override warning is surfaced on the error channel', () => {
    const ed = new Editor();
    const events = captureErrors(ed);

    ed.registerNodeType(validNodeUtil('dup'));
    const second = validNodeUtil('dup');
    expect(() => ed.registerNodeType(second)).not.toThrow();
    expect(ed.nodes.get('dup')).toBe(second); // override took effect

    const override = events.find((e) => contextPhase(e) === 'register');
    expect(override).toBeDefined();
    expect((override as unknown as { context: { kind: string; type: string } }).context).toMatchObject({
      kind: 'node type',
      type: 'dup',
    });
  });
});

describe('4. registerLayout rejects a malformed engine', () => {
  it('rejects an engine with no `id` or a non-function `layout`', () => {
    const ed = new Editor();
    expect(() =>
      ed.registerLayout({ layout: async () => ({ positions: {} }) } as unknown as LayoutEngine),
    ).toThrow(/'id' must be a non-empty string/);
    expect(() => ed.registerLayout({ id: 'grid' } as unknown as LayoutEngine)).toThrow(
      /'layout' must be a function/,
    );
    expect(ed.layouts.has('grid')).toBe(false);
  });

  it('registers a valid layout engine', () => {
    const ed = new Editor();
    const engine: LayoutEngine = { id: 'noop', layout: async () => ({ positions: {} }) };
    ed.registerLayout(engine);
    expect(ed.layouts.get('noop')).toBe(engine);
  });
});

describe('5. use() isolates a throwing plugin', () => {
  it('surfaces a contextual error, reports it, and leaves the editor usable', () => {
    const ed = new Editor();
    const events = captureErrors(ed);

    const bad: Plugin = {
      id: 'bad-plugin',
      register() {
        throw new Error('install boom');
      },
    };
    expect(() => ed.use(bad)).toThrow(/bad-plugin.*install boom/);

    const reported = events.find((e) => contextPhase(e) === 'plugin');
    expect(reported).toBeDefined();
    expect((reported as unknown as { context: { pluginId: unknown } }).context.pluginId).toBe('bad-plugin');

    // editor remains usable after the failed install
    const id = ed.createNode({ type: 'rect', x: 0, y: 0 });
    expect(ed.store.has(id)).toBe(true);
    expect(() => ed.registerNodeType(validNodeUtil('after'))).not.toThrow();
    expect(ed.nodes.has('after')).toBe(true);
  });

  it('a plugin that partially registers then throws does not corrupt later operation', () => {
    const ed = new Editor();
    const partial: Plugin = {
      id: 'partial',
      register(host) {
        host.registerNodeType(validNodeUtil('half'));
        throw new Error('late boom');
      },
    };
    expect(() => ed.use(partial)).toThrow(/partial.*late boom/);

    // whatever registered before the throw still works, and the editor keeps operating
    expect(ed.nodes.has('half')).toBe(true);
    const id = ed.createNode({ type: 'half', x: 1, y: 2, w: 10, h: 10 });
    expect(ed.store.has(id)).toBe(true);

    // a subsequent good plugin installs and disposes cleanly (no broken disposer was pushed)
    let disposed = false;
    const good: Plugin = {
      id: 'good',
      register: () => () => {
        disposed = true;
      },
    };
    const dispose = ed.use(good);
    dispose();
    expect(disposed).toBe(true);
  });
});
