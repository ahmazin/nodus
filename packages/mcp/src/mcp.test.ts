import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import { DiagramSession, TOOLS, dispatch, runStdioServer } from '@ahmazin/mcp';

const dataDir = mkdtempSync(join(tmpdir(), 'nodus-mcp-'));
const call = (s: DiagramSession, name: string, args: Record<string, unknown> = {}) => dispatch(s, name, args);
const asJson = (r: { content: { text?: string }[] }) => JSON.parse(r.content[0]!.text!);

describe('nodus-mcp: tool surface', () => {
  it('exposes the expected tools with valid JSON-Schema', () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toContain('import_mermaid');
    expect(names).toContain('export_png');
    expect(names).toContain('set_flow');
    expect(names).toContain('set_flow_metric');
    for (const t of TOOLS) {
      expect(typeof t.description).toBe('string');
      expect(t.inputSchema.type).toBe('object');
    }
  });

  it('does not mark schema-required fields that the handler defaults', () => {
    // Each of these handlers coalesces the field to a default (label→'', refs→[], metrics→[]),
    // so the advertised schema must not claim they are required.
    const requiredOf = (name: string) => TOOLS.find((t) => t.name === name)!.inputSchema.required as readonly string[];
    expect(requiredOf('add_node')).not.toContain('label');
    expect(requiredOf('delete_elements')).not.toContain('refs');
    expect(requiredOf('set_flow_metric')).not.toContain('metrics');
  });
});

describe('nodus-mcp: authoring', () => {
  it('imports a Mermaid flowchart and lists elements', async () => {
    const s = new DiagramSession({ dataDir });
    const r = asJson(await call(s, 'import_mermaid', { source: 'flowchart LR\n A([Start]) --> B{OK?} -->|yes| C[Done]' }));
    expect(r.kind).toBe('flowchart');
    expect(r.nodes).toBe(3);
    expect(r.edges).toBe(2);
    const list = asJson(await call(s, 'list_elements'));
    expect(list.nodes.map((n: { label: string }) => n.label).sort()).toEqual(['Done', 'OK?', 'Start']);
    expect(list.edges).toHaveLength(2);
  });

  it('builds a diagram by hand: add_node + connect_nodes by label', async () => {
    const s = new DiagramSession({ dataDir });
    const a = asJson(await call(s, 'add_node', { label: 'A' })).id;
    await call(s, 'add_node', { label: 'B', type: 'decision' });
    const e = asJson(await call(s, 'connect_nodes', { from: 'A', to: 'B', label: 'go' }));
    expect(e.ok).toBe(true);
    const list = asJson(await call(s, 'list_elements'));
    expect(list.edges[0].from).toBe(a);
    expect(list.edges[0].label).toBe('go');
  });

  it('rejects an unknown node type for the active preset', async () => {
    const s = new DiagramSession({ dataDir });
    const r = await call(s, 'add_node', { label: 'X', type: 'not-a-type' });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/unknown node type/);
  });

  it('switches presets and validates types accordingly', async () => {
    const s = new DiagramSession({ dataDir });
    await call(s, 'new_diagram', { preset: 'infra' });
    const ok = await call(s, 'add_node', { label: 'API', type: 'infra.service' });
    expect(ok.isError).toBeUndefined();
    const bad = await call(s, 'add_node', { label: 'Y', type: 'process' }); // diagrams type, not infra
    expect(bad.isError).toBe(true);
  });

  it('new_diagram rejects an off-enum preset instead of silently proceeding', async () => {
    const s = new DiagramSession({ dataDir });
    const r = await call(s, 'new_diagram', { preset: 'bogus' });
    expect(r.isError).toBe(true); // not ok:true
    expect(r.content[0]!.text).toMatch(/unknown preset/i);
    // and the rejected reset must not poison the session: the next default add_node still works
    // (the pre-fix bug left preset='bogus' → DEFAULT_TYPE['bogus']=undefined → "unknown node type undefined")
    const add = await call(s, 'add_node', { label: 'A' });
    expect(add.isError).toBeUndefined();
  });

  it('update_node renames and delete_elements removes by label', async () => {
    const s = new DiagramSession({ dataDir });
    await call(s, 'add_node', { label: 'Old' });
    await call(s, 'update_node', { node: 'Old', label: 'New', state: 'ghost' });
    let list = asJson(await call(s, 'list_elements'));
    expect(list.nodes[0].label).toBe('New');
    await call(s, 'delete_elements', { refs: ['New'] });
    list = asJson(await call(s, 'list_elements'));
    expect(list.nodes).toHaveLength(0);
  });
});

