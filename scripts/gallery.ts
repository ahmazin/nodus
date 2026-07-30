/**
 * Capability gallery — renders diagrams across five domains to show the engine is general, not
 * infra-specific. Each defines its node/edge *types* through the public registry and its own theme,
 * proving Axis 1 (types) + Axis 2 (theming) + Axis 3 (layout). Outputs to examples/output/gallery/.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import {
  Editor,
  Ellipse2d,
  Polygon2d,
  Rectangle2d,
  iconNames,
  measureStencil,
  type Ctx2D,
  type DrawApi,
  type EdgeRecord,
  type EdgeRouteContext,
  type EdgeUtil,
  type Geometry2d,
  type NodeRecord,
  type NodeUtil,
  type ResolvedTokens,
  type Theme,
  type Vec2,
} from '@ahmazin/core';
import { InfraCanvas, darkInfraTheme } from '@ahmazin/preset-infra';
import { dagreLayout } from '@ahmazin/layout-dagre';
import { iconNode } from '@ahmazin/preset-diagrams';
import { installCloudIcons } from '@ahmazin/icons-cloud';

(GlobalFonts as { loadSystemFonts?: () => number }).loadSystemFonts?.();
const MONO = 'Noto Sans Mono, monospace';
const OUT = join(process.cwd(), 'examples', 'output', 'gallery');
mkdirSync(OUT, { recursive: true });

function render(editor: Editor, file: string, w: number, h: number): void {
  editor.setViewport(w, h);
  editor.zoomToFit(56);
  const dpr = 2;
  const canvas = createCanvas(w * dpr, h * dpr);
  editor.render(canvas.getContext('2d') as unknown as Ctx2D, w, h, dpr, false);
  writeFileSync(join(OUT, file), canvas.toBuffer('image/png'));
  console.log(`  wrote gallery/${file}`);
}

// ---------------------------------------------------------------------------
// themes
// ---------------------------------------------------------------------------
function theme(over: Partial<Theme> & { byType?: Theme['byType'] }): Theme {
  return {
    name: 'g',
    palette: { accent: '#6366f1' },
    typography: { fontFamily: MONO, size: 11, lineHeight: 1.3 },
    radii: { node: 8 },
    canvas: { fill: '#0b0f1a', grid: { color: 'rgba(255,255,255,0.035)', size: 26 } },
    states: {
      accent: { fill: '#141a2b', strokeWidth: 1.5 } as Theme['states'][string],
      solid: { fill: '#141a2b', stroke: '#3a4358', strokeWidth: 1.2, text: '#e5e7eb', glow: null },
      ghost: { fill: '#0d1120', stroke: '#22283a', strokeWidth: 1, text: '#3a4358', opacity: 0.5, glow: null },
      locked: { fill: 'rgba(0,0,0,0)', stroke: '#22283a', strokeWidth: 1, text: '#3a4358', dash: [4, 4], labelOverride: '?', glow: null },
    },
    overlays: { met: { stroke: '#10b981', glow: '#10b981' }, missed: { stroke: '#ef4444', glow: '#ef4444' } },
    focus: { strokeWidth: 2.4, glow: '#ffffff' },
    ...over,
  };
}

const lightTheme = theme({
  canvas: { fill: '#f8fafc', grid: { color: 'rgba(15,23,42,0.05)', size: 26 } },
  states: {
    accent: { fill: '#ffffff', strokeWidth: 1.6 } as Theme['states'][string],
    solid: { fill: '#ffffff', stroke: '#cbd5e1', strokeWidth: 1.3, text: '#0f172a', glow: null },
    ghost: { fill: '#f1f5f9', stroke: '#e2e8f0', strokeWidth: 1, text: '#94a3b8', opacity: 0.6, glow: null },
    locked: { fill: '#ffffff', stroke: '#cbd5e1', strokeWidth: 1, text: '#94a3b8', dash: [4, 4], labelOverride: '?', glow: null },
  },
});

// ---------------------------------------------------------------------------
// reusable custom node/edge types (registered via the public API)
// ---------------------------------------------------------------------------
const rectPorts = () => [
  { id: 'in', kind: 'target' as const, anchor: { x: 0.5, y: 0 } },
  { id: 'out', kind: 'source' as const, anchor: { x: 0.5, y: 1 } },
  { id: 'l', kind: 'both' as const, anchor: { x: 0, y: 0.5 } },
  { id: 'r', kind: 'both' as const, anchor: { x: 1, y: 0.5 } },
];

const pillNode: NodeUtil = {
  type: 'pill',
  getDefaultProps: () => ({}),
  getDefaultSize: () => ({ w: 120, h: 44 }),
  getGeometry: (n) => new Rectangle2d({ x: n.x, y: n.y, w: n.w, h: n.h }),
  getPorts: rectPorts,
  draw: (api, n, t) => {
    const box = { x: n.x, y: n.y, w: n.w, h: n.h };
    api.fillRoundRect(box, n.h / 2, t.fill, { glow: t.glow ?? undefined });
    api.strokeRoundRect(box, n.h / 2, t.stroke, { width: t.strokeWidth });
    api.label(n.label ?? '', { x: n.x + n.w / 2, y: n.y + n.h / 2 }, { weight: '600' });
  },
};

const processNode: NodeUtil = {
  type: 'process',
  getDefaultProps: () => ({}),
  getDefaultSize: () => ({ w: 150, h: 56 }),
  getGeometry: (n) => new Rectangle2d({ x: n.x, y: n.y, w: n.w, h: n.h }),
  getPorts: rectPorts,
  draw: (api, n, t) => {
    const box = { x: n.x, y: n.y, w: n.w, h: n.h };
    api.fillRoundRect(box, 8, t.fill, { glow: t.glow ?? undefined });
    api.strokeRoundRect(box, 8, t.stroke, { width: t.strokeWidth });
    api.label(n.label ?? '', { x: n.x + n.w / 2, y: n.y + n.h / 2 });
  },
};

function diamondPoints(n: NodeRecord): Vec2[] {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  return [
    { x: cx, y: n.y },
    { x: n.x + n.w, y: cy },
    { x: cx, y: n.y + n.h },
    { x: n.x, y: cy },
  ];
}
const decisionNode: NodeUtil = {
  type: 'decision',
  getDefaultProps: () => ({}),
  getDefaultSize: () => ({ w: 150, h: 90 }),
  getGeometry: (n): Geometry2d => new Polygon2d(diamondPoints(n)),
  getPorts: () => [
    { id: 'in', kind: 'target', anchor: { x: 0.5, y: 0 } },
    { id: 'yes', kind: 'source', anchor: { x: 1, y: 0.5 } },
    { id: 'no', kind: 'source', anchor: { x: 0.5, y: 1 } },
  ],
  draw: (api, n, t) => {
    const pts = diamondPoints(n);
    api.fillPolygon(pts, t.fill, { glow: t.glow ?? undefined });
    api.strokePolyline([...pts, pts[0]!], t.stroke, { width: t.strokeWidth });
    api.label(n.label ?? '', { x: n.x + n.w / 2, y: n.y + n.h / 2 });
  },
};

const stateNode: NodeUtil = {
  type: 'state',
  getDefaultProps: () => ({}),
  getDefaultSize: () => ({ w: 120, h: 64 }),
  getGeometry: (n) => new Ellipse2d({ x: n.x, y: n.y, w: n.w, h: n.h }),
  getPorts: () => [
    { id: 'l', kind: 'both', anchor: { x: 0, y: 0.5 } },
    { id: 'r', kind: 'both', anchor: { x: 1, y: 0.5 } },
    { id: 't', kind: 'both', anchor: { x: 0.5, y: 0 } },
    { id: 'b', kind: 'both', anchor: { x: 0.5, y: 1 } },
  ],
  draw: (api, n, t) => {
    const box = { x: n.x, y: n.y, w: n.w, h: n.h };
    api.fillEllipse(box, t.fill, { glow: t.glow ?? undefined });
    api.strokeEllipse(box, t.stroke, { width: t.strokeWidth });
    api.label(n.label ?? '', { x: n.x + n.w / 2, y: n.y + n.h / 2 }, { weight: '600' });
  },
};

const ROW_H = 22;
const tableNode: NodeUtil = {
  type: 'table',
  getDefaultProps: () => ({ columns: [] }),
  getGeometry: (n) => new Rectangle2d({ x: n.x, y: n.y, w: n.w, h: n.h }),
  getPorts: () => [
    { id: 'l', kind: 'both', anchor: { x: 0, y: 0.5 } },
    { id: 'r', kind: 'both', anchor: { x: 1, y: 0.5 } },
  ],
  draw: (api, n, t) => {
    const cols = (n.props.columns as string[]) ?? [];
    const { ctx } = api;
    const box = { x: n.x, y: n.y, w: n.w, h: n.h };
    api.fillRoundRect(box, 8, t.fill, { glow: t.glow ?? undefined });
    // header
    ctx.save();
    ctx.fillStyle = t.stroke;
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.rect(n.x, n.y, n.w, 26);
    ctx.fill();
    ctx.restore();
    api.strokeRoundRect(box, 8, t.stroke, { width: t.strokeWidth });
    api.label(n.label ?? '', { x: n.x + n.w / 2, y: n.y + 13 }, { weight: '700', color: t.stroke });
    // rows
    ctx.save();
    ctx.font = `${t.fontSize}px ${t.fontFamily}`;
    ctx.fillStyle = t.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    cols.forEach((c, i) => {
      const y = n.y + 26 + i * ROW_H + ROW_H / 2;
      ctx.fillText(c, n.x + 12, y);
    });
    ctx.restore();
  },
};

const cardNode: NodeUtil = {
  type: 'card',
  getDefaultProps: () => ({}),
  getDefaultSize: () => ({ w: 150, h: 48 }),
  getGeometry: (n) => new Rectangle2d({ x: n.x, y: n.y, w: n.w, h: n.h }),
  getPorts: rectPorts,
  draw: (api, n, t) => {
    const box = { x: n.x, y: n.y, w: n.w, h: n.h };
    api.fillRoundRect(box, 8, t.fill, { glow: t.glow ?? undefined });
    // accent left bar
    api.ctx.save();
    api.ctx.fillStyle = t.stroke;
    api.ctx.beginPath();
    api.ctx.rect(n.x, n.y + 6, 4, n.h - 12);
    api.ctx.fill();
    api.ctx.restore();
    api.strokeRoundRect(box, 8, t.stroke, { width: t.strokeWidth });
    api.label(n.label ?? '', { x: n.x + n.w / 2 + 3, y: n.y + n.h / 2 });
  },
};

// orthogonal connector with an optional mid-route label
function orthogonalEdge(withArrow = true): EdgeUtil {
  return {
    type: 'flow',
    hitWidth: 8,
    getRoute(_e: EdgeRecord, c: EdgeRouteContext): Vec2[] {
      const midY = c.from.y + (c.to.y - c.from.y) / 2;
      if (Math.abs(c.from.x - c.to.x) < 1) return [c.from, c.to];
      return [c.from, { x: c.from.x, y: midY }, { x: c.to.x, y: midY }, c.to];
    },
    draw(api: DrawApi, e: EdgeRecord, t: ResolvedTokens, route: Vec2[]) {
      api.strokePolyline(route, t.stroke, { width: Math.max(1.3, t.strokeWidth) });
      const a = route[route.length - 2]!;
      const b = route[route.length - 1]!;
      if (withArrow) api.arrowhead(b, Math.atan2(b.y - a.y, b.x - a.x), 8, t.stroke);
      if (e.label) {
        const mid = route[Math.floor(route.length / 2)]!;
        api.label(e.label, { x: mid.x, y: mid.y - 8 }, { fontSize: 10, color: t.text });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// diagrams
// ---------------------------------------------------------------------------
function edge(from: string, to: string, label?: string, state = 'solid') {
  return {
    op: 'add' as const,
    record: {
      id: `edge:${from}-${to}` as EdgeRecord['id'],
      typeName: 'edge' as const,
      version: 0,
      type: 'flow',
      from: { kind: 'node' as const, nodeId: `node:${from}` as `node:${string}`, portId: 'out' },
      to: { kind: 'node' as const, nodeId: `node:${to}` as `node:${string}`, portId: 'in' },
      visual: { state },
      ...(label ? { label } : {}),
      props: {},
    },
  };
}

async function flowchart(): Promise<void> {
  const ed = new Editor({ nodeTypes: [pillNode, processNode, decisionNode], edgeTypes: [orthogonalEdge()], builtins: false });
  ed.setTheme(theme({ byType: { pill: { stroke: '#22c55e', text: '#22c55e', glow: '#22c55e' }, decision: { stroke: '#f59e0b', text: '#f59e0b', glow: '#f59e0b' }, process: { stroke: '#6366f1', text: '#6366f1', glow: '#6366f1' } } }));
  const mk = (id: string, type: string, label: string, w = 150, h = 56) => ed.createNode({ id: `node:${id}`, type, label, w, h, x: 0, y: 0, visual: { state: 'accent' } }, { capture: 'never' });
  mk('start', 'pill', 'Start', 120, 44);
  mk('recv', 'process', 'Receive request');
  mk('auth', 'decision', 'Authorized?');
  mk('handle', 'process', 'Handle');
  mk('deny', 'process', 'Return 403');
  mk('log', 'process', 'Log + respond');
  mk('end', 'pill', 'End', 120, 44);
  ed.addRecords([
    edge('start', 'recv').record,
    edge('recv', 'auth').record,
    edge('auth', 'handle', 'yes').record,
    edge('auth', 'deny', 'no').record,
    edge('handle', 'log').record,
    edge('deny', 'log').record,
    edge('log', 'end').record,
  ], { capture: 'never' });
  ed.registerLayout(dagreLayout);
  await ed.layout('dagre', { direction: 'TB', rankGap: 60 });
  render(ed, 'flowchart.png', 900, 720);
}

function erd(): void {
  const ed = new Editor({ nodeTypes: [tableNode], edgeTypes: [orthogonalEdge(false)], builtins: false });
  ed.setTheme(theme({ canvas: { fill: '#0a1020', grid: { color: 'rgba(99,102,241,0.06)', size: 26 } }, byType: { table: { stroke: '#38bdf8', text: '#e2e8f0', glow: '#38bdf8' } } }));
  const table = (id: string, title: string, cols: string[], x: number, y: number) =>
    ed.createNode({ id: `node:${id}`, type: 'table', label: title, x, y, w: 190, h: 26 + cols.length * ROW_H + 8, props: { columns: cols }, visual: { state: 'accent' } }, { capture: 'never' });
  table('users', 'users', ['🔑 id  uuid', 'email  text', 'name  text', 'created  ts'], 60, 80);
  table('orders', 'orders', ['🔑 id  uuid', 'user_id  fk', 'total  numeric', 'status  enum'], 420, 60);
  table('items', 'order_items', ['🔑 id  uuid', 'order_id  fk', 'sku  text', 'qty  int'], 420, 320);
  ed.addRecords([
    { ...edge('users', 'orders').record, from: { kind: 'node', nodeId: 'node:users' as `node:${string}`, portId: 'r' }, to: { kind: 'node', nodeId: 'node:orders' as `node:${string}`, portId: 'l' } },
    { ...edge('orders', 'items').record, from: { kind: 'node', nodeId: 'node:orders' as `node:${string}`, portId: 'l' }, to: { kind: 'node', nodeId: 'node:items' as `node:${string}`, portId: 'l' } },
  ], { capture: 'never' });
  render(ed, 'erd.png', 820, 560);
}

async function stateMachine(): Promise<void> {
  const ed = new Editor({ nodeTypes: [stateNode], edgeTypes: [orthogonalEdge()], builtins: false });
  ed.setTheme(theme({ byType: { state: { stroke: '#a78bfa', text: '#a78bfa', glow: '#a78bfa' } } }));
  const s = (id: string, label: string, state = 'accent') => ed.createNode({ id: `node:${id}`, type: 'state', label, x: 0, y: 0, visual: { state } }, { capture: 'never' });
  s('idle', 'idle', 'solid');
  s('loading', 'loading');
  s('success', 'success');
  s('error', 'error');
  ed.addRecords([
    edge('idle', 'loading', 'FETCH').record,
    edge('loading', 'success', 'OK').record,
    edge('loading', 'error', 'FAIL').record,
    edge('error', 'loading', 'RETRY').record,
    edge('success', 'idle', 'RESET').record,
  ], { capture: 'never' });
  ed.registerLayout(dagreLayout);
  await ed.layout('dagre', { direction: 'LR', rankGap: 110, nodeGap: 60 });
  render(ed, 'state-machine.png', 1000, 480);
}

async function orgChart(): Promise<void> {
  const ed = new Editor({ nodeTypes: [cardNode], edgeTypes: [orthogonalEdge(false)], builtins: false });
  ed.setTheme(theme({ byType: { card: { stroke: '#f472b6', text: '#f8fafc', glow: null } } }));
  const c = (id: string, label: string) => ed.createNode({ id: `node:${id}`, type: 'card', label, x: 0, y: 0, visual: { state: 'accent' } }, { capture: 'never' });
  ['ceo', 'cto', 'cfo', 'eng1', 'eng2', 'eng3', 'fin1', 'fin2'].forEach((id) => c(id, id.toUpperCase()));
  ed.addRecords([
    edge('ceo', 'cto').record, edge('ceo', 'cfo').record,
    edge('cto', 'eng1').record, edge('cto', 'eng2').record, edge('cto', 'eng3').record,
    edge('cfo', 'fin1').record, edge('cfo', 'fin2').record,
  ], { capture: 'never' });
  ed.registerLayout(dagreLayout);
  await ed.layout('dagre', { direction: 'TB', rankGap: 56, nodeGap: 28 });
  render(ed, 'org-chart.png', 980, 560);
}

// Cloud-provider icon grid: proves @ahmazin/icons-cloud packs resolve through iconNode (props.icon)
// once installCloudIcons() has registered them. Only fixture packs exist today (one glyph per
// provider); the grid derives its list from the registry itself so it grows with the real packs.
function cloudIcons(): void {
  installCloudIcons();
  const names = iconNames().filter((n) => n.includes(':')).sort();
  const cols = Math.max(1, Math.ceil(Math.sqrt(names.length)));
  const cellW = 160;
  const cellH = 120;
  const ed = new Editor({ nodeTypes: [iconNode], builtins: false });
  ed.setTheme(theme({ byType: { icon: { stroke: '#2dd4bf', text: '#e5e7eb', glow: '#2dd4bf' } } }));
  names.forEach((name, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const size = measureStencil(name);
    ed.createNode(
      {
        id: `node:${name.replace(':', '-')}` as NodeRecord['id'],
        type: 'icon',
        label: name,
        x: col * cellW,
        y: row * cellH,
        w: size.w,
        h: size.h,
        props: { icon: name },
        visual: { state: 'accent' },
      },
      { capture: 'never' },
    );
  });
  const rows = Math.ceil(names.length / cols);
  render(ed, 'cloud-icons.png', cols * cellW + 60, rows * cellH + 60);
}

async function main(): Promise<void> {
  console.log('rendering capability gallery ...');
  // infra (preset) for completeness in the gallery folder
  const infra = InfraCanvas({
    model: {
      nodes: [
        { key: 'cdn', type: 'edge', label: 'CDN', x: 40, y: 250 },
        { key: 'lb', type: 'lb', label: 'LB', x: 220, y: 250 },
        { key: 'api', type: 'service', label: 'API', x: 400, y: 160 },
        { key: 'auth', type: 'service', label: 'Auth', x: 400, y: 340 },
        { key: 'redis', type: 'cache', label: 'Redis', x: 620, y: 160, overlay: 'met' },
        { key: 'pg', type: 'db', label: 'Postgres', x: 620, y: 340, overlay: 'partial' },
      ],
      edges: [
        { from: 'cdn', to: 'lb' }, { from: 'lb', to: 'api' }, { from: 'lb', to: 'auth' },
        { from: 'api', to: 'redis' }, { from: 'auth', to: 'pg' },
      ],
    },
  });
  infra.editor.setTheme({ ...darkInfraTheme, typography: { ...darkInfraTheme.typography, fontFamily: MONO } });
  render(infra.editor, 'infra.png', 900, 560);

  await flowchart();
  erd();
  await stateMachine();
  await orgChart();
  cloudIcons();
  console.log('\nGallery in examples/output/gallery/');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
