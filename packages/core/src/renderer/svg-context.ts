/**
 * `SVGContext` — a `Ctx2D` implementation that *records* the renderer's draw calls as SVG markup
 * instead of rasterizing them. Because the whole renderer (`paintItem`, `DrawApi`, every registered
 * `NodeUtil.draw`) is written against the `Ctx2D` abstraction, driving `editor.paintRegion` with an
 * instance of this class yields a vector export with no changes to any drawing code.
 *
 * Design:
 *  - Each drawn element (path / rect / text / image) is emitted as a self-contained SVG element and,
 *    when the current transform matrix is not the identity, wrapped in `<g transform="matrix(...)">`.
 *    So node rotation/scale and canvas `lineWidth` (a user-space quantity) fall out of SVG's own
 *    transform semantics — no coordinate baking, no stroke-width rescaling.
 *  - `save()`/`restore()` snapshot BOTH the transform matrix and the full drawing-style state onto one
 *    stack, mirroring how Canvas-2D conflates the two under a single save/restore.
 *  - Output is deterministic: numbers are rounded and attributes are emitted in a fixed order, so the
 *    same scene always serializes to the same string.
 *
 * Documented v1 limitations (all no-ops or approximations, never errors):
 *  - `clip()` is a no-op — nothing is clipped. Image nodes in `'cover'` fit may overflow their box.
 *  - Shadows/glow (`shadowBlur`/`shadowColor`) are ignored; the shape still fills with its color.
 *  - `measureText` approximates width as `text.length * fontSize * 0.6` (there is no font engine here).
 *  - `drawImage` emits `<image href>` only if the drawable exposes a string `src`/`currentSrc`;
 *    otherwise a dashed placeholder box is drawn. The engine-owned `DrawableImage` type only
 *    guarantees `width`/`height`, so the href is read best-effort.
 *  - Linear and radial gradients render as `<linearGradient>`/`<radialGradient>` defs (see
 *    `paintValue`); other paint types (patterns) are not supported.
 *  - `createRadialGradient`'s `r0` (inner/start radius) is not serialized — SVG's `<radialGradient>`
 *    emits `fx`/`fy` (focal point) but has no `fr`-equivalent for a nonzero start radius pre-SVG2, so a
 *    nonzero `r0` is approximated (effectively treated as 0) rather than reproduced exactly.
 */

import type { Ctx2D, CanvasGradientLike, DrawableImage } from './context.js';

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

type SVGPaint = string | SVGGradient | SVGRadialGradient;

interface StyleState {
  fillStyle: SVGPaint;
  strokeStyle: SVGPaint;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  lineDash: number[];
  lineDashOffset: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  globalAlpha: number;
  shadowBlur: number;
  shadowColor: string;
  shadowOffsetX: number;
  shadowOffsetY: number;
}

interface Point {
  x: number;
  y: number;
}

const TAU = Math.PI * 2;