describe('nodus-mcp: review regressions', () => {
  it('import_mermaid REPLACES the diagram (does not append to prior content)', async () => {
    const s = new DiagramSession({ dataDir });
    await call(s, 'add_node', { label: 'Orphan' });
    await call(s, 'import_mermaid', { source: 'graph LR\n A --> B' });
    const list = asJson(await call(s, 'list_elements'));
    expect(list.nodes.map((n: { label: string }) => n.label).sort()).toEqual(['A', 'B']); // Orphan gone
    // re-importing does not stack duplicates
    await call(s, 'import_mermaid', { source: 'graph LR\n A --> B' });
    expect(asJson(await call(s, 'list_elements')).nodes).toHaveLength(2);
  });

  it('export_png refuses to write outside the working dir / data dir', async () => {
    const s = new DiagramSession({ dataDir });
    await call(s, 'import_mermaid', { source: 'graph TD\n A --> B' });
    const bad = await call(s, 'export_png', { path: '/etc/nodus-should-not-write.png', inline: false });
    expect(bad.isError).toBe(true);
    expect(bad.content[0]!.text).toMatch(/refusing to write/);
    const good = await call(s, 'export_png', { path: join(s.exportsDir, 'ok.png'), inline: false });
    expect(good.isError).toBeUndefined();
  });

  it('an empty node reference fails closed (does not delete/rename the first unlabeled node)', async () => {
    const s = new DiagramSession({ dataDir });
    await call(s, 'add_node', { label: '' }); // unlabeled node
    const del = asJson(await call(s, 'delete_elements', { refs: [''] }));
    expect(del.deleted).toBe(0);
    expect(asJson(await call(s, 'list_elements')).nodes).toHaveLength(1); // still there
  });

  it('non-numeric x/y is ignored rather than stored as NaN', async () => {
    const s = new DiagramSession({ dataDir });
    await call(s, 'add_node', { label: 'X', x: 'abc', y: 5 });
    const n = asJson(await call(s, 'list_elements')).nodes[0];
    expect(typeof n.x).toBe('number'); // not null (NaN → JSON null)
    expect(Number.isFinite(n.x)).toBe(true);
    expect(n.y).toBe(5);
  });

  it('export_png clamps an absurd pixelRatio instead of attempting an oversized allocation', async () => {
    const s = new DiagramSession({ dataDir });
    await call(s, 'import_mermaid', { source: 'graph LR\n A --> B' });
    const r = await call(s, 'export_png', { pixelRatio: 100000, inline: false }); // pre-fix: multi-GB Skia alloc
    expect(r.isError).toBeUndefined(); // clamped to 8x
    expect(r.content[0]!.text).toMatch(/Saved PNG/);
  });

  it('a mistyped (non-array) refs arg is tolerated, not a cryptic "refs.map is not a function"', async () => {
    const s = new DiagramSession({ dataDir });
    await call(s, 'add_node', { label: 'A' });
    const r = asJson(await call(s, 'delete_elements', { refs: 'A' })); // schema says array; client sent a string
    expect(r.deleted).toBe(0); // coerced to [] rather than throwing
  });

  it('an ambiguous label ref is reported, not silently resolved to the first match', async () => {
    const s = new DiagramSession({ dataDir });
    await call(s, 'add_node', { label: 'DB' });
    await call(s, 'add_node', { label: 'DB' }); // duplicate label
    const del = await call(s, 'delete_elements', { refs: ['DB'] });
    expect(del.isError).toBe(true);
    expect(del.content[0]!.text).toMatch(/ambiguous/i);
  });

  it('update_node moves x/y; resolution fails cleanly on an unknown ref', async () => {
    const s = new DiagramSession({ dataDir });
    await call(s, 'add_node', { label: 'M', x: 0, y: 0 });
    await call(s, 'update_node', { node: 'M', x: 120, y: 34 });
    const n = asJson(await call(s, 'list_elements')).nodes[0];
    expect(n.x).toBe(120);
    expect(n.y).toBe(34);
    const bad = await call(s, 'connect_nodes', { from: 'M', to: 'ghost' });
    expect(bad.isError).toBe(true);
    expect(bad.content[0]!.text).toMatch(/no node matching/);
  });
});

