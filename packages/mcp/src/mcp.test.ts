import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DiagramSession, TOOLS, dispatch } from '@nodus/mcp';

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

afterAll(() => {
  // temp dir left for OS cleanup; keeping it avoids racing async writes from export_png
});
