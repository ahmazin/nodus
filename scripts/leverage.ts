/**
 * Renders the Phase-3 "leverage move" demos using the shipped packages:
 *  - text -> diagram (a simulated LLM tool call becomes a diagram)
 *  - live infra import (Terraform + Kubernetes)
 *  - the three arenas (Studio / Reverse / Evolution)
 * Output: examples/output/leverage/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { Editor, type Ctx2D } from '@nodus/core';
import { InfraCanvas, darkInfraTheme, installInfraPreset, modelToRecords } from '@nodus/preset-infra';
import { recordsFromToolUse } from '@nodus/text-to-diagram';
import { fromKubernetes, fromTerraform } from '@nodus/import-infra';
import { dagreLayout } from '@nodus/layout-dagre';

(GlobalFonts as { loadSystemFonts?: () => number }).loadSystemFonts?.();
const theme = { ...darkInfraTheme, typography: { ...darkInfraTheme.typography, fontFamily: 'Noto Sans Mono, monospace' } };
const OUT = join(process.cwd(), 'examples', 'output', 'leverage');
mkdirSync(OUT, { recursive: true });

function render(ed: Editor, file: string, w: number, h: number, interactive = false): void {
  ed.setTheme(theme);
  ed.setViewport(w, h);
  ed.zoomToFit(56);
  const canvas = createCanvas(w * 2, h * 2);
  ed.render(canvas.getContext('2d') as unknown as Ctx2D, w, h, 2, interactive);
  writeFileSync(join(OUT, file), canvas.toBuffer('image/png'));
  console.log(`  wrote leverage/${file}`);
}
async function laidOut(records: Parameters<Editor['loadSnapshot']>[0]['document']['records'], dir: 'LR' | 'TB' = 'LR'): Promise<Editor> {
  const ed = new Editor();
  installInfraPreset(ed);
  ed.registerLayout(dagreLayout);
  ed.loadSnapshot({ schemaVersion: 1, document: { records } });
  await ed.layout('dagre', { direction: dir, rankGap: 84 });
  return ed;
}

async function main(): Promise<void> {
  console.log('rendering Phase-3 leverage demos ...');

  // 1) text -> diagram (a simulated Claude tool call for "a URL shortener")
  const toolUse = {
    name: 'render_diagram',
    input: {
      nodes: [
        { id: 'cdn', type: 'edge', label: 'CloudFront' },
        { id: 'api', type: 'service', label: 'Shorten API' },
        { id: 'redirect', type: 'service', label: 'Redirect Svc' },
        { id: 'cache', type: 'cache', label: 'Redis' },
        { id: 'db', type: 'db', label: 'DynamoDB' },
        { id: 'q', type: 'queue', label: 'Analytics Q' },
      ],
      edges: [
        { from: 'cdn', to: 'api', label: 'POST' },
        { from: 'cdn', to: 'redirect', label: 'GET' },
        { from: 'api', to: 'db', label: 'put' },
        { from: 'redirect', to: 'cache', label: 'lookup' },
        { from: 'redirect', to: 'db', label: 'miss' },
        { from: 'redirect', to: 'q', label: 'click' },
      ],
    },
  };
  render(await laidOut(recordsFromToolUse(toolUse)), 'text-to-diagram.png', 1080, 560);

  // 2) live infra: Terraform
  const tf = {
    values: {
      root_module: {
        resources: [
          { address: 'aws_cloudfront_distribution.cdn', type: 'aws_cloudfront_distribution', name: 'cdn' },
          { address: 'aws_lb.app', type: 'aws_lb', name: 'app', depends_on: ['aws_cloudfront_distribution.cdn'] },
          { address: 'aws_ecs_service.web', type: 'aws_ecs_service', name: 'web', depends_on: ['aws_lb.app'] },
          { address: 'aws_elasticache_cluster.sessions', type: 'aws_elasticache_cluster', name: 'sessions', depends_on: ['aws_ecs_service.web'] },
          { address: 'aws_rds_cluster.orders', type: 'aws_rds_cluster', name: 'orders', depends_on: ['aws_ecs_service.web'] },
          { address: 'aws_sqs_queue.events', type: 'aws_sqs_queue', name: 'events', depends_on: ['aws_ecs_service.web'] },
        ],
      },
    },
  };
  render(await laidOut(fromTerraform(tf)), 'terraform.png', 1120, 560);

  // 3) live infra: Kubernetes
  const k8s = [
    { kind: 'Ingress', metadata: { name: 'web' }, spec: { rules: [{ http: { paths: [{ backend: { service: { name: 'orders-svc' } } }] } }] } },
    { kind: 'Service', metadata: { name: 'orders-svc' }, spec: { selector: { app: 'orders' } } },
    { kind: 'Deployment', metadata: { name: 'orders' }, spec: { template: { metadata: { labels: { app: 'orders' } } } } },
    { kind: 'Service', metadata: { name: 'cache-svc' }, spec: { selector: { app: 'redis' } } },
    { kind: 'Deployment', metadata: { name: 'redis' }, spec: { template: { metadata: { labels: { app: 'redis' } } } } },
    { kind: 'StatefulSet', metadata: { name: 'postgres', labels: { app: 'orders' } }, spec: {} },
  ];
  render(await laidOut(fromKubernetes(k8s)), 'kubernetes.png', 1000, 520);

  // 4) arena: Reverse (reveal) — some nodes locked until unlocked
  {
    const h = InfraCanvas({
      model: {
        nodes: [
          { key: 'lb', type: 'lb', label: 'Load Balancer', x: 40, y: 200 },
          { key: 'api', type: 'service', label: 'API', x: 260, y: 120 },
          { key: 'auth', type: 'service', label: 'Auth', x: 260, y: 280 },
          { key: 'db', type: 'db', label: 'Postgres', x: 480, y: 120 },
          { key: 'cache', type: 'cache', label: 'Redis', x: 480, y: 280 },
        ],
        edges: [{ from: 'lb', to: 'api' }, { from: 'lb', to: 'auth' }, { from: 'api', to: 'db' }, { from: 'auth', to: 'cache' }],
      },
      mode: 'reveal',
      revealed: ['lb', 'api'],
    });
    render(h.editor, 'arena-reveal.png', 820, 480);
  }

  // 5) arena: Evolution (stages) — ghost of the previous stage
  {
    const h = InfraCanvas({
      model: {
        nodes: [
          { key: 'mono', type: 'service', label: 'Monolith', x: 60, y: 160 },
          { key: 'db', type: 'db', label: 'Postgres', x: 320, y: 160 },
        ],
        edges: [{ from: 'mono', to: 'db' }],
      },
      mode: 'stages',
    });
    // advance: monolith split into two services + a cache
    h.advance!(modelToRecords({
      nodes: [
        { key: 'orders', type: 'service', label: 'Orders', x: 60, y: 90 },
        { key: 'users', type: 'service', label: 'Users', x: 60, y: 240 },
        { key: 'db', type: 'db', label: 'Postgres', x: 340, y: 90 },
        { key: 'cache', type: 'cache', label: 'Redis', x: 340, y: 240 },
      ],
      edges: [{ from: 'orders', to: 'db' }, { from: 'users', to: 'cache' }],
    }));
    render(h.editor, 'arena-stages.png', 760, 480);
  }

  console.log('\nLeverage demos in examples/output/leverage/');
}

main().catch((e) => { console.error(e); process.exit(1); });
