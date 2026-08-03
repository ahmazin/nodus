import { describe, expect, it } from 'vitest';
import { Editor, isNodusError, type EdgeRecord } from '@nodus-dev/core';
import { installInfraPreset } from '@nodus-dev/preset-infra';
import { analyzeSpec, DiagramSpecError, diagramSystemPrompt, diagramTool, MAX_SPEC_ELEMENTS, normalizeSpec, recordsFromSpec, recordsFromToolUse, type DiagramSpec } from '@nodus-dev/text-to-diagram';

describe('text-to-diagram', () => {
  it('exposes a valid Anthropic tool definition + system prompt', () => {
    expect(diagramTool.name).toBe('render_diagram');
    expect(diagramTool.input_schema.required).toContain('nodes');
    expect(diagramTool.input_schema.properties.nodes.items.properties.type.enum).toContain('db');
    expect(diagramSystemPrompt).toMatch(/render_diagram/);
  });

  it('converts an LLM tool call into a renderable infra diagram', () => {
    // simulate what Claude would return from a tool_use block
    const toolUse = {
      name: 'render_diagram',
      input: {
        nodes: [
          { id: 'gw', type: 'edge', label: 'API Gateway' },
          { id: 'svc', type: 'service', label: 'Orders' },
          { id: 'pg', type: 'db', label: 'Postgres' },
          { id: 'bad', type: 'nonsense', label: 'Fallback' },
        ],
        edges: [
          { from: 'gw', to: 'svc', label: 'https' },
          { from: 'svc', to: 'pg', label: 'sql' },
          { from: 'svc', to: 'ghost' }, // dangling -> dropped
        ],
      },
    };
    const records = recordsFromToolUse(toolUse);
    const ed = new Editor();
    installInfraPreset(ed);
    ed.loadSnapshot({ schemaVersion: 1, document: { records } });

    expect(ed.store.nodes()).toHaveLength(4);
    expect(ed.store.edges()).toHaveLength(2); // dangling edge dropped
    // unknown type fell back to a service
    expect(ed.store.nodes().find((n) => n.label === 'Fallback')!.type).toBe('infra.service');
    // edge labels survived
    const labels = ed.store.edges().map((e: EdgeRecord) => e.label).sort();
    expect(labels).toEqual(['https', 'sql']);
    // everything is indexed/renderable
    expect(ed.sceneIndex.all()).toHaveLength(6);
  });

  it('recordsFromSpec is stable without edges', () => {
    const recs = recordsFromSpec({ nodes: [{ id: 'a', type: 'cache', label: 'Redis' }] });
    expect(recs).toHaveLength(1);
  });

  // `normalizeSpec`/`recordsFrom*` are a TRUST BOUNDARY over untrusted LLM/tool output.
  describe('hardening (trust boundary)', () => {
    it('throws a structured DiagramSpecError for a malformed spec instead of a raw TypeError', () => {
      const bad = (v: unknown) => () => normalizeSpec(v as DiagramSpec);
      expect(bad({})).toThrow(DiagramSpecError); // missing nodes
      expect(bad({ nodes: 'oops' })).toThrow(DiagramSpecError); // nodes not an array
      expect(bad(null)).toThrow(DiagramSpecError); // null spec
      // ...and via the tool-use entry point
      expect(() => recordsFromToolUse({ name: 'render_diagram', input: {} })).toThrow(DiagramSpecError);
    });

    it('skips non-object node entries instead of emitting garbage records', () => {
      const spec = { nodes: ['justastring', 42, null, { id: 'ok', type: 'db', label: 'OK' }] } as unknown as DiagramSpec;
      const clean = normalizeSpec(spec);
      expect(clean.nodes).toHaveLength(1); // only the one real object survives
      expect(clean.nodes[0]!.id).toBe('ok');
      expect(recordsFromSpec(spec).filter((r) => r.typeName === 'node')).toHaveLength(1);
    });
  });

  describe('element cap (audit M2)', () => {
    it('rejects a spec whose node count exceeds the cap', () => {
      const nodes = Array.from({ length: MAX_SPEC_ELEMENTS + 1 }, (_, i) => ({ id: `n${i}` }));
      expect(() => normalizeSpec({ nodes } as DiagramSpec)).toThrow(DiagramSpecError);
    });

    it('accepts an ordinary spec', () => {
      const spec = { nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ from: 'a', to: 'b' }] } as DiagramSpec;
      expect(normalizeSpec(spec).nodes).toHaveLength(2);
    });
  });

  // F34 — the shared importer error convention: DiagramSpecError is a coded NodusError, the tool-use
  // boundary no longer throws a bare Error, and dropped/coerced elements surface as typed issues.
  describe('error convention (F34)', () => {
    const thrown = (fn: () => unknown): unknown => {
      try {
        fn();
      } catch (e) {
        return e;
      }
      throw new Error('expected the call to throw, but it returned');
    };

    it('a malformed spec throws a coded NodusError (invalid-spec)', () => {
      const e = thrown(() => normalizeSpec(null as unknown as DiagramSpec));
      expect(e).toBeInstanceOf(DiagramSpecError);
      expect(isNodusError(e)).toBe(true);
      expect((e as { code: string }).code).toBe('text-to-diagram/invalid-spec');
    });

    it('the element cap uses a distinct spec-too-large code', () => {
      const nodes = Array.from({ length: MAX_SPEC_ELEMENTS + 1 }, (_, i) => ({ id: `n${i}` }));
      const e = thrown(() => normalizeSpec({ nodes } as DiagramSpec));
      expect((e as { code: string }).code).toBe('text-to-diagram/spec-too-large');
    });

    it('recordsFromToolUse throws a coded NodusError (not a bare Error) on the wrong tool name', () => {
      const e = thrown(() => recordsFromToolUse({ name: 'not_render', input: {} }));
      expect(isNodusError(e)).toBe(true);
      expect((e as { code: string }).code).toBe('text-to-diagram/invalid-spec');
    });

    it('analyzeSpec surfaces typed issues for dropped/coerced elements instead of losing them silently', () => {
      const spec = {
        nodes: ['junk', { id: 'ok', type: 'db', label: 'OK' }, { id: 'svc', type: 'nonsense', label: 'S' }],
        edges: [{ from: 'ok', to: 'ghost' }],
      } as unknown as DiagramSpec;
      const { records, issues } = analyzeSpec(spec);
      // records match recordsFromSpec's existing behavior (2 valid nodes; ghost edge dropped)
      expect(records.filter((r) => r.typeName === 'node')).toHaveLength(2);
      expect(records.filter((r) => r.typeName === 'edge')).toHaveLength(0);
      expect(issues.map((i) => i.code).sort()).toEqual(['coerced-type', 'dropped-edge', 'dropped-node']);
      expect(issues.find((i) => i.code === 'coerced-type')!.ref).toBe('svc');
      expect(issues.find((i) => i.code === 'dropped-edge')!.ref).toBe('ok→ghost');
    });

    it('a clean spec yields zero issues (regression guard)', () => {
      expect(analyzeSpec({ nodes: [{ id: 'a', type: 'db', label: 'A' }] }).issues).toEqual([]);
    });
  });
});
