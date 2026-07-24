/**
 * @nodus/preset-diagrams — general diagram types + builders. Turns friendly specs (flowchart steps,
 * state transitions, ERD tables, org hierarchy) into Nodus records, and ships a theme that colors
 * each type. Everything rides on the public API.
 */

import {
  defaultTheme,
  sessionIdFactory,
  type EdgeRecord,
  type Editor,
  type Endpoint,
  type NodeRecord,
  type NodeState,
  type NodusRecord,
  type Theme,
} from '@nodus/core';
import { ROW_H, diagramEdgeUtils, diagramNodeUtils } from './types.js';

export * from './types.js';
export * from './image.js';

// ---------------------------------------------------------------------------
// theme
// ---------------------------------------------------------------------------
const ACCENTS: Record<string, string> = {
  pill: '#22c55e',
  process: '#6366f1',
  decision: '#f59e0b',
  state: '#a78bfa',
  table: '#38bdf8',
  card: '#f472b6',
  icon: '#2dd4bf',
};

export const diagramsTheme: Theme = {
  ...defaultTheme,
  name: 'diagrams-dark',
  canvas: { fill: '#0b0f1a', grid: { color: 'rgba(255,255,255,0.035)', size: 26 } },
  byType: Object.fromEntries(Object.entries(ACCENTS).map(([k, c]) => [k, { stroke: c, text: c, glow: c }])),
};

export const diagramsLightTheme: Theme = {
  ...diagramsTheme,
  name: 'diagrams-light',
  canvas: { fill: '#f8fafc', grid: { color: 'rgba(15,23,42,0.05)', size: 26 } },
  states: {
    accent: { fill: '#ffffff', strokeWidth: 1.5 } as Theme['states'][string],
    solid: { fill: '#ffffff', stroke: '#cbd5e1', strokeWidth: 1.3, text: '#0f172a', glow: null },
    ghost: { fill: '#f1f5f9', stroke: '#e2e8f0', strokeWidth: 1, text: '#94a3b8', opacity: 0.6, glow: null },
    locked: { fill: '#ffffff', stroke: '#cbd5e1', strokeWidth: 1, text: '#94a3b8', dash: [4, 4], labelOverride: '?', glow: null },
  },
};

/** Register the diagram node/edge types and apply the diagrams theme. */
export function installDiagrams(editor: Editor, opts: { theme?: Theme } = {}): void {
  for (const u of diagramNodeUtils) editor.nodes.register(u);
  for (const u of diagramEdgeUtils) editor.edges.register(u);
  editor.sceneIndex.rebuild(editor.store.allRecords());
  editor.setTheme(opts.theme ?? diagramsTheme);
}

// ---------------------------------------------------------------------------
// record helpers
// ---------------------------------------------------------------------------
let zc = 0;
const zNext = () => (zc++).toString(36).padStart(10, '0');
// Out-of-editor builders mint session-prefixed, collision-resistant ids (F6) — distinct from any
// editor's own factory even across processes, unlike the old global-counter makeId.
const ids = sessionIdFactory();

function node(type: string, label: string, w: number, h: number, props: Record<string, unknown> = {}, state: NodeState = 'accent'): { id: `node:${string}`; rec: NodeRecord } {
  const id = ids.make('node');
  return { id, rec: { id, typeName: 'node', version: 0, type, x: 0, y: 0, w, h, z: zNext(), visual: { state }, label, props } };
}
function edge(from: string, to: string, label: string | undefined, fromPort: string, toPort: string): EdgeRecord {
  const f: Endpoint = { kind: 'node', nodeId: from as `node:${string}`, portId: fromPort };
  const t: Endpoint = { kind: 'node', nodeId: to as `node:${string}`, portId: toPort };
  return { id: ids.make('edge'), typeName: 'edge', version: 0, type: 'flow', from: f, to: t, visual: { state: 'solid' }, ...(label ? { label } : {}), props: {} };
}

// ---------------------------------------------------------------------------
// builders
// ---------------------------------------------------------------------------
export interface FlowStep {
  id: string;
  kind: 'start' | 'end' | 'process' | 'decision';
  label: string;
}
export interface FlowLink {
  from: string;
  to: string;
  label?: string;
  fromPort?: string;
}
export function buildFlowchart(spec: { steps: FlowStep[]; links: FlowLink[] }): NodusRecord[] {
  const typeOf = { start: 'pill', end: 'pill', process: 'process', decision: 'decision' } as const;
  const sizeOf = (k: FlowStep['kind']) => (k === 'decision' ? { w: 150, h: 92 } : k === 'process' ? { w: 150, h: 56 } : { w: 120, h: 44 });
  const recs: NodusRecord[] = [];
  const idmap = new Map<string, string>();
  for (const s of spec.steps) {
    const { w, h } = sizeOf(s.kind);
    const { id, rec } = node(typeOf[s.kind], s.label, w, h);
    idmap.set(s.id, id);
    recs.push(rec);
  }
  for (const l of spec.links) {
    const f = idmap.get(l.from);
    const t = idmap.get(l.to);
    if (f && t) recs.push(edge(f, t, l.label, l.fromPort ?? 'out', 'in'));
  }
  return recs;
}

export interface StateSpec {
  id: string;
  label: string;
  initial?: boolean;
}
export interface Transition {
  from: string;
  to: string;
  label?: string;
}
export function buildStateMachine(spec: { states: StateSpec[]; transitions: Transition[] }): NodusRecord[] {
  const recs: NodusRecord[] = [];
  const idmap = new Map<string, string>();
  for (const s of spec.states) {
    const { id, rec } = node('state', s.label, 120, 64, {}, s.initial ? 'solid' : 'accent');
    idmap.set(s.id, id);
    recs.push(rec);
  }
  for (const tr of spec.transitions) {
    const f = idmap.get(tr.from);
    const t = idmap.get(tr.to);
    if (f && t) recs.push(edge(f, t, tr.label, 'r', 'l'));
  }
  return recs;
}

export interface TableSpec {
  id: string;
  name: string;
  columns: string[];
}
export function buildERD(spec: { tables: TableSpec[]; relations: { from: string; to: string; label?: string }[] }): NodusRecord[] {
  const recs: NodusRecord[] = [];
  const idmap = new Map<string, string>();
  spec.tables.forEach((tbl, i) => {
    const h = 26 + tbl.columns.length * ROW_H + 8;
    const { id, rec } = node('table', tbl.name, 200, h, { columns: tbl.columns });
    rec.x = (i % 3) * 280;
    rec.y = Math.floor(i / 3) * 260;
    idmap.set(tbl.id, id);
    recs.push(rec);
  });
  for (const r of spec.relations) {
    const f = idmap.get(r.from);
    const t = idmap.get(r.to);
    if (f && t) recs.push(edge(f, t, r.label, 'r', 'l'));
  }
  return recs;
}

export interface OrgPerson {
  id: string;
  label: string;
  reportsTo?: string;
}
export function buildOrgChart(spec: { people: OrgPerson[] }): NodusRecord[] {
  const recs: NodusRecord[] = [];
  const idmap = new Map<string, string>();
  for (const p of spec.people) {
    const { id, rec } = node('card', p.label, 150, 48);
    idmap.set(p.id, id);
    recs.push(rec);
  }
  for (const p of spec.people) {
    if (!p.reportsTo) continue;
    const mgr = idmap.get(p.reportsTo);
    const self = idmap.get(p.id);
    if (mgr && self) recs.push(edge(mgr, self, undefined, 'out', 'in'));
  }
  return recs;
}