/** Round to 3 decimals and render compactly; normalizes `-0` and non-finite values to `0`. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Post-multiply (Canvas semantics): result = m1 * m2. */
function multiply(m1: Matrix, m2: Matrix): Matrix {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

function isIdentity(m: Matrix): boolean {
  return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
}

/** canvas `textAlign` -> SVG `text-anchor` (`''` means "leave default: start"). */
function anchorFor(align: string): string {
  if (align === 'center') return 'middle';
  if (align === 'right' || align === 'end') return 'end';
  return ''; // left / start
}

/** canvas `textBaseline` -> SVG `dominant-baseline` (`''` means "leave default: alphabetic"). */
function baselineFor(b: string): string {
  switch (b) {
    case 'top':
      return 'text-before-edge';
    case 'middle':
      return 'central';
    case 'bottom':
      return 'text-after-edge';
    case 'hanging':
      return 'hanging';
    case 'ideographic':
      return 'ideographic';
    default:
      return ''; // alphabetic
  }
}

/** Parse a CSS shorthand `font` into the pieces SVG needs. Size and family are extracted reliably;
 *  weight/style are best-effort from the tokens preceding the `<size>px`. */
function parseFont(font: string): { size: number; family: string; weight: string; style: string } {
  const m = font.match(/(\d*\.?\d+)px/);
  if (!m || m.index === undefined) return { size: 14, family: 'sans-serif', weight: '', style: '' };
  const size = parseFloat(m[1] ?? '14');
  const family = font.slice(m.index + m[0].length).trim() || 'sans-serif';
  let weight = '';
  let style = '';
  for (const tok of font.slice(0, m.index).trim().split(/\s+/)) {
    if (!tok || tok === 'normal') continue;
    if (tok === 'italic' || tok === 'oblique') style = tok;
    else if (tok === 'bold' || tok === 'bolder' || tok === 'lighter' || /^[1-9]00$/.test(tok))
      weight = tok;
  }
  return { size, family, weight, style };
}

/** Records a linear gradient's geometry + stops; serialized to a `<linearGradient>` def by SVGContext. */
class SVGGradient implements CanvasGradientLike {
  readonly stops: { offset: number; color: string }[] = [];
  constructor(
    readonly x0: number,
    readonly y0: number,
    readonly x1: number,
    readonly y1: number,
  ) {}
  addColorStop(offset: number, color: string): void {
    this.stops.push({ offset, color });
  }
}

/** Records a radial gradient's geometry + stops; serialized to a `<radialGradient>` def by SVGContext. */
class SVGRadialGradient implements CanvasGradientLike {
  readonly stops: { offset: number; color: string }[] = [];
  constructor(
    readonly x0: number,
    readonly y0: number,
    readonly r0: number,
    readonly x1: number,
    readonly y1: number,
    readonly r1: number,
  ) {}
  addColorStop(offset: number, color: string): void {
    this.stops.push({ offset, color });
  }
}

export class SVGContext implements Ctx2D {
  private body: string[] = [];
  private ctm: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  private stack: { ctm: Matrix; style: StyleState }[] = [];
  private defs: string[] = [];
  private gradSeq = 0;
  private radGradSeq = 0;

  // path accumulation (in the current user space; the transform is applied via the wrapping <g>)
  private path: string[] = [];
  private current: Point | null = null;
  private subpathStart: Point | null = null;

  private style: StyleState = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    lineDash: [],
    lineDashOffset: 0,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    shadowBlur: 0,
    shadowColor: 'transparent',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  };

  /** Append pre-built SVG markup verbatim, rendered after everything drawn so far (i.e. on top). It is
   *  NOT wrapped in the current CTM — the caller supplies any needed `<g transform>`. Used for a
   *  post-pass that isn't expressible as `Ctx2D` draw calls, e.g. native flow animations. */
  raw(markup: string): void {
    this.body.push(markup);
  }

  /** Serialize everything drawn so far into a complete `<svg>` document of the given pixel size. */
  toSVG(width: number, height: number): string {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const defs = this.defs.length ? `<defs>${this.defs.join('')}</defs>` : '';
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ` +
      `viewBox="0 0 ${w} ${h}">${defs}${this.body.join('')}</svg>`
    );
  }

  // ---- element emission ----

  /** Append an element, wrapping it in a transform group when the CTM is not the identity. */
  private emit(el: string): void {
    const m = this.ctm;
    if (isIdentity(m)) {
      this.body.push(el);
    } else {
      this.body.push(
        `<g transform="matrix(${fmt(m.a)} ${fmt(m.b)} ${fmt(m.c)} ${fmt(m.d)} ` +
          `${fmt(m.e)} ${fmt(m.f)})">${el}</g>`,
      );
    }
  }

  // ---- state (save/restore snapshot BOTH transform and style) ----

  save(): void {
    this.stack.push({ ctm: { ...this.ctm }, style: { ...this.style, lineDash: [...this.style.lineDash] } });
  }

  restore(): void {
    const s = this.stack.pop();
    if (!s) return;
    this.ctm = s.ctm;
    this.style = s.style;
  }

  // ---- transforms ----

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.ctm = { a, b, c, d, e, f };
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.ctm = multiply(this.ctm, { a, b, c, d, e, f });
  }

  translate(x: number, y: number): void {
    this.ctm = multiply(this.ctm, { a: 1, b: 0, c: 0, d: 1, e: x, f: y });
  }

  scale(x: number, y: number): void {
    this.ctm = multiply(this.ctm, { a: x, b: 0, c: 0, d: y, e: 0, f: 0 });
  }

  rotate(angle: number): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    this.ctm = multiply(this.ctm, { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 });
  }

  // ---- rects ----

  clearRect(): void {
    // SVG starts transparent; there is nothing to clear.
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const s = this.style;
    let attrs = `x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" fill="${this.paintValue(s.fillStyle)}"`;
    if (s.globalAlpha < 1) attrs += ` fill-opacity="${fmt(s.globalAlpha)}"`;
    this.emit(`<rect ${attrs}/>`);
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    const s = this.style;
    let attrs = `x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" fill="none" stroke="${this.paintValue(s.strokeStyle)}" stroke-width="${fmt(s.lineWidth)}"`;
    attrs += this.strokeExtras();
    this.emit(`<rect ${attrs}/>`);
  }

  // ---- path building (user-space coords; group transform applies the CTM) ----

  beginPath(): void {
    this.path = [];
    this.current = null;
    this.subpathStart = null;
  }

  closePath(): void {
    if (this.path.length === 0) return;
    this.path.push('Z');
    this.current = this.subpathStart ? { ...this.subpathStart } : null;
  }

  moveTo(x: number, y: number): void {
    this.path.push(`M${fmt(x)} ${fmt(y)}`);
    this.current = { x, y };
    this.subpathStart = { x, y };
  }

  lineTo(x: number, y: number): void {
    if (!this.current) {
      this.moveTo(x, y);
      return;
    }
    this.path.push(`L${fmt(x)} ${fmt(y)}`);
    this.current = { x, y };
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    if (!this.current) this.moveTo(cpx, cpy);
    this.path.push(`Q${fmt(cpx)} ${fmt(cpy)} ${fmt(x)} ${fmt(y)}`);
    this.current = { x, y };
  }

  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    if (!this.current) this.moveTo(c1x, c1y);
    this.path.push(`C${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(x)} ${fmt(y)}`);
    this.current = { x, y };
  }

  rect(x: number, y: number, w: number, h: number): void {
    // A self-contained closed subpath; canvas leaves the current point at (x, y) afterwards.
    this.path.push(
      `M${fmt(x)} ${fmt(y)}`,
      `L${fmt(x + w)} ${fmt(y)}`,
      `L${fmt(x + w)} ${fmt(y + h)}`,
      `L${fmt(x)} ${fmt(y + h)}`,
      'Z',
    );
    this.current = { x, y };
    this.subpathStart = { x, y };
  }

  arc(x: number, y: number, r: number, a0: number, a1: number, ccw = false): void {
    this.ellipseArc(x, y, r, r, 0, a0, a1, ccw);
  }

  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    a0: number,
    a1: number,
    ccw = false,
  ): void {
    this.ellipseArc(x, y, rx, ry, rotation, a0, a1, ccw);
  }

  /** Tangent-based rounded corner: line to the first tangent point, then an arc to the second. */
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    if (!this.current) {
      this.moveTo(x1, y1);
      return;
    }
    const { x: x0, y: y0 } = this.current;
    const dx0 = x0 - x1;
    const dy0 = y0 - y1;
    const dx2 = x2 - x1;
    const dy2 = y2 - y1;
    const d0 = Math.hypot(dx0, dy0);
    const d2 = Math.hypot(dx2, dy2);
    if (d0 < 1e-9 || d2 < 1e-9 || r <= 0) {
      this.lineTo(x1, y1);
      return;
    }
    let cosA = (dx0 * dx2 + dy0 * dy2) / (d0 * d2);
    cosA = Math.max(-1, Math.min(1, cosA));
    const angle = Math.acos(cosA);
    if (angle < 1e-6 || Math.abs(angle - Math.PI) < 1e-6) {
      this.lineTo(x1, y1); // collinear — no corner to round
      return;
    }
    const dist = r / Math.tan(angle / 2);
    const t0x = x1 + (dx0 / d0) * dist;
    const t0y = y1 + (dy0 / d0) * dist;
    const t2x = x1 + (dx2 / d2) * dist;
    const t2y = y1 + (dy2 / d2) * dist;
    // Turn direction (incoming P0->P1 crossed with outgoing P1->P2): >0 is clockwise in y-down space.
    const turn = (x1 - x0) * (y2 - y1) - (y1 - y0) * (x2 - x1);
    const sweep = turn > 0 ? 1 : 0;
    this.lineTo(t0x, t0y);
    this.path.push(`A${fmt(r)} ${fmt(r)} 0 0 ${sweep} ${fmt(t2x)} ${fmt(t2y)}`);
    this.current = { x: t2x, y: t2y };
  }

  private ptOnEllipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    rot: number,
    t: number,
  ): Point {
    const ct = Math.cos(t);
    const st = Math.sin(t);
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const ex = rx * ct;
    const ey = ry * st;
    return { x: cx + ex * cr - ey * sr, y: cy + ex * sr + ey * cr };
  }

  /** Emit A-command(s) for a canvas `arc`/`ellipse`. Full sweeps are split into two ≤180° arcs
   *  because a single SVG `A` cannot describe a 360° path (its endpoints would coincide). */
  private ellipseArc(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    rot: number,
    a0: number,
    a1: number,
    ccw: boolean,
  ): void {
    let da = (a1 - a0) % TAU;
    if (!ccw) {
      if (da <= 0) da += TAU; // clockwise: (0, TAU]
    } else if (da >= 0) {
      da -= TAU; // counterclockwise: [-TAU, 0)
    }
    const rotDeg = (rot * 180) / Math.PI;
    const sweep = ccw ? 0 : 1;
    const start = this.ptOnEllipse(cx, cy, rx, ry, rot, a0);
    // Connect: canvas draws a line from the current point to the arc start, else starts a new subpath.
    if (this.current) this.path.push(`L${fmt(start.x)} ${fmt(start.y)}`);
    else this.path.push(`M${fmt(start.x)} ${fmt(start.y)}`);
    this.subpathStart ??= { ...start };

    if (Math.abs(da) >= TAU - 1e-9) {
      // full ellipse — two half arcs
      const mid = this.ptOnEllipse(cx, cy, rx, ry, rot, a0 + da / 2);
      this.path.push(`A${fmt(rx)} ${fmt(ry)} ${fmt(rotDeg)} 0 ${sweep} ${fmt(mid.x)} ${fmt(mid.y)}`);
      this.path.push(
        `A${fmt(rx)} ${fmt(ry)} ${fmt(rotDeg)} 0 ${sweep} ${fmt(start.x)} ${fmt(start.y)}`,
      );
      this.current = { ...start };
    } else {
      const end = this.ptOnEllipse(cx, cy, rx, ry, rot, a1);
      const large = Math.abs(da) > Math.PI ? 1 : 0;
      this.path.push(
        `A${fmt(rx)} ${fmt(ry)} ${fmt(rotDeg)} ${large} ${sweep} ${fmt(end.x)} ${fmt(end.y)}`,
      );
      this.current = { ...end };
    }
  }

  // ---- paint the current path ----

  private strokeExtras(): string {
    const s = this.style;
    let out = '';
    if (s.globalAlpha < 1) out += ` stroke-opacity="${fmt(s.globalAlpha)}"`;
    if (s.lineCap && s.lineCap !== 'butt') out += ` stroke-linecap="${s.lineCap}"`;
    if (s.lineJoin && s.lineJoin !== 'miter') out += ` stroke-linejoin="${s.lineJoin}"`;
    if (s.lineDash.length > 0) {
      out += ` stroke-dasharray="${s.lineDash.map(fmt).join(',')}"`;
      if (s.lineDashOffset) out += ` stroke-dashoffset="${fmt(s.lineDashOffset)}"`;
    }
    return out;
  }

  fill(fillRule?: 'nonzero' | 'evenodd'): void {
    if (this.path.length === 0) return;
    const s = this.style;
    let attrs = `d="${this.path.join(' ')}" fill="${this.paintValue(s.fillStyle)}"`;
    if (fillRule === 'evenodd') attrs += ` fill-rule="evenodd"`;
    if (s.globalAlpha < 1) attrs += ` fill-opacity="${fmt(s.globalAlpha)}"`;
    this.emit(`<path ${attrs}/>`);
  }

  stroke(): void {
    if (this.path.length === 0) return;
    const s = this.style;
    let attrs = `d="${this.path.join(' ')}" fill="none" stroke="${this.paintValue(s.strokeStyle)}" stroke-width="${fmt(s.lineWidth)}"`;
    attrs += this.strokeExtras();
    this.emit(`<path ${attrs}/>`);
  }

  clip(): void {
    // v1: not supported — nothing is clipped (see file header).
  }

  // ---- text ----

  fillText(text: string, x: number, y: number): void {
    this.text(text, x, y, false);
  }

  strokeText(text: string, x: number, y: number): void {
    this.text(text, x, y, true);
  }

  private text(text: string, x: number, y: number, stroked: boolean): void {
    const s = this.style;
    const { size, family, weight, style } = parseFont(s.font);
    let attrs = `x="${fmt(x)}" y="${fmt(y)}" font-family="${escapeAttr(family)}" font-size="${fmt(size)}"`;
    if (weight) attrs += ` font-weight="${weight}"`;
    if (style) attrs += ` font-style="${style}"`;
    const anchor = anchorFor(s.textAlign);
    if (anchor) attrs += ` text-anchor="${anchor}"`;
    const baseline = baselineFor(s.textBaseline);
    if (baseline) attrs += ` dominant-baseline="${baseline}"`;
    if (stroked) {
      attrs += ` fill="none" stroke="${this.paintValue(s.strokeStyle)}" stroke-width="${fmt(s.lineWidth)}"`;
      if (s.globalAlpha < 1) attrs += ` stroke-opacity="${fmt(s.globalAlpha)}"`;
    } else {
      attrs += ` fill="${this.paintValue(s.fillStyle)}"`;
      if (s.globalAlpha < 1) attrs += ` fill-opacity="${fmt(s.globalAlpha)}"`;
    }
    this.emit(`<text ${attrs}>${escapeText(text)}</text>`);
  }

  measureText(text: string): { width: number } {
    const { size } = parseFont(this.style.font);
    return { width: text.length * size * 0.6 };
  }

  // ---- images ----

  drawImage(
    image: DrawableImage,
    a: number,
    b: number,
    c: number,
    d: number,
    e?: number,
    f?: number,
    g?: number,
    h?: number,
  ): void {
    // 5-arg form: (image, dx, dy, dw, dh). 9-arg form: (image, sx, sy, sw, sh, dx, dy, dw, dh).
    const dx = e === undefined ? a : e;
    const dy = e === undefined ? b : (f as number);
    const dw = e === undefined ? c : (g as number);
    const dh = e === undefined ? d : (h as number);
    const src = (image as { src?: unknown; currentSrc?: unknown }).src;
    const cur = (image as { src?: unknown; currentSrc?: unknown }).currentSrc;
    const href = typeof src === 'string' ? src : typeof cur === 'string' ? cur : '';
    if (href) {
      this.emit(
        `<image href="${escapeAttr(href)}" x="${fmt(dx)}" y="${fmt(dy)}" ` +
          `width="${fmt(dw)}" height="${fmt(dh)}" preserveAspectRatio="none"/>`,
      );
    } else {
      // No resolvable source (headless decoded bitmap) — draw a placeholder so the region isn't blank.
      this.emit(
        `<rect x="${fmt(dx)}" y="${fmt(dy)}" width="${fmt(dw)}" height="${fmt(dh)}" ` +
          `fill="none" stroke="#888888" stroke-dasharray="4,3"/>`,
      );
    }
  }

  setLineDash(segments: number[]): void {
    this.style.lineDash = segments.slice();
  }

  createLinearGradient(x0: number, y0: number, x1: number, y1: number): SVGGradient {
    return new SVGGradient(x0, y0, x1, y1);
  }

  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): SVGRadialGradient {
    return new SVGRadialGradient(x0, y0, r0, x1, y1, r1);
  }

  /** Resolve a fill/stroke style to an SVG paint value; registers a `<linearGradient>`/`<radialGradient>`
   *  def for gradients, in draw order (each gradient kind has its own id sequence). */
  private paintValue(style: SVGPaint): string {
    if (typeof style === 'string') return escapeAttr(style);
    const stops = style.stops
      .map((s) => `<stop offset="${fmt(s.offset)}" stop-color="${escapeAttr(s.color)}"/>`)
      .join('');
    if (style instanceof SVGRadialGradient) {
      const id = `nd-rgrad-${this.radGradSeq++}`;
      this.defs.push(
        `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
          `cx="${fmt(style.x1)}" cy="${fmt(style.y1)}" r="${fmt(style.r1)}" ` +
          `fx="${fmt(style.x0)}" fy="${fmt(style.y0)}">${stops}</radialGradient>`,
      );
      return `url(#${id})`;
    }
    const id = `nd-grad-${this.gradSeq++}`;
    this.defs.push(
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
        `x1="${fmt(style.x0)}" y1="${fmt(style.y0)}" x2="${fmt(style.x1)}" y2="${fmt(style.y1)}">${stops}</linearGradient>`,
    );
    return `url(#${id})`;
  }

  // ---- style properties (backed by the current style state) ----

  get fillStyle(): SVGPaint {
    return this.style.fillStyle;
  }
  set fillStyle(v: SVGPaint) {
    this.style.fillStyle = v;
  }
  get strokeStyle(): SVGPaint {
    return this.style.strokeStyle;
  }
  set strokeStyle(v: SVGPaint) {
    this.style.strokeStyle = v;
  }
  get lineWidth(): number {
    return this.style.lineWidth;
  }
  set lineWidth(v: number) {
    this.style.lineWidth = v;
  }
  get lineCap(): string {
    return this.style.lineCap;
  }
  set lineCap(v: string) {
    this.style.lineCap = v;
  }
  get lineJoin(): string {
    return this.style.lineJoin;
  }
  set lineJoin(v: string) {
    this.style.lineJoin = v;
  }
  get lineDashOffset(): number {
    return this.style.lineDashOffset;
  }
  set lineDashOffset(v: number) {
    this.style.lineDashOffset = v;
  }
  get font(): string {
    return this.style.font;
  }
  set font(v: string) {
    this.style.font = v;
  }
  get textAlign(): string {
    return this.style.textAlign;
  }
  set textAlign(v: string) {
    this.style.textAlign = v;
  }
  get textBaseline(): string {
    return this.style.textBaseline;
  }
  set textBaseline(v: string) {
    this.style.textBaseline = v;
  }
  get globalAlpha(): number {
    return this.style.globalAlpha;
  }
  set globalAlpha(v: number) {
    this.style.globalAlpha = v;
  }
  get shadowBlur(): number {
    return this.style.shadowBlur;
  }
  set shadowBlur(v: number) {
    this.style.shadowBlur = v;
  }
  get shadowColor(): string {
    return this.style.shadowColor;
  }
  set shadowColor(v: string) {
    this.style.shadowColor = v;
  }
  get shadowOffsetX(): number {
    return this.style.shadowOffsetX;
  }
  set shadowOffsetX(v: number) {
    this.style.shadowOffsetX = v;
  }
  get shadowOffsetY(): number {
    return this.style.shadowOffsetY;
  }
  set shadowOffsetY(v: number) {
    this.style.shadowOffsetY = v;
  }
}
