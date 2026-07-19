/**
 * SVG export correctness. Runs headless (node env, no DOM): builds a scene with the core `Editor`,
 * renders it through `renderSVG`, and asserts the emitted markup is a well-formed, deterministic SVG
 * carrying the scene's shapes and labels. Also unit-tests the `SVGContext` primitives directly so a
 * regression in a single `Ctx2D` method (path building, transforms, styling) is pinpointed.
 */
import { describe, expect, it } from 'vitest';
import { Editor, SVGContext, renderSVG } from '../index.js';

/** Count non-overlapping occurrences of `needle` in `hay`. */
function count(hay: string, needle: string): number {
  return hay.split(needle).length - 1;
}

/** A minimal well-formedness check for the tags this backend emits (no jsdom in this env). */
function assertBalanced(svg: string): void {
  expect(count(svg, '<svg')).toBe(1);
  expect(count(svg, '</svg>')).toBe(1);
  // every group / text open tag has a matching close
  expect(count(svg, '<g ')).toBe(count(svg, '</g>'));
  expect(count(svg, '<text ')).toBe(count(svg, '</text>'));
  // no serialization holes leaked into attributes
  expect(svg).not.toContain('NaN');
  expect(svg).not.toContain('undefined');
}

function buildScene(): Editor {
  const ed = new Editor();
  const a = ed.createNode({ type: 'rect', x: 40, y: 40, w: 120, h: 60, label: 'Alpha' });
  const b = ed.createNode({ type: 'rect', x: 260, y: 160, w: 120, h: 60, label: 'Beta' });
  ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b });
  return ed;
}

describe('renderSVG', () => {
  it('produces a well-formed SVG document carrying the scene shapes and labels', () => {
    const svg = renderSVG(buildScene());

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toMatch(/<svg[^>]*\bwidth="\d+"[^>]*\bheight="\d+"[^>]*\bviewBox="0 0 \d+ \d+"/);

    // background rect + round-rect node bodies (paths from arcTo) + edge polyline (a path)
    expect(svg).toContain('<rect');
    expect(svg).toContain('<path');
    // a rounded corner must have emitted at least one elliptical-arc command
    expect(svg).toMatch(/d="[^"]*A/);

    // node labels are present as text
    expect(svg).toContain('>Alpha<');
    expect(svg).toContain('>Beta<');

    assertBalanced(svg);
    expect(svg.length).toBeGreaterThan(100);
  });

  it('is deterministic — the same scene serializes to the identical string', () => {
    const a = renderSVG(buildScene());
    const b = renderSVG(buildScene());
    expect(a).toBe(b);
  });

  it('emits a transform group for a rotated node', () => {
    const ed = new Editor();
    ed.createNode({ type: 'rect', x: 0, y: 0, w: 80, h: 40, rotation: Math.PI / 6, label: 'Rot' });
    const svg = renderSVG(ed);
    expect(svg).toContain('<g transform="matrix(');
    assertBalanced(svg);
  });

  it('XML-escapes label text', () => {
    const ed = new Editor();
    ed.createNode({ type: 'rect', x: 0, y: 0, w: 120, h: 40, label: '<A & B>' });
    const svg = renderSVG(ed);
    expect(svg).toContain('&lt;A &amp; B&gt;');
    expect(svg).not.toContain('<A & B>');
    assertBalanced(svg);
  });

  it('renders an empty scene as a valid SVG (padded fallback region)', () => {
    const svg = renderSVG(new Editor());
    expect(svg.startsWith('<svg')).toBe(true);
    assertBalanced(svg);
  });

  it('honors background:false by omitting the canvas fill rect', () => {
    const withBg = renderSVG(buildScene());
    const noBg = renderSVG(buildScene(), { background: false });
    expect(count(noBg, '<rect')).toBeLessThan(count(withBg, '<rect'));
  });
});

describe('SVGContext primitives', () => {
  it('turns a rect path into a closed <path> with the current fill', () => {
    const ctx = new SVGContext();
    ctx.beginPath();
    ctx.rect(0, 0, 10, 20);
    ctx.fillStyle = '#ff0000';
    ctx.fill();
    const svg = ctx.toSVG(10, 20);
    expect(svg).toContain('<path d="M0 0 L10 0 L10 20 L0 20 Z" fill="#ff0000"/>');
  });

  it('fillRect emits a <rect> element', () => {
    const ctx = new SVGContext();
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(1, 2, 3, 4);
    expect(ctx.toSVG(10, 10)).toContain('<rect x="1" y="2" width="3" height="4" fill="#00ff00"/>');
  });

  it('converts a full-circle arc into two elliptical-arc commands', () => {
    const ctx = new SVGContext();
    ctx.beginPath();
    ctx.arc(50, 50, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#123456';
    ctx.fill();
    const svg = ctx.toSVG(100, 100);
    expect(count(svg, ' A')).toBe(2); // two half-arcs make the circle
    expect(svg).toContain('fill="#123456"');
  });

  it('wraps elements in a transform group only when the CTM is not identity', () => {
    const ctx = new SVGContext();
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 1, 1); // identity CTM -> no group
    ctx.translate(5, 7);
    ctx.fillRect(0, 0, 2, 2); // translated -> wrapped
    const svg = ctx.toSVG(20, 20);
    expect(svg).toContain('<rect x="0" y="0" width="1" height="1"');
    expect(svg).toContain('<g transform="matrix(1 0 0 1 5 7)">');
  });

  it('emits stroke dash and alpha attributes', () => {
    const ctx = new SVGContext();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(10, 0);
    ctx.strokeStyle = '#abcdef';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    const svg = ctx.toSVG(10, 10);
    expect(svg).toContain('stroke="#abcdef"');
    expect(svg).toContain('stroke-width="2"');
    expect(svg).toContain('stroke-dasharray="4,3"');
    expect(svg).toContain('stroke-opacity="0.5"');
  });

  it('save/restore snapshots both style and transform', () => {
    const ctx = new SVGContext();
    ctx.fillStyle = '#111111';
    ctx.save();
    ctx.fillStyle = '#222222';
    ctx.translate(100, 100);
    ctx.restore();
    ctx.fillRect(0, 0, 1, 1); // should be back to #111111 and identity CTM
    const svg = ctx.toSVG(10, 10);
    expect(svg).toContain('<rect x="0" y="0" width="1" height="1" fill="#111111"/>');
    expect(svg).not.toContain('<g transform');
  });

  it('approximates measureText from the font size', () => {
    const ctx = new SVGContext();
    ctx.font = '20px Inter';
    expect(ctx.measureText('abcd').width).toBeCloseTo(4 * 20 * 0.6);
  });
});
