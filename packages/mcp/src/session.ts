/**
 * DiagramSession — a headless Nodus Editor plus the tool handlers an MCP client drives. Kept free of
 * any stdio/protocol code so it can be unit-tested directly. `dispatch(session, name, args)` runs one
 * tool and returns MCP `content` blocks.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { Editor, diff, renderSVG, themePack, toCanonicalString, type CreateCanvas, type Endpoint, type FlowScale, type FlowSpec, type Id, type NodeRecord, type NodusRecord, type Vec2 } from '@nodus-dev/core';
import { diagramsTheme, installDiagrams } from '@nodus-dev/preset-diagrams';
import { installInfraPreset } from '@nodus-dev/preset-infra';
import { installDrawTools } from '@nodus-dev/preset-draw';
import { importMermaid } from '@nodus-dev/from-mermaid';
import { dagreLayout } from '@nodus-dev/layout-dagre';
import { elkLayout } from '@nodus-dev/layout-elk';
import { treeLayout } from '@nodus-dev/layout-tree';
import { forceLayout } from '@nodus-dev/layout-force';
import { fromKubernetes, fromTerraform } from '@nodus-dev/import-infra';
import { recordsFromSpec, type DiagramSpec } from '@nodus-dev/text-to-diagram';

export type Preset = 'diagrams' | 'infra' | 'draw';

const DEFAULT_TYPE: Record<Preset, string> = { diagrams: 'process', infra: 'infra.service', draw: 'draw.rect' };
const EDGE_TYPE: Record<Preset, string | undefined> = { diagrams: 'flow', infra: 'infra.connector', draw: 'draw.arrow' };

export interface Content {
  type: 'text' | 'image';
  text?: string;
  data?: string;
  mimeType?: string;
}
export interface ToolResult {
  content: Content[];
  isError?: boolean;
}

const text = (s: string): ToolResult => ({ content: [{ type: 'text', text: s }] });
const json = (v: unknown): ToolResult => text(JSON.stringify(v, null, 2));
const fail = (s: string): ToolResult => ({ content: [{ type: 'text', text: `Error: ${s}` }], isError: true });

/** A finite number from an arbitrary arg, or undefined (never NaN — a NaN x/y poisons contentBounds). */
const finiteNum = (v: unknown): number | undefined => {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Resolve a caller-supplied write path, but ONLY if it stays within an allowed root (cwd or the
 *  data dir). Blocks `../` escapes and absolute paths to files outside the workspace. */
const containedPath = (p: string, roots: string[]): string | null => {
  const abs = resolve(p);
  return roots.some((root) => {
    const r = resolve(root);
    return abs === r || abs.startsWith(r + sep);
  })
    ? abs
    : null;
};

export class DiagramSession {
  editor!: Editor;
  preset: Preset = 'diagrams';
  readonly exportsDir: string;
  readonly docsDir: string;
  exportSeq = 0;

  constructor(opts: { dataDir?: string } = {}) {
    const base = opts.dataDir ?? join(process.cwd(), '.nodus-mcp');
    this.exportsDir = join(base, 'exports');
    this.docsDir = join(base, 'docs');
    mkdirSync(this.exportsDir, { recursive: true });
    mkdirSync(this.docsDir, { recursive: true });
    this.reset('diagrams');
  }

  reset(preset: Preset): void {
    this.editor = new Editor();
    if (preset === 'infra') installInfraPreset(this.editor);
    else if (preset === 'draw') installDrawTools(this.editor);
    else {
      installDiagrams(this.editor);
      this.editor.setTheme(diagramsTheme);
    }
    this.editor.registerLayout(dagreLayout);
    this.editor.registerLayout(elkLayout);
    this.editor.registerLayout(treeLayout);
    this.editor.registerLayout(forceLayout);
    this.preset = preset;
  }

  /** Resolve a node reference that may be an id OR a (case-insensitive) label. */
  resolveNode(ref: string): Id<'node'> | null {
    if (!ref) return null; // fail closed: an empty ref must NOT match the first unlabeled node
    if (this.editor.store.has(ref as Id)) {
      const r = this.editor.store.peek(ref as Id);
      if (r?.typeName === 'node') return ref as Id<'node'>;
    }
    const lower = ref.toLowerCase();
    const hits = this.editor.store.nodes().filter((n) => (n.label ?? '').toLowerCase() === lower);
    // Ambiguity must be surfaced, not silently resolved to the first match (which would let
    // connect/update/delete act on an arbitrary node when two share a label). Caller catches → fail().
    if (hits.length > 1) throw new Error(`ambiguous node label "${ref}" matches ${hits.length} nodes (${hits.map((h) => h.id).join(', ')}) — reference it by id`);
    return hits[0] ? (hits[0].id as Id<'node'>) : null;
  }

  /** Resolve an edge reference that may be an id OR a (case-insensitive) edge label. */
  resolveEdge(ref: string): Id<'edge'> | null {
    if (!ref) return null;
    if (this.editor.store.has(ref as Id)) {
      const r = this.editor.store.peek(ref as Id);
      if (r?.typeName === 'edge') return ref as Id<'edge'>;
    }
    const lower = ref.toLowerCase();
    const hits = this.editor.store.edges().filter((e) => (e.label ?? '').toLowerCase() === lower);
    if (hits.length > 1) throw new Error(`ambiguous edge label "${ref}" matches ${hits.length} edges (${hits.map((h) => h.id).join(', ')}) — reference it by id`);
    return hits[0] ? (hits[0].id as Id<'edge'>) : null;
  }

  /** Edge ids from a `edges` arg: ids/labels list, or all edges when omitted / "all". */
  edgeTargets(arg: unknown): Id[] {
    const all = this.editor.store.edges().map((e) => e.id);
    if (arg == null) return all;
    const list = (Array.isArray(arg) ? arg : [arg]).map(String);
    if (list.length === 0 || list.includes('all')) return all;
    return list.map((r) => this.resolveEdge(r)).filter(Boolean) as Id[];
  }

  summary(): { preset: Preset; nodes: number; edges: number } {
    return { preset: this.preset, nodes: this.editor.store.nodes().length, edges: this.editor.store.edges().length };
  }
}

// ---------------------------------------------------------------------------
// tool definitions (name, description, JSON-Schema input)
// ---------------------------------------------------------------------------

const S = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const TOOLS = [
  {
    name: 'new_diagram',
    description: 'Start a fresh empty diagram. preset "diagrams" (flowchart/state/ER shapes, default), "infra" (cloud/service icons), or "draw" (plain rect/ellipse/diamond).',
    inputSchema: S({ preset: { type: 'string', enum: ['diagrams', 'infra', 'draw'] } }),
  },
  {
    name: 'import_mermaid',
    description: 'Replace the diagram with one parsed from a Mermaid string (flowchart/graph, stateDiagram(-v2), or erDiagram) and lay it out. This is the fastest way to author a diagram.',
    inputSchema: S(
      {
        source: { type: 'string', description: 'The Mermaid diagram text.' },
        layout: { type: 'string', enum: ['dagre', 'elk', 'tree', 'force', 'none'], description: 'Layout engine (default dagre).' },
        direction: { type: 'string', enum: ['TB', 'LR', 'RL', 'BT'] },
      },
      ['source'],
    ),
  },
  {
    name: 'add_node',
    description: 'Add a node. type must be registered by the active preset (e.g. diagrams: process/decision/pill/state/table/card). Returns the new node id.',
    inputSchema: S({ label: { type: 'string' }, type: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }), // label defaults to '' in the handler — not required
  },
  {
    name: 'connect_nodes',
    description: 'Connect two nodes with an edge. from/to may be node ids OR node labels. Optional edge label.',
    inputSchema: S({ from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } }, ['from', 'to']),
  },
  {
    name: 'update_node',
    description: 'Change a node (by id or label): rename, move, or set visual state (accent/solid/ghost/locked).',
    inputSchema: S({ node: { type: 'string' }, label: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, state: { type: 'string' } }, ['node']),
  },
  {
    name: 'delete_elements',
    description: 'Delete nodes/edges by id or node label. Deleting a node cascades its edges.',
    inputSchema: S({ refs: { type: 'array', items: { type: 'string' } } }), // refs defaults to [] in the handler — not required
  },
  {
    name: 'layout',
    description: 'Auto-layout the whole diagram. engine "dagre" (fast, default) or "elk" (layered/orthogonal).',
    inputSchema: S({ engine: { type: 'string', enum: ['dagre', 'elk', 'tree', 'force'] }, direction: { type: 'string', enum: ['TB', 'LR', 'RL', 'BT'] } }),
  },
  {
    name: 'list_elements',
    description: 'List the current nodes (id, type, label, position) and edges (id, from→to, label).',
    inputSchema: S({}),
  },
  {
    name: 'set_flow',
    description: 'Animate flow (packets/dashes traveling along edges) to visualize traffic. Omit `edges` for all edges, or pass edge ids. Pass off:true to remove. For DATA-DRIVEN flow, give a `scale` mapping a metric to speed/color, then push live values with set_flow_metric.',
    inputSchema: S({
      edges: { type: 'array', items: { type: 'string' }, description: 'edge ids (from connect_nodes / list_elements); omit for all' },
      off: { type: 'boolean' },
      style: { type: 'string', enum: ['dots', 'dash'] },
      speed: { type: 'number' }, color: { type: 'string' }, count: { type: 'number' }, size: { type: 'number' }, reverse: { type: 'boolean' },
      scale: {
        type: 'object',
        description: 'data-driven mapping: { domain:[min,max], speed?:[a,b], count?:[a,b], size?:[a,b], colors?:[{at,color}], gradient?:bool }',
        properties: {
          domain: { type: 'array', items: { type: 'number' } },
          speed: { type: 'array', items: { type: 'number' } },
          count: { type: 'array', items: { type: 'number' } },
          size: { type: 'array', items: { type: 'number' } },
          colors: { type: 'array', items: { type: 'object', properties: { at: { type: 'number' }, color: { type: 'string' } }, required: ['at', 'color'], additionalProperties: false } },
          gradient: { type: 'boolean' },
        },
        required: ['domain'],
        additionalProperties: false,
      },
    }),
  },
  {
    name: 'set_flow_metric',
    description: "Push live metric values (throughput / health / utilization) for data-driven flow. EPHEMERAL — not saved to the document. Each edge's flow.scale maps the value to packet speed + color. Call repeatedly as metrics change.",
    inputSchema: S(
      { metrics: { type: 'array', items: { type: 'object', properties: { edge: { type: 'string' }, value: { type: 'number' } }, required: ['edge', 'value'], additionalProperties: false } } },
    ), // metrics defaults to [] in the handler — not required (each item still requires edge+value)
  },
  {
    name: 'export_png',
    description: 'Render the diagram to a PNG. Saves a file and (unless inline:false) returns the image so you can see it. Shows flow packets when flow is configured (a traffic snapshot at `time` ms).',
    inputSchema: S({ path: { type: 'string' }, background: { type: 'boolean' }, grid: { type: 'boolean' }, pixelRatio: { type: 'number' }, inline: { type: 'boolean' }, flow: { type: 'boolean' }, time: { type: 'number' } }),
  },
  {
    name: 'export_json',
    description: 'Return the diagram as a versioned Nodus JSON snapshot (toJSON) — the canonical, git-trackable document.',
    inputSchema: S({}),
  },
  {
    name: 'save_doc',
    description: 'Save the diagram JSON under a name in the server data dir (git-trackable).',
    inputSchema: S({ name: { type: 'string' } }, ['name']),
  },
  {
    name: 'load_doc',
    description: 'Load a previously saved diagram by name (or list saved names if omitted).',
    inputSchema: S({ name: { type: 'string' } }),
  },
  {
    name: 'import_terraform',
    description: 'Build an infra diagram from `terraform show -json` output (plan/state as JSON). Switches to the infra preset. Pass the JSON as a string.',
    inputSchema: S({ source: { type: 'string', description: '`terraform show -json` output (JSON text).' } }, ['source']),
  },
  {
    name: 'import_kubernetes',
    description: 'Build an infra diagram from Kubernetes manifests (YAML or JSON, one or many resources). Switches to the infra preset.',
    inputSchema: S({ source: { type: 'string', description: 'Kubernetes YAML or JSON.' } }, ['source']),
  },
  {
    name: 'diff_docs',
    description: 'Semantic diff between two diagram versions: a saved doc (base) vs another saved doc or the current editor (compare). Returns added / removed / changed records — the git-native "code-review your diagram" view.',
    inputSchema: S({ base: { type: 'string', description: 'saved doc name (the baseline)' }, compare: { type: 'string', description: 'saved doc name; omit to compare against the current in-memory diagram' } }, ['base']),
  },
  {
    name: 'update_edge',
    description: 'Edit an existing edge (by id or label): relabel, choose its router (straight/orthogonal/bezier), and/or set waypoints — without delete+recreate.',
    inputSchema: S({ edge: { type: 'string' }, label: { type: 'string' }, router: { type: 'string', enum: ['straight', 'orthogonal', 'bezier'] }, waypoints: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'], additionalProperties: false } } }, ['edge']),
  },
  {
    name: 'set_theme',
    description: 'Switch the render theme (affects export_png / export_svg): one of pis, light, blueprint, neon, paper.',
    inputSchema: S({ theme: { type: 'string', enum: ['pis', 'light', 'blueprint', 'neon', 'paper'] } }, ['theme']),
  },
  {
    name: 'export_svg',
    description: 'Render the diagram to a scalable SVG (vector text — diffs and embeds cleanly). Saves a file and returns the SVG text.',
    inputSchema: S({ path: { type: 'string' }, background: { type: 'boolean' } }),
  },
  {
    name: 'author_from_spec',
    description: 'Build an infra diagram from a structured DiagramSpec ({ nodes:[{id,label,type?}], edges:[{from,to,label?}] }) — an LLM-native authoring schema. Switches to the infra preset.',
    inputSchema: S({ spec: { type: 'object', description: 'a DiagramSpec: { nodes: [...], edges: [...] }' } }, ['spec']),
  },
] as const;

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

const NAME_RE = /^[\w .-]{1,64}$/;

export async function dispatch(session: DiagramSession, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const ed = session.editor;
  const nodeInfo = (n: NodeRecord) => ({ id: n.id, type: n.type, label: n.label ?? '', x: Math.round(n.x), y: Math.round(n.y) });
  try {
    switch (name) {
      case 'new_diagram': {
        const preset = (args.preset as Preset) ?? 'diagrams';
        // Enforce the schema enum here (like set_flow guards scale.domain): an off-enum preset must
        // fail loudly, not fall through to reset() and poison the next default add_node with an
        // "unknown node type undefined" from DEFAULT_TYPE[<bad preset>].
        if (preset !== 'diagrams' && preset !== 'infra' && preset !== 'draw') {
          return fail(`unknown preset "${preset}" (allowed: diagrams, infra, draw)`);
        }
        session.reset(preset);
        return json({ ok: true, ...session.summary() });
      }
      case 'import_mermaid': {
        const src = String(args.source ?? '');
        if (!src.trim()) return fail('source is required');
        ed.loadSnapshot({ schemaVersion: 1, document: { records: [] } }); // REPLACE (importMermaid appends)
        const layout = args.layout === 'none' ? false : ((args.layout as string) ?? 'dagre');
        const parsed = await importMermaid(ed, src, {
          layout,
          ...(args.direction ? { direction: args.direction as 'TB' | 'LR' | 'RL' | 'BT' } : {}),
        });
        return json({ ok: true, kind: parsed.kind, nodes: ed.store.nodes().length, edges: ed.store.edges().length });
      }
      case 'add_node': {
        const type = (args.type as string) ?? DEFAULT_TYPE[session.preset];
        if (!ed.nodes.has(type)) return fail(`unknown node type "${type}" for the "${session.preset}" preset. Registered: ${ed.nodes.list().map((u) => u.type).join(', ')}`);
        const nx = finiteNum(args.x);
        const ny = finiteNum(args.y);
        const id = ed.createNode({ type, label: String(args.label ?? ''), ...(nx != null ? { x: nx } : {}), ...(ny != null ? { y: ny } : {}) });
        return json({ ok: true, id });
      }
      case 'connect_nodes': {
        const from = session.resolveNode(String(args.from ?? ''));
        const to = session.resolveNode(String(args.to ?? ''));
        if (!from) return fail(`no node matching "${args.from}"`);
        if (!to) return fail(`no node matching "${args.to}"`);
        const fe: Endpoint = { kind: 'outline', nodeId: from };
        const te: Endpoint = { kind: 'outline', nodeId: to };
        const id = ed.connect(fe, te, EDGE_TYPE[session.preset]);
        if (!id) return fail('connect failed (no edge type registered)');
        if (args.label) ed.store.apply([{ op: 'update', id, patch: { label: String(args.label) } }], { capture: 'immediately' });
        return json({ ok: true, id });
      }
      case 'update_node': {
        const id = session.resolveNode(String(args.node ?? ''));
        if (!id) return fail(`no node matching "${args.node}"`);
        const rec = ed.store.peek(id) as NodeRecord;
        const patch: Partial<NodeRecord> = {};
        if (args.label != null) patch.label = String(args.label);
        const nx = finiteNum(args.x);
        const ny = finiteNum(args.y);
        if (nx != null) patch.x = nx;
        if (ny != null) patch.y = ny;
        if (args.state != null) patch.visual = { ...rec.visual, state: String(args.state) };
        ed.updateNode(id, patch);
        return json({ ok: true, id });
      }
      case 'delete_elements': {
        const refs = Array.isArray(args.refs) ? args.refs.map(String) : []; // tolerate a mistyped scalar instead of throwing "refs.map is not a function"
        const ids = refs.map((r) => (ed.store.has(r as Id) ? (r as Id) : session.resolveNode(r))).filter(Boolean) as Id[];
        ed.deleteRecords(ids);
        return json({ ok: true, deleted: ids.length });
      }
      case 'layout': {
        const engine = (args.engine as string) ?? 'dagre';
        await ed.layout(engine, { direction: (args.direction as 'TB' | 'LR' | 'RL' | 'BT') ?? 'TB' });
        return json({ ok: true, engine, nodes: ed.store.nodes().length });
      }
      case 'list_elements': {
        return json({
          nodes: ed.store.nodes().map(nodeInfo),
          edges: ed.store.edges().map((e) => ({
            id: e.id,
            from: (e.from as { nodeId?: string }).nodeId ?? null,
            to: (e.to as { nodeId?: string }).nodeId ?? null,
            label: e.label ?? '',
          })),
        });
      }
      case 'set_flow': {
        const ids = session.edgeTargets(args.edges);
        if (ids.length === 0) return fail('no matching edges to animate');
        if (args.off === true) {
          ed.setFlow(ids, null);
          return json({ ok: true, cleared: ids.length });
        }
        const flow: FlowSpec = {};
        if (args.style === 'dots' || args.style === 'dash') flow.style = args.style;
        const sp = finiteNum(args.speed);
        if (sp != null) flow.speed = sp;
        if (typeof args.color === 'string') flow.color = args.color;
        const sz = finiteNum(args.size);
        if (sz != null) flow.size = sz;
        const ct = finiteNum(args.count);
        if (ct != null) flow.count = ct;
        if (args.reverse === true) flow.reverse = true;
        if (args.scale != null) {
          const s = args.scale as { domain?: unknown };
          if (!Array.isArray(s.domain) || s.domain.length !== 2 || !s.domain.every((n) => typeof n === 'number')) {
            return fail('scale.domain must be [min, max] numbers');
          }
          flow.scale = args.scale as FlowScale;
        }
        ed.setFlow(ids, flow);
        return json({ ok: true, edges: ids.length, dataDriven: flow.scale != null });
      }
      case 'set_flow_metric': {
        const metrics = Array.isArray(args.metrics) ? (args.metrics as { edge: string; value: number }[]) : []; // tolerate a mistyped scalar instead of "metrics is not iterable"
        let applied = 0;
        const unresolved: string[] = [];
        for (const m of metrics) {
          const id = session.resolveEdge(String(m.edge));
          const v = finiteNum(m.value);
          if (id && v != null) {
            ed.setFlowMetric(id, v);
            applied++;
          } else unresolved.push(String(m.edge));
        }
        return json({ ok: true, applied, ...(unresolved.length ? { unresolved } : {}) });
      }
      case 'export_png': {
        if (!ed.sceneIndex.contentBounds()) return fail('nothing to export — the diagram is empty');
        const create: CreateCanvas = (w, h) => createCanvas(w, h) as unknown as ReturnType<CreateCanvas>;
        const png = await ed.toPNG(create, {
          pixelRatio: Math.min(8, Math.max(0.1, finiteNum(args.pixelRatio) ?? 2)), // clamp: an absurd/NaN ratio must not force a multi-GB or NaN-sized Skia canvas
          background: args.background !== false,
          grid: args.grid === true,
          padding: 40,
          flow: args.flow != null ? args.flow === true : ed.hasFlow(), // show the traffic snapshot by default
          time: finiteNum(args.time) ?? 0,
        });
        let path: string;
        if (args.path != null) {
          const contained = containedPath(String(args.path), [process.cwd(), session.exportsDir, session.docsDir]);
          if (!contained) return fail(`refusing to write outside the working directory or data dir: ${args.path}`);
          path = contained;
        } else {
          path = join(session.exportsDir, `diagram-${++session.exportSeq}.png`);
        }
        writeFileSync(path, png);
        const content: Content[] = [{ type: 'text', text: `Saved PNG (${png.length} bytes) to ${path}` }];
        if (args.inline !== false) content.push({ type: 'image', data: Buffer.from(png).toString('base64'), mimeType: 'image/png' });
        return { content };
      }
      case 'export_json': {
        return text(toCanonicalString(ed.toJSON({ exportedBy: 'nodus-mcp' })));
      }
      case 'save_doc': {
        const docName = String(args.name ?? '');
        if (!NAME_RE.test(docName)) return fail('invalid doc name (allowed: letters, digits, space, . _ -, ≤64 chars)');
        // Canonical bytes: the saved doc is git-trackable with a clean, minimal diff.
        writeFileSync(join(session.docsDir, `${docName}.json`), toCanonicalString(ed.toJSON({ updated: Date.now() })));
        return json({ ok: true, name: docName });
      }
      case 'load_doc': {
        if (args.name == null) {
          const names = readdirSync(session.docsDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
          return json({ docs: names });
        }
        const docName = String(args.name);
        if (!NAME_RE.test(docName)) return fail('invalid doc name');
        let raw: string;
        try {
          raw = readFileSync(join(session.docsDir, `${docName}.json`), 'utf8');
        } catch {
          return fail(`no saved doc named "${docName}"`);
        }
        ed.loadSnapshot(JSON.parse(raw), { fit: true });
        return json({ ok: true, name: docName, nodes: ed.store.nodes().length });
      }
      case 'import_terraform': {
        const src = args.source;
        let showJson: unknown;
        if (typeof src === 'string') {
          try { showJson = JSON.parse(src); } catch { return fail('source must be `terraform show -json` output (a JSON string)'); }
        } else if (src != null && typeof src === 'object') {
          showJson = src;
        } else {
          return fail('source is required (terraform show -json output)');
        }
        let records: NodusRecord[];
        try { records = fromTerraform(showJson); } catch (e) { return fail(`terraform import failed: ${e instanceof Error ? e.message : String(e)}`); }
        session.reset('infra'); // records are infra-typed; ensure the infra node types are registered
        session.editor.loadSnapshot({ schemaVersion: 1, document: { records } }, { fit: true });
        return json({ ok: true, ...session.summary() });
      }
      case 'import_kubernetes': {
        const src = args.source;
        if (typeof src !== 'string' || !src.trim()) return fail('source is required (Kubernetes YAML or JSON)');
        let records: NodusRecord[];
        try { records = fromKubernetes(src); } catch (e) { return fail(`kubernetes import failed: ${e instanceof Error ? e.message : String(e)}`); }
        session.reset('infra');
        session.editor.loadSnapshot({ schemaVersion: 1, document: { records } }, { fit: true });
        return json({ ok: true, ...session.summary() });
      }
      case 'diff_docs': {
        const readRecords = (docName: string): NodusRecord[] | null => {
          if (!NAME_RE.test(docName)) return null;
          let raw: string;
          try { raw = readFileSync(join(session.docsDir, `${docName}.json`), 'utf8'); } catch { return null; }
          return (JSON.parse(raw) as { document?: { records?: NodusRecord[] } }).document?.records ?? [];
        };
        const baseName = String(args.base ?? '');
        if (!baseName) return fail('base (a saved doc name) is required');
        const baseRecs = readRecords(baseName);
        if (!baseRecs) return fail(`no saved doc named "${baseName}"`);
        let compareRecs: NodusRecord[];
        if (args.compare != null) {
          const cmp = readRecords(String(args.compare));
          if (!cmp) return fail(`no saved doc named "${args.compare}"`);
          compareRecs = cmp;
        } else {
          compareRecs = ed.toJSON({ exportedBy: 'nodus-mcp' }).document.records as NodusRecord[];
        }
        const d = diff(baseRecs, compareRecs);
        return json({ base: baseName, compare: args.compare != null ? String(args.compare) : '(current)', added: d.added.length, removed: d.removed.length, changed: d.changed.length, detail: d });
      }
      case 'update_edge': {
        const id = session.resolveEdge(String(args.edge ?? ''));
        if (!id) return fail(`no edge matching "${args.edge}"`);
        let changed = 0;
        if (args.label != null) { ed.setEdgeLabel(id, String(args.label)); changed++; }
        if (args.router != null) {
          const r = String(args.router);
          if (r !== 'straight' && r !== 'orthogonal' && r !== 'bezier') return fail(`unknown router "${r}" (allowed: straight, orthogonal, bezier)`);
          ed.setEdgeRouter(id, r);
          changed++;
        }
        if (args.waypoints != null) {
          if (!Array.isArray(args.waypoints)) return fail('waypoints must be an array of { x, y }');
          const pts: Vec2[] = args.waypoints.map((p) => ({ x: finiteNum((p as { x?: unknown }).x) ?? 0, y: finiteNum((p as { y?: unknown }).y) ?? 0 }));
          ed.setWaypoints(id, pts);
          changed++;
        }
        return json({ ok: true, id, changed });
      }
      case 'set_theme': {
        const themeName = String(args.theme ?? '');
        const theme = themePack[themeName];
        if (!theme) return fail(`unknown theme "${themeName}" (allowed: ${Object.keys(themePack).join(', ')})`);
        ed.setTheme(theme);
        return json({ ok: true, theme: themeName });
      }
      case 'export_svg': {
        if (!ed.sceneIndex.contentBounds()) return fail('nothing to export — the diagram is empty');
        const svg = renderSVG(ed);
        let path: string;
        if (args.path != null) {
          const contained = containedPath(String(args.path), [process.cwd(), session.exportsDir, session.docsDir]);
          if (!contained) return fail(`refusing to write outside the working directory or data dir: ${args.path}`);
          path = contained;
        } else {
          path = join(session.exportsDir, `diagram-${++session.exportSeq}.svg`);
        }
        writeFileSync(path, svg);
        return { content: [{ type: 'text', text: `Saved SVG (${svg.length} bytes) to ${path}` }, { type: 'text', text: svg }] };
      }
      case 'author_from_spec': {
        const spec = args.spec;
        if (spec == null || typeof spec !== 'object') return fail('spec is required (a DiagramSpec: { nodes: [...], edges: [...] })');
        let records: NodusRecord[];
        try { records = recordsFromSpec(spec as DiagramSpec); } catch (e) { return fail(`invalid spec: ${e instanceof Error ? e.message : String(e)}`); }
        session.reset('infra'); // recordsFromSpec produces infra-typed records
        session.editor.loadSnapshot({ schemaVersion: 1, document: { records } }, { fit: true });
        return json({ ok: true, ...session.summary() });
      }
      default:
        return fail(`unknown tool "${name}"`);
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}