describe('nodus-mcp: layout + export', () => {
  it('lays out with dagre into distinct positions', async () => {
    const s = new DiagramSession({ dataDir });
    await call(s, 'import_mermaid', { source: 'graph LR\n A-->B-->C-->D', layout: 'none' });
    await call(s, 'layout', { engine: 'dagre', direction: 'LR' });
    const list = asJson(await call(s, 'list_elements'));
    const positions = new Set(list.nodes.map((n: { x: number; y: number }) => `${n.x},${n.y}`));
    expect(positions.size).toBe(4);
  });

  it('export_png returns an inline image + saves a file, export_json round-trips', async () => {
    const s = new DiagramSession({ dataDir });
    await call(s, 'import_mermaid', { source: 'graph TD\n A[One] --> B[Two]' });
    const png = await call(s, 'export_png', {});
    expect(png.content.some((c) => c.type === 'image' && c.mimeType === 'image/png' && (c.data?.length ?? 0) > 1000)).toBe(true);
    expect(png.content[0]!.text).toMatch(/Saved PNG/);
    const snap = JSON.parse((await call(s, 'export_json', {})).content[0]!.text!);
    expect(snap.schemaVersion).toBeGreaterThanOrEqual(1);
    expect(snap.document.records.length).toBeGreaterThan(0);
  });

  it('export_png on an empty diagram errors gracefully', async () => {
    const s = new DiagramSession({ dataDir });
    const r = await call(s, 'export_png', {});
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/empty/);
  });

  it('save_doc + load_doc round-trip and list saved docs', async () => {
    const s = new DiagramSession({ dataDir });
    await call(s, 'import_mermaid', { source: 'graph TD\n A --> B' });
    await call(s, 'save_doc', { name: 'my graph' });
    const s2 = new DiagramSession({ dataDir });
    const loaded = asJson(await call(s2, 'load_doc', { name: 'my graph' }));
    expect(loaded.nodes).toBe(2);
    const listed = asJson(await call(s2, 'load_doc', {}));
    expect(listed.docs).toContain('my graph');
  });

  it('rejects a path-traversal doc name', async () => {
    const s = new DiagramSession({ dataDir });
    const r = await call(s, 'save_doc', { name: '../evil' });
    expect(r.isError).toBe(true);
  });

  it('unknown tool returns an error result', async () => {
    const s = new DiagramSession({ dataDir });
    const r = await call(s, 'nope', {});
    expect(r.isError).toBe(true);
  });
});

describe('nodus-mcp: flow', () => {
  const withEdges = async () => {
    const s = new DiagramSession({ dataDir });
    await call(s, 'import_mermaid', { source: 'graph LR\n A --> B --> C' });
    const edges = asJson(await call(s, 'list_elements')).edges as { id: string }[];
    return { s, edges };
  };

  it('set_flow animates all edges and off clears them', async () => {
    const { s } = await withEdges();
    const r = asJson(await call(s, 'set_flow', { style: 'dots' }));
    expect(r.edges).toBe(2);
    expect(s.editor.hasFlow()).toBe(true);
    await call(s, 'set_flow', { off: true });
    expect(s.editor.hasFlow()).toBe(false);
  });

  it('data-driven flow: set_flow_metric drives the edge and is ephemeral (no doc change)', async () => {
    const { s, edges } = await withEdges();
    const r = asJson(await call(s, 'set_flow', { scale: { domain: [0, 1], speed: [10, 100], colors: [{ at: 0, color: '#ef4444' }, { at: 0.7, color: '#22c55e' }] } }));
    expect(r.dataDriven).toBe(true);
    const doc0 = JSON.stringify(s.editor.toJSON());
    const m = asJson(await call(s, 'set_flow_metric', { metrics: [{ edge: edges[0]!.id, value: 0.9 }, { edge: 'no-such-edge', value: 1 }] }));
    expect(m.applied).toBe(1);
    expect(m.unresolved).toEqual(['no-such-edge']);
    expect(s.editor.flowMetric(edges[0]!.id as never)).toBe(0.9);
    expect(JSON.stringify(s.editor.toJSON())).toBe(doc0); // metric push did not touch the document
  });

  it('set_flow rejects a malformed scale.domain', async () => {
    const { s } = await withEdges();
    const r = await call(s, 'set_flow', { scale: { domain: [0] } });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/domain must be/);
  });

  it('export_png renders a flow snapshot that differs from the plain render', async () => {
    const { s } = await withEdges();
    const imgOf = (r: { content: { type: string; data?: string }[] }) => r.content.find((c) => c.type === 'image')!.data!;
    const plain = imgOf(await call(s, 'export_png', {}));
    await call(s, 'set_flow', { style: 'dots', color: '#ff00ff' });
    const flowed = imgOf(await call(s, 'export_png', {}));
    expect(flowed).not.toBe(plain); // the packets add pixels
  });
});

