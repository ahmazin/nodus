/**
 * Connection glow (Playground parity). `Editor.edgeGradientOverride` is the one place both of an
 * edge's endpoint node colors are reachable, so it computes not just the source→target stroke gradient
 * but — on a dark canvas — a soft glow in the edge's blended endpoint hue, which the connector util
 * forwards to `strokePolyline` as a shadow-blur halo. These tests drive a real `render()` with a
 * recording edge util that captures the exact tokens the override injected, so they fail if the glow
 * stops being added (dark) or leaks into light mode.
 */
import { describe, expect, it } from 'vitest';
import {
  Editor,
  defaultTheme,
  type Change,
  type Ctx2D,
  type EdgeRecord,
  type EdgeRouteContext,
  type EdgeUtil,
  type ResolvedTokens,
  type Theme,
  type Vec2,
} from '../index.js';

/** Permissive no-op canvas context — enough to drive a full `render()` headless. Gradient factories
 *  return a stub with `addColorStop`; `measureText` returns a zero width; every other member is an
 *  inert no-op. Mirrors the stub-ctx pattern in selection-halo.test.ts / render-perf.test.ts. */
function noopCtx(): Ctx2D {
  return new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient')
          return () => ({ addColorStop() {} });
        if (prop === 'measureText') return () => ({ width: 0 });
        if (prop === 'canvas') return { width: 0, height: 0 };
        return () => {};
      },
      set: () => true,
    },
  ) as unknown as Ctx2D;
}

interface Sink {
  glow: (string | null | undefined)[];
  grad: boolean[];
}

/** An edge util that records the `glow`/`strokeGradient` tokens each draw receives, so a test can
 *  observe exactly what `edgeGradientOverride` merged in for the edge. */
function recordingEdgeUtil(sink: Sink): EdgeUtil {
  return {
    type: 'test.glow',
    getRoute: (_edge: EdgeRecord, ctx: EdgeRouteContext): Vec2[] => [ctx.from, ctx.to],
    draw: (_api, _edge, tokens: ResolvedTokens): void => {
      sink.glow.push(tokens.glow);
      sink.grad.push(!!tokens.strokeGradient);
    },
  };
}

/** Two rect nodes joined by one `test.glow` edge, rendered once through the given theme. `edgeStyle`,
 *  when given, is the edge's per-record style override (e.g. a user-picked stroke). Returns what the
 *  edge's draw observed. */
function renderNodeToNodeEdge(theme: Theme, edgeStyle?: { stroke?: string }): Sink {
  const ed = new Editor({ theme });
  const sink: Sink = { glow: [], grad: [] };
  ed.registerEdgeType(recordingEdgeUtil(sink));
  const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 80, h: 50 });
  const b = ed.createNode({ type: 'rect', x: 300, y: 200, w: 80, h: 50 });
  ed.store.apply([
    {
      op: 'add',
      record: {
        id: 'edge:e1' as EdgeRecord['id'],
        typeName: 'edge',
        version: 0,
        type: 'test.glow',
        from: { kind: 'outline', nodeId: a },
        to: { kind: 'outline', nodeId: b },
        visual: { state: 'solid' },
        props: {},
        ...(edgeStyle ? { style: edgeStyle } : {}),
      },
    } as Change,
  ]);
  ed.render(noopCtx(), 800, 600, 1, true, 0);
  return sink;
}

describe('edge connection glow (Playground parity)', () => {
  it('injects a glow into a node-to-node edge on a dark canvas', () => {
    const sink = renderNodeToNodeEdge(defaultTheme); // appearance: 'dark'
    // the endpoint gradient override ran (both endpoints resolved to node colors)...
    expect(sink.grad.some(Boolean)).toBe(true);
    // ...and carried a non-empty glow color for the connector util to bloom
    expect(sink.glow.some((g) => typeof g === 'string' && g.length > 0)).toBe(true);
  });

  it('omits the glow on a light canvas — a symmetric blur halo muddies light mode', () => {
    const sink = renderNodeToNodeEdge({ ...defaultTheme, appearance: 'light' });
    // the gradient is still applied (proving the override ran)...
    expect(sink.grad.some(Boolean)).toBe(true);
    // ...but no glow is injected on light
    expect(sink.glow.every((g) => !g)).toBe(true);
  });

  it('an explicit picked stroke wins over the auto endpoint gradient (color picker works)', () => {
    // A user picking an edge color in Properties writes `record.style.stroke`; the auto source→target
    // gradient must step aside so the flat pick actually renders (else the picker looks broken).
    const sink = renderNodeToNodeEdge(defaultTheme, { stroke: '#ff00ff' });
    expect(sink.grad.every((g) => !g)).toBe(true); // NO gradient — the pick is honored flat
    // On dark, the edge still glows, but in the picked hue (not a blend of endpoints).
    expect(sink.glow.some((g) => g === '#ff00ff')).toBe(true);
  });

  it('a picked stroke on a light canvas renders flat — no gradient, no glow', () => {
    const sink = renderNodeToNodeEdge({ ...defaultTheme, appearance: 'light' }, { stroke: '#ff00ff' });
    expect(sink.grad.every((g) => !g)).toBe(true);
    expect(sink.glow.every((g) => !g)).toBe(true);
  });
});
