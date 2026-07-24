/**
 * `renderSVG(editor, opts)` — vector export mirroring `editor.toPNG`, but emitting an SVG string
 * instead of rasterizing. It reuses the exact same `editor.paintRegion` pipeline, driven by an
 * `SVGContext` (a `Ctx2D` that records draw calls as markup). Region/padding/background/grid/flow
 * options match `ToPNGOptions` so callers can swap PNG for SVG with the same shape.
 *
 * Unlike PNG, SVG is resolution-independent, so `pixelRatio` defaults to 1: the output is authored in
 * world/CSS units (viewBox `0 0 w h`) rather than device pixels. Pass a higher ratio only if you want
 * the coordinate space pre-scaled.
 */

import type { Box, EdgeRecord } from '../model.js';
// Type-only import: erased at compile time, so this does not create a runtime cycle with the editor.
import type { Editor } from '../editor/index.js';
import { padBox } from '../geometry/index.js';
import { resolveFlow } from '../flow.js';
import { resolveTokens } from '../theme/index.js';
import { SVGContext } from './svg-context.js';

export interface RenderSVGOptions {
  /** Coordinate pre-scale. Default 1 — SVG is resolution-independent, so device pixels aren't needed. */
  pixelRatio?: number;
  /** World-unit padding added around the content bounds. Default 40 (matches `toPNG`). */
  padding?: number;
  /** Paint the theme's canvas fill as a background rect. Default true. */
  background?: boolean;
  /** Paint the dot grid. Default false. */
  grid?: boolean;
  /** World region to export (default: the whole content bounds). */
  bounds?: Box;
  /** Also emit a snapshot of flow markers (packets/dashes) at `time` ms. Default off. */
  flow?: boolean;
  time?: number;
  /** Emit the flow as looping, self-contained SVG animation (marching dashes / moving packets)
   *  instead of a single frozen frame, so the exported `.svg` keeps flowing when opened. Default off.
   *  Takes precedence over `flow` (a frozen snapshot). */
  animateFlow?: boolean;
  /** Accessible name for the exported SVG — becomes the root `aria-label` + `<title>`. Default 'Diagram'. */
  title?: string;
}

/**
 * Render the editor's scene to a self-contained, deterministic SVG document string. Empty scenes
 * still produce a valid `<svg>` (a 100×100 padded region), matching `toPNG`'s empty-content fallback.
 */
export function renderSVG(editor: Editor, opts: RenderSVGOptions = {}): string {
  const bounds = opts.bounds ?? editor.sceneIndex.contentBounds() ?? { x: 0, y: 0, w: 100, h: 100 };
  const pad = opts.padding ?? 40;
  const region = padBox(bounds, pad);
  const ratio = opts.pixelRatio ?? 1;
  const w = Math.max(1, Math.ceil(region.w * ratio));
  const h = Math.max(1, Math.ceil(region.h * ratio));
  const ctx = new SVGContext();
  editor.paintRegion(ctx, region, ratio, {
    background: opts.background ?? true,
    grid: opts.grid ?? false,
    // A frozen flow frame and a live animation are mutually exclusive; `animateFlow` wins.
    ...(opts.flow && !opts.animateFlow ? { flow: true, time: opts.time ?? 0 } : {}),
  });
  if (opts.animateFlow) {
    const anim = flowAnimationSVG(editor, region, ratio);
    if (anim) ctx.raw(anim);
  }
  return ctx.toSVG(w, h, opts.title);
}

