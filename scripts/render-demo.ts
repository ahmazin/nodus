/**
 * Headless render demo & smoke verification.
 *
 * Builds a rich infra-architecture diagram through the public API, renders it to PNG with a
 * Skia canvas (@napi-rs/canvas), exercises the dagre layout engine and the toPNG() export, and
 * runs a small interaction sanity check (create/select/move/undo). Outputs land in examples/output.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { Editor, STENCIL, measureStencil, type Ctx2D } from '@nodus-dev/core';
import { InfraCanvas, darkInfraTheme, installInfraPreset, type InfraModel } from '@nodus-dev/preset-infra';
import { dagreLayout } from '@nodus-dev/layout-dagre';

// ---------------------------------------------------------------------------
// fonts: use a monospace the headless canvas actually has
// ---------------------------------------------------------------------------
(GlobalFonts as { loadSystemFonts?: () => number }).loadSystemFonts?.();
const MONO = 'Noto Sans Mono, monospace';
const themedFont = { ...darkInfraTheme, typography: { ...darkInfraTheme.typography, fontFamily: MONO } };

const OUT = join(process.cwd(), 'examples', 'output');
mkdirSync(OUT, { recursive: true });

function labelWidth(label: string): number {
  return measureStencil(label).w;
}

// ---------------------------------------------------------------------------
// the model — a realistic architecture showcasing every visual state
// ---------------------------------------------------------------------------
const N = (
  key: string,
  type: string,
  label: string,
  x: number,
  y: number,
  extra: Partial<InfraModel['nodes'][number]> = {},
): InfraModel['nodes'][number] => ({ key, type, label, x, y, w: labelWidth(label), h: STENCIL.NODE_H, ...extra });

const model: InfraModel = {
  nodes: [
    N('cdn', 'edge', 'CDN / Edge', 40, 320),
    N('lb', 'lb', 'Load Balancer', 250, 320),
    N('gw', 'service', 'API Gateway', 470, 180),
    N('auth', 'service', 'Auth Service', 470, 320, { focused: true }),
    N('orders', 'service', 'Orders API', 470, 460),
    N('redis', 'cache', 'Redis Cache', 720, 180, { overlay: 'met' }),
    N('pg', 'db', 'Postgres', 720, 330, { overlay: 'partial' }),
    N('kafka', 'queue', 'Kafka', 720, 480, { overlay: 'missed' }),
    N('pay', 'service', 'Payments', 980, 180, { state: 'solid' }),
    N('analytics', 'db', 'Analytics DB', 980, 330, { state: 'ghost' }),
    N('legacy', 'service', 'Legacy Worker', 980, 480, { state: 'locked' }),
  ],
  edges: [
    { from: 'cdn', to: 'lb' },
    { from: 'lb', to: 'gw' },
    { from: 'lb', to: 'auth' },
    { from: 'lb', to: 'orders' },
    { from: 'gw', to: 'redis' },
    { from: 'auth', to: 'pg' },
    { from: 'orders', to: 'pg' },
    { from: 'orders', to: 'kafka' },
    { from: 'orders', to: 'pay' },
    { from: 'kafka', to: 'analytics' },
    { from: 'pay', to: 'legacy' },
  ],
};

const W = 1280;
const H = 760;
const DPR = 2;

function renderToPng(editor: Editor, file: string, interactive = false): void {
  editor.setViewport(W, H);
  editor.zoomToFit(64);
  const canvas = createCanvas(W * DPR, H * DPR);
  const ctx = canvas.getContext('2d') as unknown as Ctx2D;
  editor.render(ctx, W, H, DPR, interactive);
  writeFileSync(join(OUT, file), canvas.toBuffer('image/png'));
  console.log(`  wrote ${file}  (${W * DPR}x${H * DPR})`);
}

async function main(): Promise<void> {
  console.log('1) manual-layout showcase (all visual states) ...');
  const handle = InfraCanvas({ model, viewport: { w: W, h: H } });
  handle.editor.setTheme(themedFont);
  console.log(
    `   nodes=${handle.editor.store.nodes().length} edges=${handle.editor.store.edges().length} scene-items=${handle.editor.sceneIndex.all().length}`,
  );
  renderToPng(handle.editor, 'demo-infra.png');

  console.log('2) with selection + handles (interactive layer) ...');
  const ids = handle.editor.store.nodes().slice(3, 6).map((n) => n.id);
  handle.editor.select(ids);
  renderToPng(handle.editor, 'demo-infra-selected.png', true);

  console.log('3) dagre auto-layout ...');
  const laid = InfraCanvas({ model, viewport: { w: W, h: H } });
  laid.editor.setTheme(themedFont);
  laid.editor.registerLayout(dagreLayout);
  await laid.editor.layout('dagre', { direction: 'LR' });
  renderToPng(laid.editor, 'demo-infra-dagre.png');

  console.log('4) toPNG() tight export ...');
  const png = await handle.editor.toPNG((w, h) => createCanvas(w, h), { pixelRatio: 2, padding: 40, grid: true });
  writeFileSync(join(OUT, 'demo-infra-export.png'), png);
  console.log(`   toPNG bytes=${png.length}`);

  console.log('5) interaction smoke (create/select/move/undo) ...');
  interactionSmoke();

  console.log('6) serialization round-trip ...');
  serializationSmoke();

  console.log('\nDone. Images in examples/output/.');
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`   ✗ ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`   ✓ ${msg}`);
  }
}

function interactionSmoke(): void {
  const ed = new Editor();
  installInfraPreset(ed);
  ed.setViewport(800, 600);

  const a = ed.createNode({ type: 'infra.service', label: 'A', x: 100, y: 100 });
  const b = ed.createNode({ type: 'infra.db', label: 'B', x: 400, y: 300 });
  assert(ed.store.nodes().length === 2, 'created two nodes');
  assert(ed.sceneIndex.all().filter((i) => i.kind === 'node').length === 2, 'nodes are indexed');

  // connect A -> B
  const edgeId = ed.connect(
    { kind: 'node', nodeId: a as `node:${string}`, portId: 'out' },
    { kind: 'node', nodeId: b as `node:${string}`, portId: 'in' },
  );
  assert(!!edgeId && ed.store.edges().length === 1, 'connected an edge');
  assert(ed.sceneIndex.edgesForNode(a).length === 1, 'adjacency tracks the edge');

  // drag B by 60,40 as one gesture (many "later" captures + a mark)
  ed.select([b]);
  for (let i = 0; i < 6; i++) ed.moveBy([b], 10, 6.667, { capture: 'later' });
  ed.mark();
  const moved = ed.store.peek(b) as { x: number; y: number };
  assert(Math.round(moved.x) === 460 && Math.round(moved.y) === 340, 'node moved by drag');

  // one undo reverts the WHOLE drag
  ed.undo();
  const back = ed.store.peek(b) as { x: number; y: number };
  assert(back.x === 400 && back.y === 300, 'single undo reverts entire drag');
  ed.redo();
  const fwd = ed.store.peek(b) as { x: number; y: number };
  assert(Math.round(fwd.x) === 460, 'redo reapplies drag');

  // deleting a node cascades its edge
  ed.deleteRecords([a]);
  assert(ed.store.nodes().length === 1 && ed.store.edges().length === 0, 'delete cascades connected edge');

  // hit testing picks the node under a point (use a clearly-interior point)
  const r = ed.store.peek(b) as { x: number; y: number; w: number; h: number };
  const hit = ed.sceneIndex.hitTest({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, 4);
  assert(hit?.id === b, 'hit-test finds the node');
}

function serializationSmoke(): void {
  const handle = InfraCanvas({ model });
  const json = handle.editor.toJSON() as { document: { records: unknown[] } };
  const before = json.document.records.length;
  const ed2 = new Editor();
  installInfraPreset(ed2);
  ed2.loadSnapshot(json as never);
  assert(ed2.store.size === before, 'round-trip preserves record count');

  // a deliberately dangling edge is repaired (dropped) rather than crashing
  const broken = JSON.parse(JSON.stringify(json)) as typeof json;
  broken.document.records.push({
    id: 'edge:broken',
    typeName: 'edge',
    version: 0,
    type: 'infra.connector',
    from: { kind: 'node', nodeId: 'node:does-not-exist' },
    to: { kind: 'node', nodeId: 'node:also-missing' },
    visual: { state: 'solid' },
    props: {},
  } as never);
  const ed3 = new Editor();
  installInfraPreset(ed3);
  ed3.loadSnapshot(broken as never);
  assert(ed3.store.size === before, 'dangling edge repaired on restore (no crash)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