describe('nodus-mcp: new tools (audit remediation)', () => {
  it('import_terraform builds an infra diagram from `terraform show -json`', async () => {
    const s = new DiagramSession({ dataDir });
    const show = { values: { root_module: { resources: [
      { address: 'aws_cloudfront_distribution.cdn', type: 'aws_cloudfront_distribution', name: 'cdn', depends_on: [] },
      { address: 'aws_lambda_function.api', type: 'aws_lambda_function', name: 'api', depends_on: ['aws_cloudfront_distribution.cdn'] },
      { address: 'aws_dynamodb_table.orders', type: 'aws_dynamodb_table', name: 'orders', depends_on: ['aws_lambda_function.api'] },
    ] } } };
    const r = asJson(await call(s, 'import_terraform', { source: JSON.stringify(show) }));
    expect(r.preset).toBe('infra');
    expect(r.nodes).toBe(3);
    expect(r.edges).toBe(2);
  });

  it('import_kubernetes builds an infra diagram from a manifest', async () => {
    const s = new DiagramSession({ dataDir });
    const yaml = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: orders\nspec:\n  replicas: 2';
    const r = asJson(await call(s, 'import_kubernetes', { source: yaml }));
    expect(r.preset).toBe('infra');
    expect(r.nodes).toBeGreaterThanOrEqual(1);
  });

  it('author_from_spec builds a diagram from a structured DiagramSpec', async () => {
    const s = new DiagramSession({ dataDir });
    const spec = { nodes: [{ id: 'gw', type: 'edge', label: 'API Gateway' }, { id: 'svc', type: 'service', label: 'Orders' }], edges: [{ from: 'gw', to: 'svc' }] };
    const r = asJson(await call(s, 'author_from_spec', { spec }));
    expect(r.nodes).toBe(2);
    expect(r.edges).toBe(1);
  });

  it('diff_docs reports what changed between a saved doc and the current diagram', async () => {
    const s = new DiagramSession({ dataDir });
    await call(s, 'import_mermaid', { source: 'graph LR\n A --> B' });
    await call(s, 'save_doc', { name: 'diffbase' });
    await call(s, 'add_node', { label: 'C' }); // mutate current
    const d = asJson(await call(s, 'diff_docs', { base: 'diffbase' }));
    expect(d.added).toBeGreaterThanOrEqual(1); // C is new vs the baseline
    expect(d.removed).toBe(0);
    const missing = await call(s, 'diff_docs', { base: 'no-such-doc' });
    expect(missing.isError).toBe(true);
  });

  it('update_edge relabels + reroutes an existing edge without delete+recreate', async () => {
    const s = new DiagramSession({ dataDir });
    await call(s, 'add_node', { label: 'A' });
    await call(s, 'add_node', { label: 'B' });
    const eid = asJson(await call(s, 'connect_nodes', { from: 'A', to: 'B' })).id;
    const u = asJson(await call(s, 'update_edge', { edge: eid, label: 'flows', router: 'orthogonal' }));
    expect(u.changed).toBe(2);
    expect(asJson(await call(s, 'list_elements')).edges[0].label).toBe('flows');
    const bad = await call(s, 'update_edge', { edge: eid, router: 'squiggle' });
    expect(bad.isError).toBe(true);
  });

  it('set_theme switches themes and rejects an unknown one', async () => {
    const s = new DiagramSession({ dataDir });
    expect(asJson(await call(s, 'set_theme', { theme: 'light' })).ok).toBe(true);
    expect((await call(s, 'set_theme', { theme: 'nope' })).isError).toBe(true);
  });

  it('export_svg returns scalable SVG text', async () => {
    const s = new DiagramSession({ dataDir });
    await call(s, 'import_mermaid', { source: 'graph LR\n A --> B' });
    const r = await call(s, 'export_svg', {});
    expect(r.isError).toBeUndefined();
    expect(r.content.some((c) => (c.text ?? '').includes('<svg'))).toBe(true);
  });

  it('layout exposes tree + force (and elk) engines, not just dagre', async () => {
    const s = new DiagramSession({ dataDir });
    await call(s, 'import_mermaid', { source: 'graph TD\n A-->B\n A-->C', layout: 'none' });
    for (const engine of ['tree', 'force', 'elk']) {
      expect(asJson(await call(s, 'layout', { engine })).ok).toBe(true);
    }
  });

  it('the draw preset path works (add a draw.rect)', async () => {
    const s = new DiagramSession({ dataDir });
    await call(s, 'new_diagram', { preset: 'draw' });
    expect((await call(s, 'add_node', { label: 'R', type: 'draw.rect' })).isError).toBeUndefined();
  });
});

