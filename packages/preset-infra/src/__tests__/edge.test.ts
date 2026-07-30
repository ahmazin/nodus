import { describe, expect, it } from 'vitest';
import { defaultTheme, resolveTokens, type DrawApi, type EdgeRecord, type StrokeOpts, type Vec2 } from '@ahmazin/core';
import { infraConnectorUtil } from '../edge.js';

/** A minimal fake `DrawApi` recording the args each edge draw call receives. `DrawApi` is a concrete
 *  class (see `packages/core/src/renderer/draw-api.ts`), so — as with the stub `Ctx2D`s in the core
 *  renderer tests — we cast a plain object exposing only the methods `infraConnectorUtil.draw` actually
 *  calls. `edge.label` is left unset in every test here, so `drawEdgeLabel` short-circuits before
 *  touching any of the label-drawing methods this stub doesn't implement. */
function fakeDrawApi(): {
  api: DrawApi;
  strokes: { color: string; opts: StrokeOpts }[];
  arrowColors: string[];
} {
  const strokes: { color: string; opts: StrokeOpts }[] = [];
  const arrowColors: string[] = [];
  const api = {
    strokePolyline(_points: Vec2[], color: string, opts: StrokeOpts = {}) {
      strokes.push({ color, opts });
      return api;
    },
    arrowhead(_tip: Vec2, _angle: number, _size: number, color: string) {
      arrowColors.push(color);
      return api;
    },
  };
  return { api: api as unknown as DrawApi, strokes, arrowColors };
}

function edgeRecord(): EdgeRecord {
  return {
    id: 'edge:e1', typeName: 'edge', version: 0, type: 'infra.connector',
    from: { kind: 'point', x: 0, y: 0 }, to: { kind: 'point', x: 100, y: 0 },
    visual: { state: 'solid' }, props: {},
  };
}

const route: Vec2[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

describe('infraConnectorUtil.draw — stroke gradient', () => {
  it('passes a `gradient` opt to strokePolyline when tokens.strokeGradient is set', () => {
    const { api, strokes } = fakeDrawApi();
    const tokens = {
      ...resolveTokens(defaultTheme, { state: 'solid' }, 'infra.connector'),
      strokeGradient: { stops: [{ at: 0, color: '#ff0000' }, { at: 1, color: '#0000ff' }], angle: 0 },
    };

    infraConnectorUtil.draw(api, edgeRecord(), tokens, route);

    expect(strokes).toHaveLength(1);
    expect(strokes[0]!.opts.gradient).toEqual(tokens.strokeGradient);
  });

  it('omits the `gradient` opt (flat stroke) when tokens.strokeGradient is unset — unchanged behavior', () => {
    const { api, strokes } = fakeDrawApi();
    const tokens = resolveTokens(defaultTheme, { state: 'solid' }, 'infra.connector');

    infraConnectorUtil.draw(api, edgeRecord(), tokens, route);

    expect(strokes).toHaveLength(1);
    expect(strokes[0]!.opts.gradient).toBeUndefined();
    expect(strokes[0]!.color).toBe(tokens.stroke); // still strokes with the flat color
  });

  it('the arrowhead always uses the flat tokens.stroke, gradient or not', () => {
    const { api, arrowColors } = fakeDrawApi();
    const tokens = {
      ...resolveTokens(defaultTheme, { state: 'solid' }, 'infra.connector'),
      strokeGradient: { stops: [{ at: 0, color: '#ff0000' }, { at: 1, color: '#0000ff' }], angle: 0 },
    };

    infraConnectorUtil.draw(api, edgeRecord(), tokens, route);

    expect(arrowColors).toEqual([tokens.stroke]);
  });
});
