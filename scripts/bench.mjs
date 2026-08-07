/**
 * Headless performance benchmark for the Nodus engine.
 *
 * Measures a STABLE, machine-comparable table for two scene sizes (N = 500 and N = 2000
 * nodes, each fully connected into a chain of N edges):
 *
 *   1. build      — create N nodes + N edges through the public Editor API (store.apply path).
 *   2. render      — full-scene `paintRegion` of the whole content bounds (cold first frame, then
 *                    the warm mean of the remaining frames). This is the export/preview path and is
 *                    intentionally cache-free, so it reflects the O(N) worst case.
 *   3. reflow      — move one connected node repeatedly and time the synchronous edge reflow per step.
 *   4. hit-test    — K random world-point queries through the scene-index R-tree (µs / query).
 *
 * It then runs a scripted interaction that asserts the static-layer-cache invariants
 * (`editor.layerCacheStats()`) with GENEROUS thresholds, so `pnpm bench` can gate a perf regression:
 *   (a) repeated frames at a fixed camera are served as cache hits;
 *   (b) a drag (move + repaint at the same camera) takes the dirty-region fast path;
 *   (c) a camera pan forces a full static repaint (documents the known pan cliff).
 *
 * Run via tsx (it imports the TypeScript engine source through the workspace `@nodus-dev/*` aliases,
 * whose package `main` points at `./src/index.ts`):
 *
 *   pnpm bench            # -> tsx scripts/bench.mjs
 *   node --import tsx scripts/bench.mjs
 *
 * Exits non-zero on any cache-invariant breach so CI can treat it as a gate.
 */

import { performance } from 'node:perf_hooks';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { Editor, deterministicIdFactory } from '@nodus-dev/core';
import { installInfraPreset } from '@nodus-dev/preset-infra';

// A monospace the headless Skia canvas actually has (mirrors render-demo.ts).
(GlobalFonts).loadSystemFonts?.();

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------
const SIZES = [500, 2000];
const RENDER_FRAMES = 8; // 1 cold + 7 warm
const HIT_QUERIES = 5000;
const REFLOW_STEPS = 200;
const RENDER_RATIO = 1; // full-scene raster is large; keep under MAX_EXPORT_PIXELS (256 MP)
const VIEW_W = 1600;
const VIEW_H = 1000;
const CACHE_DPR = 2;

const NODE_W = 120;
const NODE_H = 48;
const GAP_X = 150;
const GAP_Y = 96;

const INFRA_TYPES = ['infra.service', 'infra.db', 'infra.cache', 'infra.queue', 'infra.lb', 'infra.edge'];

/** Deterministic LCG so the random hit-test points are reproducible run-to-run. */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function offscreen(w, h) {
  const canvas = createCanvas(w, h);
  return { canvas, ctx: canvas.getContext('2d') };
}

// ---------------------------------------------------------------------------
// scene builder — grid-placed nodes + a connecting chain of edges
// ---------------------------------------------------------------------------
function buildScene(n) {
  const t0 = performance.now();
  const editor = new Editor({ idFactory: deterministicIdFactory() });
  installInfraPreset(editor);
  editor.setViewport(VIEW_W, VIEW_H);

  const cols = Math.ceil(Math.sqrt(n));
  const ids = new Array(n);
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    ids[i] = editor.createNode({
      type: INFRA_TYPES[i % INFRA_TYPES.length],
      label: `n${i}`,
      x: col * GAP_X,
      y: row * GAP_Y,
      w: NODE_W,
      h: NODE_H,
    });
  }
  // one edge per node (a chain): N-1 connecting edges.
  for (let i = 1; i < n; i++) {
    editor.connect(
      { kind: 'node', nodeId: ids[i - 1], portId: 'out' },
      { kind: 'node', nodeId: ids[i], portId: 'in' },
    );
  }
  const buildMs = performance.now() - t0;
  return { editor, ids, buildMs };
}