describe('nodus-mcp: stdio transport (JSON-RPC over the wire)', () => {
  // Drive the REAL runStdioServer over in-memory pipes and collect its JSON-RPC responses. This is the
  // surface a client actually talks to (initialize/tools-list/tools-call/notifications/errors) — the
  // audit flagged it as having zero behavioral coverage.
  type Rpc = Record<string, unknown>;
  const drive = (lines: string[]): Promise<Rpc[]> =>
    new Promise((resolveDone) => {
      const input = new PassThrough();
      const output = new PassThrough();
      const responses: Rpc[] = [];
      let buf = '';
      output.on('data', (c: Buffer | string) => {
        buf += c.toString();
        let nl: number;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) responses.push(JSON.parse(line) as Rpc);
        }
      });
      runStdioServer(new DiagramSession({ dataDir }), { input, output, onExit: () => setImmediate(() => resolveDone(responses)) });
      for (const l of lines) input.write(`${l}\n`);
      input.end();
    });
  const byId = (res: Rpc[], id: number | null) => res.find((r) => r.id === id) as { id: unknown; result?: any; error?: any } | undefined;

  it('REGRESSION: a lone `null` line does not wedge the loop — the message after it still processes', async () => {
    const res = await drive([
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      'null', // pre-fix killer: JSON.parse('null') destructure-crashed handle() and poisoned the queue
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    ]);
    expect(byId(res, 1)).toBeDefined(); // handshake answered
    expect(byId(res, 2)).toBeDefined(); // and the message AFTER the null still got through (was silently dropped before)
    expect(byId(res, 2)!.result.tools.length).toBe(TOOLS.length);
    // the null line itself is answered as Invalid Request (id null), not a crash
    expect(res.some((r) => r.id === null && (r.error as { code?: number })?.code === -32600)).toBe(true);
  });

  it('initialize returns a supported protocolVersion + serverInfo.version from package.json', async () => {
    const [r] = await drive([JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })]);
    const result = (r as { result: any }).result;
    expect(result.protocolVersion).toBe('2025-06-18'); // echoes a supported requested version
    expect(result.serverInfo.name).toBe('nodus-mcp');
    expect(result.serverInfo.version).toMatch(/^\d+\.\d+\.\d+/); // sourced from package.json, not hardcoded
    expect(result.capabilities.tools).toBeDefined();
  });

  it('version negotiation: an unsupported client version is answered with the server’s own', async () => {
    const [r] = await drive([JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } })]);
    expect((r as { result: any }).result.protocolVersion).toBe('2025-06-18');
  });

  it('tools/list returns the full tool set; tools/call routes to dispatch', async () => {
    const res = await drive([
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_elements', arguments: {} } }),
    ]);
    expect(byId(res, 1)!.result.tools).toHaveLength(TOOLS.length);
    expect(byId(res, 2)!.result.content[0].type).toBe('text');
  });

  it('notification (no id) → no reply; unknown method → -32601; bad envelope → -32600; bad JSON → -32700', async () => {
    const res = await drive([
      JSON.stringify({ jsonrpc: '2.0', method: 'ping' }),                  // notification → no reply
      JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'does_not_exist' }), // unknown method
      JSON.stringify({ jsonrpc: '2.0', id: 11 }),                          // no method → invalid request
      '{ not json',                                                        // parse error
    ]);
    expect(res.find((r) => r.id === undefined)).toBeUndefined();           // the notification produced nothing
    expect(byId(res, 10)!.error.code).toBe(-32601);
    expect(byId(res, 11)!.error.code).toBe(-32600);
    expect(res.some((r) => r.id === null && (r.error as { code?: number }).code === -32700)).toBe(true);
  });
});

afterAll(() => {
  // temp dir left for OS cleanup; keeping it avoids racing async writes from export_png
});
