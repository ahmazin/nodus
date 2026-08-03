/**
 * Renders the Phase-2 demo set using the shipped preset/plugin packages (not inline code) —
 * proving they work end-to-end. Output: examples/output/demos/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { Editor, type Ctx2D, type Theme } from '@nodus-dev/core';
import {
  buildERD,
  buildFlowchart,
  buildOrgChart,
  buildStateMachine,
  diagramsTheme,
  installDiagrams,
} from '@nodus-dev/preset-diagrams';
import { installFreehand } from '@nodus-dev/plugin-freehand';
import { dagreLayout } from '@nodus-dev/layout-dagre';
import { treeLayout } from '@nodus-dev/layout-tree';

(GlobalFonts as { loadSystemFonts?: () => number }).loadSystemFonts?.();
const MONO = 'Noto Sans Mono, monospace';
const themed = (t: Theme): Theme => ({ ...t, typography: { ...t.typography, fontFamily: MONO } });
const OUT = join(process.cwd(), 'examples', 'output', 'demos');
mkdirSync(OUT, { recursive: true });

function render(editor: Editor, file: string, w: number, h: number): void {
  editor.setViewport(w, h);
  editor.zoomToFit(56);
  const canvas = createCanvas(w * 2, h * 2);
  editor.render(canvas.getContext('2d') as unknown as Ctx2D, w, h, 2, false);
  writeFileSync(join(OUT, file), canvas.toBuffer('image/png'));
  console.log(`  wrote demos/${file}`);
}

async function main(): Promise<void> {
  console.log('rendering Phase-2 demos ...');

  // 1) flowchart
  {
    const ed = new Editor();
    installDiagrams(ed, { theme: themed(diagramsTheme) });
    ed.registerLayout(dagreLayout);
    ed.loadSnapshot({ schemaVersion: 1, document: { records: buildFlowchart({
      steps: [
        { id: 'start', kind: 'start', label: 'Request' },
        { id: 'auth', kind: 'decision', label: 'Authed?' },
        { id: 'handle', kind: 'process', label: 'Handle' },
        { id: 'deny', kind: 'process', label: '403' },
        { id: 'log', kind: 'process', label: 'Log' },
        { id: 'end', kind: 'end', label: 'Respond' },
      ],
      links: [
        { from: 'start', to: 'auth' }, { from: 'auth', to: 'handle', label: 'yes' },
        { from: 'auth', to: 'deny', label: 'no' }, { from: 'handle', to: 'log' },
        { from: 'deny', to: 'log' }, { from: 'log', to: 'end' },
      ],
    }) } });
    await ed.layout('dagre', { direction: 'TB', rankGap: 56 });
    render(ed, 'flowchart.png', 860, 720);
  }

  // 2) state machine
  {
    const ed = new Editor();
    installDiagrams(ed, { theme: themed(diagramsTheme) });
    ed.registerLayout(dagreLayout);
    ed.loadSnapshot({ schemaVersion: 1, document: { records: buildStateMachine({
      states: [{ id: 'idle', label: 'idle', initial: true }, { id: 'load', label: 'loading' }, { id: 'ok', label: 'success' }, { id: 'err', label: 'error' }],
      transitions: [{ from: 'idle', to: 'load', label: 'FETCH' }, { from: 'load', to: 'ok', label: 'OK' }, { from: 'load', to: 'err', label: 'FAIL' }, { from: 'err', to: 'load', label: 'RETRY' }, { from: 'ok', to: 'idle', label: 'RESET' }],
    }) } });
    await ed.layout('dagre', { direction: 'LR', rankGap: 110, nodeGap: 54 });
    render(ed, 'state-machine.png', 1040, 460);
  }

  // 3) ERD (tables carry their own positions)
  {
    const ed = new Editor();
    installDiagrams(ed, { theme: themed(diagramsTheme) });
    ed.loadSnapshot({ schemaVersion: 1, document: { records: buildERD({
      tables: [
        { id: 'users', name: 'users', columns: ['id  uuid', 'email  text', 'name  text'] },
        { id: 'orders', name: 'orders', columns: ['id  uuid', 'user_id  fk', 'total  num'] },
        { id: 'items', name: 'order_items', columns: ['id  uuid', 'order_id  fk', 'sku  text'] },
      ],
      relations: [{ from: 'users', to: 'orders' }, { from: 'orders', to: 'items' }],
    }) } });
    render(ed, 'erd.png', 900, 420);
  }

  // 4) org chart (tree layout)
  {
    const ed = new Editor();
    installDiagrams(ed, { theme: themed(diagramsTheme) });
    ed.registerLayout(treeLayout);
    ed.loadSnapshot({ schemaVersion: 1, document: { records: buildOrgChart({
      people: [
        { id: 'ceo', label: 'CEO' }, { id: 'cto', label: 'CTO', reportsTo: 'ceo' }, { id: 'cfo', label: 'CFO', reportsTo: 'ceo' },
        { id: 'e1', label: 'Eng Lead', reportsTo: 'cto' }, { id: 'e2', label: 'Platform', reportsTo: 'cto' },
        { id: 'f1', label: 'Finance', reportsTo: 'cfo' },
      ],
    }) } });
    await ed.layout('tree', { direction: 'TB', rankGap: 74, nodeGap: 26 });
    render(ed, 'org-chart.png', 900, 460);
  }

  // 5) cloud architecture (icon nodes)
  {
    const ed = new Editor();
    installDiagrams(ed, { theme: themed(diagramsTheme) });
    ed.registerLayout(dagreLayout);
    const mk = (icon: string, label: string) => ed.createNode({ type: 'icon', label, props: { icon }, x: 0, y: 0 }, { capture: 'never' });
    const cf = mk('globe', 'CloudFront');
    const api = mk('code', 'API Gateway');
    const fn = mk('function', 'Lambda');
    const s3 = mk('bucket', 'S3');
    const db = mk('database', 'DynamoDB');
    const q = mk('queue', 'SQS');
    for (const [a, b] of [[cf, api], [api, fn], [fn, s3], [fn, db], [fn, q]] as const) {
      ed.connect({ kind: 'node', nodeId: a, portId: 'out' }, { kind: 'node', nodeId: b, portId: 'in' }, 'flow', { capture: 'never' });
    }
    await ed.layout('dagre', { direction: 'LR', rankGap: 90 });
    render(ed, 'cloud.png', 1080, 520);
  }

  // 6) freehand sketch (drive the pen tool)
  {
    const ed = new Editor({ viewport: { w: 900, h: 560 } });
    installDiagrams(ed, { theme: themed(diagramsTheme) });
    installFreehand(ed);
    ed.setTool('freehand');
    // draw a sine-ish wave + a loop
    const stroke = (pts: Array<[number, number]>) => {
      ed.pointerDown({ x: pts[0]![0], y: pts[0]![1] });
      for (let i = 1; i < pts.length; i++) ed.pointerMove({ x: pts[i]![0], y: pts[i]![1] });
      ed.pointerUp({ x: pts[pts.length - 1]![0], y: pts[pts.length - 1]![1] });
    };
    const wave: Array<[number, number]> = [];
    for (let i = 0; i <= 60; i++) wave.push([100 + i * 8, 200 + Math.sin(i / 4) * 40]);
    stroke(wave);
    const loop: Array<[number, number]> = [];
    for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 2; loop.push([650 + Math.cos(a) * 70, 260 + Math.sin(a) * 70]); }
    stroke(loop);
    // annotate with an icon node
    ed.createNode({ type: 'icon', label: 'sketch', props: { icon: 'user' }, x: 300, y: 360 }, { capture: 'never' });
    render(ed, 'freehand.png', 900, 560);
  }

  console.log('\nDemos in examples/output/demos/');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