// ---------------------------------------------------------------------------
// full-scene render (paintRegion of the whole content bounds)
// ---------------------------------------------------------------------------
function benchRender(editor) {
  const bounds = editor.sceneIndex.contentBounds();
  if (!bounds) throw new Error('bench: empty content bounds');
  const pad = 40;
  const region = { x: bounds.x - pad, y: bounds.y - pad, w: bounds.w + pad * 2, h: bounds.h + pad * 2 };
  const dw = Math.ceil(region.w * RENDER_RATIO);
  const dh = Math.ceil(region.h * RENDER_RATIO);
  const canvas = createCanvas(dw, dh);
  const ctx = canvas.getContext('2d');

  const times = [];
  for (let f = 0; f < RENDER_FRAMES; f++) {
    const t0 = performance.now();
    editor.paintRegion(ctx, region, RENDER_RATIO, { background: true, grid: true });
    times.push(performance.now() - t0);
  }
  const cold = times[0];
  const warm = times.slice(1).reduce((a, b) => a + b, 0) / (times.length - 1);
  return { cold, warm, raster: `${dw}x${dh}` };
}

// ---------------------------------------------------------------------------
// reflow — move a connected node; measure the synchronous edge reflow per step
// ---------------------------------------------------------------------------
function benchReflow(editor, ids) {
  const mid = ids[Math.floor(ids.length / 2)]; // has both an inbound and outbound edge
  editor.select([mid]);
  const t0 = performance.now();
  for (let i = 0; i < REFLOW_STEPS; i++) {
    editor.moveBy([mid], (i % 2 === 0 ? 1 : -1) * 3, (i % 3 === 0 ? 2 : -2), { capture: 'later' });
  }
  editor.mark();
  const total = performance.now() - t0;
  return total / REFLOW_STEPS;
}

// ---------------------------------------------------------------------------
// hit-test — K random world-point queries through the R-tree
// ---------------------------------------------------------------------------
function benchHitTest(editor) {
  const bounds = editor.sceneIndex.contentBounds();
  const z = editor.camera.z || 1;
  const tol = 5 / z;
  const rng = makeRng(0xc0ffee);
  // Pre-generate points so RNG cost is out of the timed loop.
  const pts = new Array(HIT_QUERIES);
  for (let i = 0; i < HIT_QUERIES; i++) {
    pts[i] = { x: bounds.x + rng() * bounds.w, y: bounds.y + rng() * bounds.h };
  }
  let hits = 0;
  const t0 = performance.now();
  for (let i = 0; i < HIT_QUERIES; i++) {
    if (editor.sceneIndex.hitTest(pts[i], tol)) hits++;
  }
  const totalMs = performance.now() - t0;
  return { perQueryUs: (totalMs / HIT_QUERIES) * 1000, hitRate: hits / HIT_QUERIES };
}

// ---------------------------------------------------------------------------
// layer-cache invariant assertions (scripted interaction)
// ---------------------------------------------------------------------------
let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`   ok  ${msg}`);
  } else {
    console.error(`   FAIL ${msg}`);
    failures++;
  }
}

