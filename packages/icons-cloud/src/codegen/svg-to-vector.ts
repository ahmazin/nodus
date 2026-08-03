/**
 * Build-time converter: official vendor SVG -> compact VectorIcon (path-command data).
 * Bakes group transforms, absolutizes paths, converts arcs and quadratics to cubics, extracts
 * per-shape fills, and flattens gradient paints to a representative solid. Dev-only (uses svgson/svgpath).
 */
import { parseSync } from 'svgson';
import svgpath from 'svgpath';
import { OP, type VectorIcon, type VectorSubpath } from '@nodus-dev/core';

interface SvgNode {
  name: string;
  type: string;
  value: string;
  attributes: Record<string, string>;
  children: SvgNode[];
}

export function svgToVectorIcon(svg: string): { icon: VectorIcon; warnings: string[] } {
  const warnings: string[] = [];
  const root = parseSync(svg) as unknown as SvgNode;
  const vb = readViewBox(root, warnings);
  const gradients = collectGradients(root);
  const styles = collectStyles(root);
  const sub: VectorSubpath[] = [];
  const rootFillRule = root.attributes?.['fill-rule'] ?? styleProp(root.attributes?.style, 'fill-rule');
  walk(root, '', root.attributes?.fill, rootFillRule, styles, gradients, sub, warnings);
  return { icon: { vb, sub }, warnings };
}

function readViewBox(root: SvgNode, warnings: string[]): [number, number] {
  const vb = root.attributes?.viewBox;
  if (vb) {
    const p = vb.trim().split(/[\s,]+/).map(Number);
    return [p[2] || 24, p[3] || 24];
  }
  const w = Number(root.attributes?.width) || 0;
  const h = Number(root.attributes?.height) || 0;
  if (w && h) return [w, h];
  warnings.push('no viewBox; defaulting to 24x24');
  return [24, 24];
}

function styleProp(style: string | undefined, prop: string): string | undefined {
  if (!style) return undefined;
  const m = style.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1]!.trim() : undefined;
}

