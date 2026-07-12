/**
 * @nodus/text-to-diagram — bridge an LLM to a Nodus diagram. You give the model `diagramTool` (an
 * Anthropic tool definition) + `diagramSystemPrompt`; it returns a structured `DiagramSpec`; you
 * call `recordsFromSpec` to get a renderable diagram. This package holds ZERO LLM/network code —
 * the actual model call is the host's job (keeps keys and prompts out of the library).
 */

import type { NodusRecord } from '@nodus/core';
import { modelToRecords, INFRA_TYPES, type InfraModel } from '@nodus/preset-infra';

const KINDS = INFRA_TYPES; // service | db | cache | queue | lb | edge

export interface DiagramSpec {
  nodes: Array<{
    id: string;
    type: string;
    label?: string;
    state?: 'accent' | 'solid' | 'ghost' | 'locked';
    group?: string;
  }>;
  edges?: Array<{ from: string; to: string; label?: string }>;
}

/** Anthropic-style tool definition the model calls to emit a diagram. */
export const diagramTool = {
  name: 'render_diagram',
  description:
    'Render an infrastructure/architecture diagram. Call this with the components (nodes) and their ' +
    'connections (edges). Use it exactly once with the full diagram.',
  input_schema: {
    type: 'object',
    properties: {
      nodes: {
        type: 'array',
        description: 'The components in the architecture.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique id referenced by edges.' },
            type: { type: 'string', enum: [...KINDS], description: 'Component kind.' },
            label: { type: 'string', description: 'Human-readable name.' },
            group: { type: 'string', description: 'Optional group/cluster name.' },
          },
          required: ['id', 'type', 'label'],
        },
      },
      edges: {
        type: 'array',
        description: 'Directed connections between nodes (data/request flow).',
        items: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            label: { type: 'string' },
          },
          required: ['from', 'to'],
        },
      },
    },
    required: ['nodes'],
  },
} as const;

export const diagramSystemPrompt =
  'You are an architecture diagramming assistant. Given a description of a system, call the ' +
  'render_diagram tool with the components as nodes and their connections as edges. Node `type` must ' +
  `be one of: ${KINDS.join(', ')}. Prefer edge labels that name the protocol or data (e.g. "gRPC", ` +
  '"reads"). Keep ids short and stable. Return the full diagram in a single tool call.';

const isKind = (t: string): boolean => (KINDS as readonly string[]).includes(t);

/** Validate + normalize an LLM `DiagramSpec` (unknown types fall back to `service`). */
export function normalizeSpec(spec: DiagramSpec): DiagramSpec {
  const ids = new Set(spec.nodes.map((n) => n.id));
  return {
    nodes: spec.nodes.map((n) => ({ ...n, type: isKind(n.type) ? n.type : 'service' })),
    edges: (spec.edges ?? []).filter((e) => ids.has(e.from) && ids.has(e.to)),
  };
}

/** Convert a (possibly raw) LLM diagram spec into Nodus records via the infra preset. */
export function recordsFromSpec(spec: DiagramSpec): NodusRecord[] {
  const clean = normalizeSpec(spec);
  const model: InfraModel = {
    nodes: clean.nodes.map((n) => ({
      key: n.id,
      type: n.type,
      label: n.label ?? n.id,
      x: 0,
      y: 0,
      ...(n.state ? { state: n.state } : {}),
    })),
    edges: (clean.edges ?? []).map((e) => ({ from: e.from, to: e.to, ...(e.label ? {} : {}) })),
  };
  // attach edge labels (InfraModel edges support `type`; labels ride on records post-build)
  const records = modelToRecords(model);
  // apply edge labels by matching order
  const specEdges = clean.edges ?? [];
  let ei = 0;
  for (const r of records) {
    if (r.typeName === 'edge') {
      const lbl = specEdges[ei]?.label;
      if (lbl) (r as { label?: string }).label = lbl;
      ei++;
    }
  }
  return records;
}

/** Extract the spec from an Anthropic tool_use content block and convert to records. */
export function recordsFromToolUse(toolUse: { name: string; input: unknown }): NodusRecord[] {
  if (toolUse.name !== diagramTool.name) throw new Error(`Unexpected tool: ${toolUse.name}`);
  return recordsFromSpec(toolUse.input as DiagramSpec);
}