function checkLayerCache(editor) {
  editor.setOffscreenFactory(offscreen);
  editor.zoomToFit(48);

  const canvas = createCanvas(VIEW_W * CACHE_DPR, VIEW_H * CACHE_DPR);
  const ctx = canvas.getContext('2d');
  const render = (time) => editor.render(ctx, VIEW_W, VIEW_H, CACHE_DPR, true, time);

  // (a) cold render = exactly one full static repaint; then repeated IDENTICAL frames at a fixed camera
  //     add NO further full repaints (they take the empty-dirty-region incremental fast path). This is
  //     the core cache invariant — an idle scene is never O(N)-repainted per frame.
  render(0); // cold full paint
  let s = editor.layerCacheStats();
  assert(s != null, 'layerCacheStats() is available with an offscreen factory');
  assert(s.fullPaints === 1, `cold render is a single full static paint (fullPaints=${s.fullPaints})`);
  for (let f = 0; f < 10; f++) render(0);
  s = editor.layerCacheStats();
  assert(s.fullPaints === 1, `10 idle frames add no full repaints (fullPaints=${s.fullPaints})`);
  assert(s.regionPaints >= 8, `idle frames take the incremental fast path (regionPaints=${s.regionPaints})`);

  // (b) a drag (move + repaint at the SAME camera) -> dirty-region fast path, no full repaint per move.
  const dragNode = editor.store.nodes()[Math.floor(editor.store.nodes().length / 2)].id;
  editor.select([dragNode]);
  render(0); // settle any selection-presentation epoch change before measuring the drag
  const regionBeforeDrag = editor.layerCacheStats().regionPaints;
  const fullBeforeDrag = editor.layerCacheStats().fullPaints;
  for (let i = 0; i < 8; i++) {
    editor.moveBy([dragNode], 2, 1, { capture: 'later' });
    render(0);
  }
  editor.mark();
  s = editor.layerCacheStats();
  assert(
    s.regionPaints > regionBeforeDrag,
    `drag takes the region-repaint fast path (regionPaints ${regionBeforeDrag} -> ${s.regionPaints})`,
  );
  assert(
    s.fullPaints === fullBeforeDrag,
    `drag triggers no full repaint (fullPaints stayed ${s.fullPaints})`,
  );

  // (c) a camera pan forces a full static repaint (documents the known pan cliff, until a pan-blit
  //     fast path lands — see docs/performance.md).
  const fullBeforePan = editor.layerCacheStats().fullPaints;
  const cam = editor.camera;
  editor.setCamera({ x: cam.x + 250, y: cam.y + 130, z: cam.z });
  render(0);
  s = editor.layerCacheStats();
  assert(s.fullPaints > fullBeforePan, `camera pan forces a full static repaint (fullPaints ${fullBeforePan} -> ${s.fullPaints})`);

  editor.setOffscreenFactory(null);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

function main() {
  console.log('Nodus headless benchmark');
  console.log(`node ${process.version} · frames=${RENDER_FRAMES} · hitQueries=${HIT_QUERIES} · reflowSteps=${REFLOW_STEPS}\n`);

  const rows = [];
  let cacheEditor = null;
  for (const n of SIZES) {
    const { editor, ids, buildMs } = buildScene(n);
    const render = benchRender(editor);
    const reflowMs = benchReflow(editor, ids);
    const hit = benchHitTest(editor);
    rows.push({ n, buildMs, render, reflowMs, hit });
    if (n === SIZES[0]) cacheEditor = editor; // reuse the smaller scene for the cache interaction
  }

  // ---- table ----
  const H = ['N', 'build ms', 'render cold ms', 'render warm ms', 'reflow ms/move', 'hit-test µs/q', 'raster'];
  const W = [6, 10, 15, 15, 15, 14, 13];
  const line = (cells) => cells.map((c, i) => pad(c, W[i])).join(' |');
  console.log(line(H));
  console.log(W.map((w) => '-'.repeat(w)).join('-+'));
  for (const r of rows) {
    console.log(
      line([
        r.n,
        r.buildMs.toFixed(1),
        r.render.cold.toFixed(1),
        r.render.warm.toFixed(1),
        r.reflowMs.toFixed(3),
        r.hit.perQueryUs.toFixed(2),
        r.render.raster,
      ]),
    );
  }
  console.log('');

  // ---- scripted cache invariants ----
  console.log('layer-cache invariants (N=' + SIZES[0] + '):');
  checkLayerCache(cacheEditor);
  console.log('');

  if (failures > 0) {
    console.error(`bench: ${failures} cache-invariant assertion(s) FAILED`);
    process.exitCode = 1;
  } else {
    console.log('bench: all cache invariants held');
  }
}

main();