function collectGradients(root: SvgNode): Map<string, string> {
  // Pass 1: index every gradient by id, keeping its own stops and any href it inherits from.
  const nodes = new Map<string, { stops: SvgNode[]; href?: string }>();
  const visit = (n: SvgNode): void => {
    if ((n.name === 'linearGradient' || n.name === 'radialGradient') && n.attributes?.id) {
      const stops = (n.children ?? []).filter((c) => c.name === 'stop');
      const href = n.attributes.href ?? n.attributes['xlink:href'];
      nodes.set(n.attributes.id, { stops, href: href?.replace(/^#/, '') });
    }
    (n.children ?? []).forEach(visit);
  };
  visit(root);

  // Pass 2: flatten to a representative solid, following href inheritance for stop-less gradients.
  const stopsFor = (id: string, seen: Set<string>): SvgNode[] => {
    const g = nodes.get(id);
    if (!g || seen.has(id)) return [];
    seen.add(id);
    if (g.stops.length) return g.stops;
    return g.href ? stopsFor(g.href, seen) : [];
  };
  const map = new Map<string, string>();
  for (const id of nodes.keys()) {
    const stops = stopsFor(id, new Set());
    const mid = stops[Math.floor(stops.length / 2)] ?? stops[0];
    const col = mid ? mid.attributes['stop-color'] ?? styleProp(mid.attributes.style, 'stop-color') : undefined;
    if (col) map.set(id, col);
  }
  return map;
}

/**
 * Parse `<style>` blocks into a class -> declarations map. Vendor toolkits (notably GCP) paint
 * shapes by CSS class (`.st1 { fill: #4285f4 }` + `class="st1"`) instead of inline fills. Only
 * simple `.class` selectors are honored — icon toolkits don't use descendant/element selectors.
 */
function collectStyles(root: SvgNode): Map<string, Record<string, string>> {
  let css = '';
  const visit = (n: SvgNode): void => {
    if (n.name === 'style') {
      for (const c of n.children ?? []) if (c.type === 'text' && c.value) css += `${c.value}\n`;
    }
    (n.children ?? []).forEach(visit);
  };
  visit(root);
  css = css.replace(/\/\*[\s\S]*?\*\//g, ''); // strip comments
  const map = new Map<string, Record<string, string>>();
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(css))) {
    const decls: Record<string, string> = {};
    for (const decl of m[2]!.split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const prop = decl.slice(0, i).trim();
      if (prop) decls[prop] = decl.slice(i + 1).trim();
    }
    for (const sel of m[1]!.split(',')) {
      const s = sel.trim();
      if (s.startsWith('.')) {
        const cls = s.slice(1);
        map.set(cls, { ...map.get(cls), ...decls });
      }
    }
  }
  return map;
}

/** Look a CSS property up via an element's `class` attribute (first matching class wins). */
function classProp(
  cls: string | undefined,
  styles: Map<string, Record<string, string>>,
  prop: string,
): string | undefined {
  if (!cls) return undefined;
  for (const c of cls.trim().split(/\s+/)) {
    const v = styles.get(c)?.[prop];
    if (v !== undefined) return v;
  }
  return undefined;
}

function resolveFill(
  a: Record<string, string>,
  inherit: string | undefined,
  styles: Map<string, Record<string, string>>,
  gradients: Map<string, string>,
  warnings: string[],
): string | undefined {
  // CSS cascade: inline `style` > `<style>` class rule > presentation `fill` attribute > inherited.
  const f = styleProp(a.style, 'fill') ?? classProp(a.class, styles, 'fill') ?? a.fill ?? inherit;
  if (!f) return inherit;
  if (f.startsWith('url(')) {
    const id = f.slice(4, -1).replace(/["']/g, '').replace('#', '');
    const flat = gradients.get(id);
    if (flat) return flat;
    warnings.push(`unresolved paint ${f}`);
    return '#888888';
  }
  return f;
}

function shapeToPath(n: SvgNode): string | null {
  const a = n.attributes ?? {};
  const num = (k: string): number => Number(a[k]) || 0;
  switch (n.name) {
    case 'path':
      return a.d ?? null;
    case 'rect': {
      const x = num('x'), y = num('y'), w = num('width'), h = num('height');
      if (!w || !h) return null;
      const rx = a.rx !== undefined ? Number(a.rx) : a.ry !== undefined ? Number(a.ry) : 0;
      const ry = a.ry !== undefined ? Number(a.ry) : rx;
      if (rx || ry)
        return `M${x + rx},${y}H${x + w - rx}A${rx},${ry} 0 0 1 ${x + w},${y + ry}V${y + h - ry}A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}H${x + rx}A${rx},${ry} 0 0 1 ${x},${y + h - ry}V${y + ry}A${rx},${ry} 0 0 1 ${x + rx},${y}Z`;
      return `M${x},${y}H${x + w}V${y + h}H${x}Z`;
    }
    case 'circle': {
      const cx = num('cx'), cy = num('cy'), r = num('r');
      if (!r) return null;
      return `M${cx - r},${cy}a${r},${r} 0 1 0 ${2 * r},0a${r},${r} 0 1 0 ${-2 * r},0Z`;
    }
    case 'ellipse': {
      const cx = num('cx'), cy = num('cy'), rx = num('rx'), ry = num('ry');
      if (!rx || !ry) return null;
      return `M${cx - rx},${cy}a${rx},${ry} 0 1 0 ${2 * rx},0a${rx},${ry} 0 1 0 ${-2 * rx},0Z`;
    }
    case 'polygon':
    case 'polyline': {
      const raw = (a.points ?? '').trim();
      if (!raw) return null;
      const p = raw.split(/[\s,]+/).map(Number);
      let d = `M${p[0]},${p[1]}`;
      for (let i = 2; i < p.length; i += 2) d += `L${p[i]},${p[i + 1]}`;
      return n.name === 'polygon' ? d + 'Z' : d;
    }
    case 'line':
      return `M${num('x1')},${num('y1')}L${num('x2')},${num('y2')}`;
    default:
      return null;
  }
}

function segmentsToCmds(sp: ReturnType<typeof svgpath>): number[] {
  const cmds: number[] = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  sp.iterate((seg) => {
    const cmd = seg[0] as string;
    const n = seg.slice(1) as number[];
    switch (cmd) {
      case 'M': cx = n[0]!; cy = n[1]!; sx = cx; sy = cy; cmds.push(OP.M, cx, cy); break;
      case 'L': cx = n[0]!; cy = n[1]!; cmds.push(OP.L, cx, cy); break;
      case 'H': cx = n[0]!; cmds.push(OP.L, cx, cy); break;
      case 'V': cy = n[0]!; cmds.push(OP.L, cx, cy); break;
      case 'C': cmds.push(OP.C, n[0]!, n[1]!, n[2]!, n[3]!, n[4]!, n[5]!); cx = n[4]!; cy = n[5]!; break;
      case 'Q': {
        const c1x = cx + (2 / 3) * (n[0]! - cx), c1y = cy + (2 / 3) * (n[1]! - cy);
        const c2x = n[2]! + (2 / 3) * (n[0]! - n[2]!), c2y = n[3]! + (2 / 3) * (n[1]! - n[3]!);
        cmds.push(OP.C, c1x, c1y, c2x, c2y, n[2]!, n[3]!); cx = n[2]!; cy = n[3]!; break;
      }
      case 'Z': case 'z': cmds.push(OP.Z); cx = sx; cy = sy; break;
    }
  });
  return cmds;
}

function walk(
  n: SvgNode,
  transform: string,
  inheritFill: string | undefined,
  inheritFillRule: string | undefined,
  styles: Map<string, Record<string, string>>,
  gradients: Map<string, string>,
  out: VectorSubpath[],
  warnings: string[],
): void {
  const a = n.attributes ?? {};
  const t = a.transform ? `${transform} ${a.transform}`.trim() : transform;
  const fill = resolveFill(a, inheritFill, styles, gradients, warnings);
  const fillRule =
    a['fill-rule'] ?? styleProp(a.style, 'fill-rule') ?? classProp(a.class, styles, 'fill-rule') ?? inheritFillRule;
  if (n.name === 'svg' || n.name === 'g') {
    for (const c of n.children ?? []) walk(c, t, fill, fillRule, styles, gradients, out, warnings);
    return;
  }
  if (n.name === 'defs' || n.name === 'linearGradient' || n.name === 'radialGradient' || n.name === 'style') return;
  const display = styleProp(a.style, 'display') ?? classProp(a.class, styles, 'display') ?? a.display;
  if (display === 'none') return;
  const d = shapeToPath(n);
  if (fill === 'none') {
    const hasStroke = (a.stroke && a.stroke !== 'none') || styleProp(a.style, 'stroke');
    if (d && hasStroke) warnings.push(`stroke-only <${n.name}> dropped (no stroke rendering)`);
    return;
  }
  if (!d) {
    if (['mask', 'filter', 'image', 'use', 'text'].includes(n.name)) warnings.push(`unsupported <${n.name}>`);
    return;
  }
  let sp = svgpath(d);
  if (t) sp = sp.transform(t);
  sp = sp.abs().unarc().unshort();
  const cmds = segmentsToCmds(sp);
  if (cmds.length) {
    const subpath: VectorSubpath = { fill: fill ?? '#000000', cmds };
    if (fillRule === 'evenodd') subpath.fillRule = 'evenodd';
    out.push(subpath);
  }
}
