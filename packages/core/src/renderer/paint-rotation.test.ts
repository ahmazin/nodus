/**
 * The render half of node rotation: `paintItem` must wrap a rotated node's `draw` in a
 * translate→rotate→translate-back about its box center, and that transform must be perfectly
 * save/restore-balanced — including when `draw` throws, so the rotation can't leak onto the rest of
 * the frame and the error placeholder is drawn in the world (un-rotated) frame.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultTheme,
  type Ctx2D,
  type NodeRecord,
  type NodeRegistry,
  type NodeUtil,
  type RenderItem,
} from '../index.js';
import { paintItem, setPaintErrorHandler } from './paint.js';
import { clearTokenCache } from './token-cache.js';

/** A Ctx2D stub that models a per-save-scope "rotation applied" flag, so a test can assert both that
 *  the rotation transform is fully unwound (balanced saves) AND whether a rotation is in effect at the
 *  moment any draw op runs (e.g. the error placeholder must draw in the un-rotated world frame). */
function stubCtx() {
  let maxDepth = 0;
  const scopes: boolean[] = []; // one flag per live save() scope: true once rotate() ran within it
  const rotates: number[] = [];
  const translates: [number, number][] = [];
  const placeholderRotated: boolean[] = []; // rotation-active state at each strokeRect (placeholder)
  const rotationActive = () => scopes.some(Boolean);
  const ctx = {
    globalAlpha: 1,
    save() {
      scopes.push(false);
      if (scopes.length > maxDepth) maxDepth = scopes.length;
    },
    restore() {
      scopes.pop();
    },
    scale() {},
    translate(x: number, y: number) {
      translates.push([x, y]);
    },
    rotate(a: number) {
      rotates.push(a);
      if (scopes.length) scopes[scopes.length - 1] = true;
    },
    setTransform() {},
    transform() {},
    clearRect() {}, fillRect() {}, strokeRect() { placeholderRotated.push(rotationActive()); },
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, arcTo() {}, ellipse() {},
    quadraticCurveTo() {}, bezierCurveTo() {}, rect() {},
    fill() {}, stroke() {}, clip() {},
    fillText() {}, strokeText() {}, measureText: (t: string) => ({ width: t.length * 6 }),
    setLineDash() {}, drawImage() {},
    fillStyle: '', strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '', lineDashOffset: 0,
    font: '', textAlign: '', textBaseline: '', shadowBlur: 0, shadowColor: '', shadowOffsetX: 0, shadowOffsetY: 0,
  };
  return {
    ctx: ctx as unknown as Ctx2D,
    rotates,
    translates,
    get depth() { return scopes.length; },
    get maxDepth() { return maxDepth; },
    /** rotation-active state captured at each error-placeholder strokeRect. */
    placeholderRotated,
  };
}

function nodeItem(rotation?: number): RenderItem {
  const record = {
    id: 'node:a', typeName: 'node', version: 0, type: 'rect',
    x: 0, y: 0, w: 100, h: 20, z: '0', visual: { state: 'solid' }, props: {},
    ...(rotation === undefined ? {} : { rotation }),
  } as NodeRecord;
  return {
    id: record.id, kind: 'node', record,
    geometry: {} as RenderItem['geometry'],
    aabb: { x: 0, y: 0, w: 100, h: 20 },
    renderVersion: 0,
  };
}

function registryOf(draw: NodeUtil['draw']): NodeRegistry {
  const util: NodeUtil = { type: 'rect', getDefaultProps: () => ({}), getGeometry: () => ({}) as ReturnType<NodeUtil['getGeometry']>, draw };
  return { get: (t: string) => (t === 'rect' ? util : undefined) } as unknown as NodeRegistry;
}

const noEdges = { get: () => undefined } as unknown as Parameters<typeof paintItem>[3];

afterEach(() => {
  setPaintErrorHandler(null);
  clearTokenCache();
});

describe('paintItem — node rotation transform', () => {
  it('wraps a rotated node in a balanced rotate-about-center transform', () => {
    let drew = 0;
    const s = stubCtx();
    paintItem(s.ctx, nodeItem(Math.PI / 2), registryOf(() => { drew++; }), noEdges, defaultTheme);

    expect(drew).toBe(1);
    expect(s.rotates).toEqual([Math.PI / 2]); // rotated once, by the record's angle
    // translate to the box center (50,10) then back — the pivot from the frozen contract.
    expect(s.translates).toEqual([[50, 10], [-50, -10]]);
    expect(s.maxDepth).toBe(2); // outer alpha save + inner rotation save
    expect(s.depth).toBe(0); // fully unwound
  });

  it('does not apply a transform to an unrotated node (identity fast path)', () => {
    let drew = 0;
    const s = stubCtx();
    paintItem(s.ctx, nodeItem(), registryOf(() => { drew++; }), noEdges, defaultTheme);

    expect(drew).toBe(1);
    expect(s.rotates).toEqual([]);
    expect(s.translates).toEqual([]);
    expect(s.maxDepth).toBe(1); // only the outer alpha save
    expect(s.depth).toBe(0);
  });

  it('unwinds the rotation even when draw throws, and marks the gap in the world frame', () => {
    setPaintErrorHandler(() => {});
    const s = stubCtx();
    // draw throws mid-rotation; paintItem must catch, restore the rotation, and draw the placeholder.
    paintItem(s.ctx, nodeItem(Math.PI / 2), registryOf(() => { throw new Error('boom'); }), noEdges, defaultTheme);

    expect(s.rotates).toEqual([Math.PI / 2]); // rotation was applied...
    expect(s.depth).toBe(0); // ...and fully unwound despite the throw
    // the error placeholder (strokeRect) is drawn with NO rotation in effect — the rotation save was
    // popped by paintNode's finally before the exception reached paintItem's catch: world frame.
    expect(s.placeholderRotated).toEqual([false]);
  });
});
