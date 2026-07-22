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
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

/**
 * A structured, catchable error for a malformed diagram spec. `recordsFromSpec`/`recordsFromToolUse`
 * are a trust boundary — the spec is untrusted LLM/tool output — so an invalid payload surfaces as a
 * `DiagramSpecError` with a clean message instead of a raw `TypeError` from destructuring undefined.
 */
export class DiagramSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiagramSpecError';
  }
}

/**
 * Element ceiling on a diagram spec, enforced before normalization (pre-publication audit M2). Specs
 * arrive from a model's tool call or a hand-crafted payload; a cap keeps a pathological one from
 * building an unbounded record set on the main thread. Far above any real generated diagram.
 */
export const MAX_SPEC_ELEMENTS = 10_000;

/** Validate + normalize an LLM `DiagramSpec` (unknown types fall back to `service`). */
export function normalizeSpec(spec: DiagramSpec): DiagramSpec {
  const nodes = isObject(spec) ? spec.nodes : undefined;
  if (!Array.isArray(nodes)) {
    throw new DiagramSpecError('Diagram spec must be an object with a `nodes` array.');
  }
  const rawEdgeCount = isObject(spec) && Array.isArray(spec.edges) ? spec.edges.length : 0;
  if (nodes.length > MAX_SPEC_ELEMENTS || rawEdgeCount > MAX_SPEC_ELEMENTS) {
    throw new DiagramSpecError(`Diagram spec too large (${nodes.length} nodes / ${rawEdgeCount} edges > ${MAX_SPEC_ELEMENTS} cap).`);
  }
  // Keep only entries that are objects with a string id — otherwise a non-object node (a bare string
  // or number from a malformed payload) would silently become a stray "service" record.
  const validNodes = (nodes as unknown[]).filter(
    (n): n is DiagramSpec['nodes'][number] => isObject(n) && typeof n.id === 'string',
  );
  const ids = new Set(validNodes.map((n) => n.id));
  const rawEdges = isObject(spec) ? spec.edges : undefined;
  const edges = (Array.isArray(rawEdges) ? (rawEdges as unknown[]) : []).filter(
    (e): e is NonNullable<DiagramSpec['edges']>[number] =>
      isObject(e) && typeof e.from === 'string' && typeof e.to === 'string' && ids.has(e.from) && ids.has(e.to),
  );
  return {
    nodes: validNodes.map((n) => ({ ...n, type: isKind(n.type) ? n.type : 'service' })),
    edges,
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