/** Compact number formatter (3 decimals, `-0` normalized) for the flow-animation markup. */
function n(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

/** Upper bound on packet `<circle>` elements emitted per edge during animated export. `flow.count`
 *  is author-controlled and round-trips through the deserialized edge record with no upper bound, so
 *  without a cap a crafted diagram could drive the packet loop to emit an unbounded number of
 *  elements and exhaust memory. Kept module-local on purpose (the canvas sink has its own cap). */
const MAX_FLOW_MARKERS = 10000;

/** Escape a string for safe interpolation into an SVG attribute value — mirrors `escapeAttr` in
 *  svg-context (which escapes node labels/hrefs). Needed because `flow.color` is author-controlled and
 *  is otherwise dropped raw into `stroke=`/`fill=`, which is a stored-XSS vector once the exported
 *  `.svg` is opened in a browser. */
function attr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build looping SVG animation markup for every edge carrying a `FlowSpec`, in world coordinates,
 * wrapped in the same world→viewBox transform `paintRegion` uses (so it overlays the static edges
 * exactly). Marching dashes animate `stroke-dashoffset` over one dash period (seamless loop); packet
 * dots ride the route via `<animateMotion path=...>` with staggered `begin` offsets. Self-contained —
 * no external refs — so the exported `.svg` animates on its own in any SVG-animation-capable viewer.
 */
function flowAnimationSVG(editor: Editor, region: Box, ratio: number): string {
  const edges = editor.store.edges().filter((e) => !!e.flow) as EdgeRecord[];
  if (edges.length === 0) return '';
  const theme = editor.themeAtom.peek();
  const getMetric = (editor as { flowMetric?: (id: string) => number | undefined }).flowMetric;
  const parts: string[] = [];

  for (const edge of edges) {
    const route = editor.sceneIndex.getItem(edge.id)?.route;
    if (!route || route.length < 2) continue;
    let total = 0;
    for (let i = 1; i < route.length; i++) {
      total += Math.hypot(route[i]!.x - route[i - 1]!.x, route[i]!.y - route[i - 1]!.y);
    }
    if (total < 1) continue;

    const metric = typeof getMetric === 'function' ? getMetric.call(editor, edge.id) : undefined;
    const flow = resolveFlow(edge.flow!, metric);
    const tok = resolveTokens(theme, edge.visual, edge.type);
    // Escape here (not at each site) so both the dash `stroke=` and the packet `fill=` are covered.
    const color = attr(flow.color ?? tok.stroke);
    const speed = flow.speed && flow.speed > 0 ? flow.speed : 70;
    const dir = flow.reverse ? -1 : 1;
    const d = route.map((p, i) => `${i === 0 ? 'M' : 'L'}${n(p.x)} ${n(p.y)}`).join(' ');

    if (flow.style === 'dash') {
      const dash = (flow.size ?? 6) * 2;
      const dur = Math.max(0.1, (2 * dash) / speed);
      const lw = flow.size ?? tok.strokeWidth ?? 1.5;
      parts.push(
        `<path d="${d}" fill="none" stroke="${color}" stroke-width="${n(lw)}" ` +
          `stroke-dasharray="${n(dash)},${n(dash)}">` +
          `<animate attributeName="stroke-dashoffset" values="0;${n(-dir * 2 * dash)}" ` +
          `dur="${n(dur)}s" repeatCount="indefinite"/></path>`,
      );
    } else {
      const size = flow.size ?? 3;
      // Clamp the author-controlled packet count to a bounded maximum so the loop below can never be
      // driven to emit an unbounded number of <circle> elements (memory-exhaustion DoS on export). A
      // non-finite/NaN/Infinity count falls back to the derived default before clamping.
      const derived = Math.round(total / 90);
      const rawCount = flow.count ?? derived;
      const count = Math.min(MAX_FLOW_MARKERS, Math.max(1, Number.isFinite(rawCount) ? rawCount : derived));
      const spacing = total / count;
      const dur = Math.max(0.1, total / speed);
      const rev = dir < 0 ? ` keyPoints="1;0" keyTimes="0;1" calcMode="linear"` : '';
      for (let k = 0; k < count; k++) {
        parts.push(
          `<circle r="${n(size)}" fill="${color}"><animateMotion path="${d}" ` +
            `dur="${n(dur)}s" begin="${n(-(k * spacing) / speed)}s" repeatCount="indefinite"${rev}/></circle>`,
        );
      }
    }
  }
  if (parts.length === 0) return '';
  const t = `matrix(${n(ratio)} 0 0 ${n(ratio)} ${n(-region.x * ratio)} ${n(-region.y * ratio)})`;
  return `<g class="nodus-flow" transform="${t}">${parts.join('')}</g>`;
}
