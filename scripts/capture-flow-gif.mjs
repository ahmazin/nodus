// Capture the playground DEFAULT diagram (examples/browser/src/main.tsx) with flow ON as a looping
// animated GIF for the README. Drives the real Vite app (localhost:5188 — run `pnpm dev` first) so
// fonts/icons/theme/layout render exactly as users see them, then grabs deterministic frames via
// editor.paintRegion({flow:true, time}) — the same path @nodus/react's exportFlowGIF uses — and
// assembles a looping GIF with ImageMagick.
//
//   pnpm dev &                       # Vite on :5188
//   node scripts/capture-flow-gif.mjs [out.gif]
import { chromium } from 'playwright-core';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const URL = 'http://localhost:5188/';
const OUT_GIF = process.argv[2] || join(process.cwd(), 'examples', 'output', 'playground-flow.gif');
const TMP = join(process.env.SCRATCH || '/tmp', `flow-frames-${process.pid}`);

const N = 20;         // frames
const LOOP_MS = 2000; // one flow cycle
const SCALE = 2;      // render crisp, downscale in magick
const WIDTH = 1200;   // final GIF width

function findChromium() {
  const base = join(homedir(), '.cache', 'ms-playwright');
  for (const rev of ['chromium-1228', 'chromium-1208']) {
    const p = join(base, rev, 'chrome-linux64', 'chrome');
    if (existsSync(p)) return p;
  }
  throw new Error('No chromium found in playwright cache');
}

const browser = await chromium.launch({ executablePath: findChromium(), headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__editor && window.__editor.disposed === false, { timeout: 15000 });

  const result = await page.evaluate(async ({ N, LOOP_MS, SCALE }) => {
    const ed = window.__editor;
    // Enable flow on every edge (traveling dots), and flip the global flow switch on.
    const edgeIds = ed.store.edges().map((e) => e.id);
    ed.setFlow(edgeIds, { style: 'dots', speed: 55, count: 4, size: 3 });
    if (typeof ed.setFlowEnabled === 'function') ed.setFlowEnabled(true);
    if (typeof ed.resumeFlow === 'function') ed.resumeFlow();

    const b = ed.sceneIndex.contentBounds();
    if (!b) throw new Error('no content bounds — diagram empty?');
    const pad = 30;
    const region = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    const ratio = SCALE;
    const w = Math.ceil(region.w * ratio);
    const h = Math.ceil(region.h * ratio);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const frames = [];
    for (let i = 0; i < N; i++) {
      const time = (i / N) * LOOP_MS;
      ctx.clearRect(0, 0, w, h);
      ed.paintRegion(ctx, region, ratio, { background: true, flow: true, time });
      frames.push(canvas.toDataURL('image/png'));
    }
    return { frames, w, h, edges: edgeIds.length };
  }, { N, LOOP_MS, SCALE });

  console.log(`captured ${result.frames.length} frames @ ${result.w}x${result.h}, flow on ${result.edges} edges`);

  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  const frameFiles = result.frames.map((durl, i) => {
    const p = join(TMP, `frame-${String(i).padStart(3, '0')}.png`);
    writeFileSync(p, Buffer.from(durl.split(',')[1], 'base64'));
    return p;
  });

  const delay = Math.round((LOOP_MS / N) / 10); // centiseconds per frame
  mkdirSync(join(OUT_GIF, '..'), { recursive: true });
  // execFileSync does NOT use a shell, so pass explicit filenames (no glob expansion).
  execFileSync('magick', [
    '-delay', String(delay), '-loop', '0',
    ...frameFiles,
    '-resize', `${WIDTH}x`, '-layers', 'Optimize',
    OUT_GIF,
  ], { stdio: 'inherit' });
  console.log(`wrote ${OUT_GIF}`);
  rmSync(TMP, { recursive: true, force: true });
} finally {
  await browser.close();
}
