/**
 * Sketchy (hand-drawn) render style — determinism + opt-in guarantees.
 *
 * The whole point of this style is that it must NOT break Nodus's moat: canonical serialization and
 * stable headless renders. So the tests here assert three load-bearing properties by recording the
 * exact ordered sequence of `Ctx2D` calls a primitive makes:
 *   1. roughness > 0 with a fixed seed is byte-for-byte reproducible (seeded, never `Math.random`);
 *   2. the seed and the roughness both actually change the output (it's really per-shape jitter);
 *   3. roughness 0 / undefined paints the exact clean path — no jitter, seed inert — so existing
 *      renders and `canonical.test.ts` are untouched.
 */

import { describe, expect, it } from 'vitest';
import { DrawApi, hashId } from './draw-api.js';
import type { Ctx2D } from './context.js';
import type { ResolvedTokens } from '../theme/index.js';
import type { Box, Vec2 } from '../model.js';

/** A Ctx2D that appends every method call (with args) and every property write to an ordered log.
 *  Two runs that log an identical sequence produced an identical paint — the determinism oracle. */
function recordingCtx(): { ctx: Ctx2D; log: string[] } {
  const log: string[] = [];
  const fmt = (v: unknown): string => (typeof v === 'number' ? v.toString() : String(v));
  const methods = [
    'save', 'restore', 'scale', 'translate', 'rotate', 'setTransform', 'transform',
    'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo',
    'arc', 'arcTo', 'ellipse', 'quadraticCurveTo', 'bezierCurveTo', 'rect', 'fill', 'stroke',
    'clip', 'fillText', 'strokeText', 'drawImage', 'setLineDash',
  ];
  const obj: Record<string, unknown> = {
    fillStyle: '', strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '', lineDashOffset: 0,
    font: '', textAlign: '', textBaseline: '', globalAlpha: 1,
    shadowBlur: 0, shadowColor: '', shadowOffsetX: 0, shadowOffsetY: 0,
    measureText: (t: string) => ({ width: t.length * 6 }),
  };
  for (const m of methods) obj[m] = (...args: unknown[]) => log.push(`${m}(${args.map(fmt).join(',')})`);
  const ctx = new Proxy(obj, {
    set(t, prop: string, value) {
      log.push(`${prop}=${fmt(value)}`);
      (t as Record<string, unknown>)[prop] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as Ctx2D, log };
}

function tokens(roughness?: number): ResolvedTokens {
  return {
    fill: '#161616',
    stroke: '#3a3a3a',
    strokeWidth: 1,
    text: '#e5e5e5',
    opacity: 1,
    fontScale: 1,
    radius: 6,
    roughness,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 1.3,
  };
}

const BOX: Box = { x: 10, y: 20, w: 120, h: 60 };
const LINE: Vec2[] = [{ x: 0, y: 0 }, { x: 40, y: 10 }, { x: 80, y: 0 }];

/** Render one primitive and return the recorded call log. */
function renderRect(seed: number, roughness?: number): string[] {
  const { ctx, log } = recordingCtx();
  new DrawApi(ctx, tokens(roughness), seed).strokeRoundRect(BOX, 6, '#fff', { width: 2 });
  return log;
}

const count = (log: string[], needle: string): number =>
  log.filter((l) => l.startsWith(needle)).length;

describe('hashId', () => {
  it('is a stable uint32, same id → same seed, different id → different seed', () => {
    expect(hashId('node-a')).toBe(hashId('node-a')); // stable
    expect(hashId('node-a')).not.toBe(hashId('node-b')); // distinct
    const h = hashId('some-record-id');
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('sketchy stroke — determinism', () => {
  it('same seed + roughness renders a byte-identical call sequence', () => {
    const a = renderRect(hashId('n1'), 2);
    const b = renderRect(hashId('n1'), 2);
    expect(a).toEqual(b); // seeded, reproducible — this is what protects headless-render stability
    expect(a.length).toBeGreaterThan(0);
  });

  it('is hand-drawn: bowed segments (quadraticCurveTo) and a double stroke', () => {
    const log = renderRect(hashId('n1'), 2);
    expect(count(log, 'quadraticCurveTo(')).toBeGreaterThan(0); // bowed, not straight arcTo corners
    expect(count(log, 'arcTo(')).toBe(0); // the clean rounded-rect path is NOT used
    expect(count(log, 'stroke(')).toBe(2); // characteristic double stroke
  });

  it('a different shape id produces different (but still deterministic) jitter', () => {
    const a = renderRect(hashId('n1'), 2);
    const b = renderRect(hashId('n2'), 2);
    expect(a).not.toEqual(b); // per-shape seed actually varies the wobble
    expect(renderRect(hashId('n2'), 2)).toEqual(b); // ...and n2 is itself reproducible
  });

  it('a different roughness produces different output for the same shape', () => {
    const a = renderRect(hashId('n1'), 1);
    const b = renderRect(hashId('n1'), 3);
    expect(a).not.toEqual(b);
  });
});

describe('sketchy stroke — off by default is the clean path', () => {
  it('roughness 0 and undefined both paint the exact clean rounded-rect (arcTo), no jitter', () => {
    const zero = renderRect(hashId('n1'), 0);
    const unset = renderRect(hashId('n1'), undefined);
    expect(zero).toEqual(unset); // 0 and undefined are the same "off" path
    expect(count(zero, 'arcTo(')).toBe(4); // real rounded-rect corners
    expect(count(zero, 'quadraticCurveTo(')).toBe(0); // no sketch tracing
    expect(count(zero, 'stroke(')).toBe(1); // single, clean stroke
  });

  it('the seed is inert when roughness is off — clean output is identical regardless of id', () => {
    // Proves roughness 0 is byte-for-byte today's rendering: the sketchy seed can never perturb it.
    expect(renderRect(hashId('n1'), 0)).toEqual(renderRect(hashId('n2'), 0));
    expect(renderRect(12345, 0)).toEqual(renderRect(0, 0));
  });
});

describe('sketchy stroke — applies to ellipse and polyline too', () => {
  it('ellipse: clean uses ellipse(), sketchy bows and doubles — both deterministic', () => {
    const clean = () => {
      const { ctx, log } = recordingCtx();
      new DrawApi(ctx, tokens(0), hashId('e1')).strokeEllipse(BOX, '#fff');
      return log;
    };
    const sketchy = (seed: number) => {
      const { ctx, log } = recordingCtx();
      new DrawApi(ctx, tokens(2), seed).strokeEllipse(BOX, '#fff');
      return log;
    };
    expect(count(clean(), 'ellipse(')).toBe(1);
    const s = sketchy(hashId('e1'));
    expect(count(s, 'ellipse(')).toBe(0);
    expect(count(s, 'quadraticCurveTo(')).toBeGreaterThan(0);
    expect(count(s, 'stroke(')).toBe(2);
    expect(sketchy(hashId('e1'))).toEqual(s); // deterministic
  });

  it('polyline: clean uses lineTo, sketchy is deterministic and seed-sensitive', () => {
    const clean = () => {
      const { ctx, log } = recordingCtx();
      new DrawApi(ctx, tokens(0), hashId('p1')).strokePolyline(LINE, '#fff');
      return log;
    };
    const sketchy = (seed: number) => {
      const { ctx, log } = recordingCtx();
      new DrawApi(ctx, tokens(2), seed).strokePolyline(LINE, '#fff');
      return log;
    };
    expect(count(clean(), 'lineTo(')).toBeGreaterThan(0);
    expect(count(clean(), 'quadraticCurveTo(')).toBe(0);
    const s1 = sketchy(hashId('p1'));
    expect(count(s1, 'quadraticCurveTo(')).toBeGreaterThan(0);
    expect(sketchy(hashId('p1'))).toEqual(s1); // reproducible
    expect(sketchy(hashId('p2'))).not.toEqual(s1); // seed-sensitive
  });
});
