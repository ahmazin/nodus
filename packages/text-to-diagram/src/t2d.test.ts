import { describe, expect, it } from 'vitest';
import { Editor, type EdgeRecord } from '@nodus/core';
import { installInfraPreset } from '@nodus/preset-infra';
import { diagramSystemPrompt, diagramTool, recordsFromSpec, recordsFromToolUse } from '@nodus/text-to-diagram';

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
});
