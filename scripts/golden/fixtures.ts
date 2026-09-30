/**
 * Golden-image fixtures — FIXED-COORDINATE diagrams (no auto-layout).
 *
 * The dagre/tree/force/elk layout engines are non-deterministic in this sandbox
 * (see CLAUDE.md "local render gotcha"), so every fixture here hardcodes node
 * x/y/w/h AND a fixed camera. That makes the headless Skia render byte-stable
 * across runs on the same toolchain, which is what lets the baseline PNGs be
 * committed and diffed in CI.
 *
 * To add a fixture: append an entry below. Node `w`/`h` are hardcoded (not
 * measured) so geometry never depends on font-metric drift.
 */

import type { InfraModel } from '@nodus-dev/preset-infra';

export interface GoldenFixture {
  /** Stable slug — becomes baseline/<name>.png. */
  readonly name: string;
  /** One-line description for the README/report. */
  readonly description: string;
  readonly model: InfraModel;
  readonly viewport: { readonly w: number; readonly h: number };
  /** Fixed camera — never zoomToFit (fit depends on measured bounds). */
  readonly camera: { readonly x: number; readonly y: number; readonly z: number };
  /** Node keys to select (drives the interactive/selection overlay). */
  readonly select?: readonly string[];
  /** Render the interactive layer (selection handles, halo). */
  readonly interactive?: boolean;
}

const NODE_H = 44;

/** Fixed-width node helper — width is hardcoded, never measured. */
function N(
  key: string,
  type: string,
  label: string,
  x: number,
  y: number,
  w: number,
  extra: Partial<InfraModel['nodes'][number]> = {},
): InfraModel['nodes'][number] {
  return { key, type, label, x, y, w, h: NODE_H, ...extra };
}

export const FIXTURES: readonly GoldenFixture[] = [
  {
    name: 'pipeline',
    description: 'Linear 4-node request pipeline with straight edges.',
    viewport: { w: 640, h: 320 },
    camera: { x: 0, y: 0, z: 1 },
    model: {
      nodes: [
        N('cdn', 'edge', 'CDN', 40, 130, 120),
        N('lb', 'lb', 'Load Balancer', 210, 130, 150),
        N('api', 'service', 'API', 410, 130, 110),
        N('db', 'db', 'Postgres', 570, 130, 130),
      ],
      edges: [
        { from: 'cdn', to: 'lb' },
        { from: 'lb', to: 'api' },
        { from: 'api', to: 'db' },
      ],
    },
  },
  {
    name: 'states',
    description: 'Node visual states + status overlays (met/partial/missed, ghost/solid/locked).',
    viewport: { w: 560, h: 420 },
    camera: { x: 0, y: 0, z: 1 },
    model: {
      nodes: [
        N('a', 'service', 'Solid', 40, 40, 130, { state: 'solid' }),
        N('b', 'db', 'Ghost', 40, 150, 130, { state: 'ghost' }),
        N('c', 'service', 'Locked', 40, 260, 130, { state: 'locked' }),
        N('d', 'cache', 'Met', 300, 40, 130, { overlay: 'met' }),
        N('e', 'db', 'Partial', 300, 150, 130, { overlay: 'partial' }),
        N('f', 'queue', 'Missed', 300, 260, 130, { overlay: 'missed' }),
      ],
      edges: [
        { from: 'a', to: 'd' },
        { from: 'b', to: 'e' },
        { from: 'c', to: 'f' },
      ],
    },
  },
  {
    name: 'selection',
    description: 'Pipeline with two nodes selected and the interactive overlay drawn.',
    viewport: { w: 640, h: 320 },
    camera: { x: 0, y: 0, z: 1 },
    select: ['lb', 'api'],
    interactive: true,
    model: {
      nodes: [
        N('cdn', 'edge', 'CDN', 40, 130, 120),
        N('lb', 'lb', 'Load Balancer', 210, 130, 150),
        N('api', 'service', 'API', 410, 130, 110),
        N('db', 'db', 'Postgres', 570, 130, 130),
      ],
      edges: [
        { from: 'cdn', to: 'lb' },
        { from: 'lb', to: 'api' },
        { from: 'api', to: 'db' },
      ],
    },
  },
  {
    name: 'fanout',
    description: 'Single gateway fanning out to four backends (branching edges).',
    viewport: { w: 640, h: 480 },
    camera: { x: 0, y: 0, z: 1 },
    model: {
      nodes: [
        N('gw', 'service', 'Gateway', 40, 210, 130),
        N('s1', 'service', 'Auth', 360, 40, 120),
        N('s2', 'service', 'Orders', 360, 150, 120),
        N('s3', 'cache', 'Redis', 360, 260, 120),
        N('s4', 'queue', 'Kafka', 360, 370, 120),
      ],
      edges: [
        { from: 'gw', to: 's1' },
        { from: 'gw', to: 's2' },
        { from: 'gw', to: 's3' },
        { from: 'gw', to: 's4' },
      ],
    },
  },
];
