/**
 * @nodus/text-to-diagram — bridge an LLM to a Nodus diagram. You give the model `diagramTool` (an
 * Anthropic tool definition) + `diagramSystemPrompt`; it returns a structured `DiagramSpec`; you
 * call `recordsFromSpec` to get a renderable diagram. This package holds ZERO LLM/network code —
 * the actual model call is the host's job (keeps keys and prompts out of the library).
 */

import { NodusError, type NodusRecord } from '@nodus/core';
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

/** Namespaced failure codes (F34). `invalid-spec` = the payload is not a usable diagram spec;
 *  `spec-too-large` = the element-count guard tripped. */
export type DiagramSpecErrorCode = 'text-to-diagram/invalid-spec' | 'text-to-diagram/spec-too-large';

/**
 * A structured, catchable error for a malformed diagram spec. `recordsFromSpec`/`recordsFromToolUse`
 * are a trust boundary — the spec is untrusted LLM/tool output — so an invalid payload surfaces as a
 * `DiagramSpecError` with a clean message instead of a raw `TypeError` from destructuring undefined.
 *
 * It is a {@link NodusError} subclass, so it carries a machine-readable `code` and matches
 * `isNodusError(e)` across the dual-package seam — branch on `e.code`, never `instanceof` across
 * package copies.
 */
export class DiagramSpecError extends NodusError<DiagramSpecErrorCode> {
  constructor(message: string, opts: { code?: DiagramSpecErrorCode; context?: Record<string, unknown> } = {}) {
    super(opts.code ?? 'text-to-diagram/invalid-spec', message, opts.context ? { context: opts.context } : undefined);
    this.name = 'DiagramSpecError';
  }
}

/**
 * A node or edge that was dropped or coerced during normalization — surfaced (never silent) so a host
 * can tell the user an LLM emitted something unusable (F34). `code` is stable; `ref` is the locus.
 */
export interface SpecIssue {
  code: 'dropped-node' | 'dropped-edge' | 'coerced-type';
  message: string;
  /** The offending node id or `from→to` edge, when known. */
  ref?: string;
}

/**
 * Element ceiling on a diagram spec, enforced before normalization (pre-publication audit M2). Specs
 * arrive from a model's tool call or a hand-crafted payload; a cap keeps a pathological one from
 * building an unbounded record set on the main thread. Far above any real generated diagram.
 */
export const MAX_SPEC_ELEMENTS = 10_000;

/**
 * Validate + normalize an LLM `DiagramSpec`, collecting a typed issue for anything dropped or coerced
 * (unknown types fall back to `service`). Throws `DiagramSpecError` only when the whole payload is
 * unusable (not an object with a `nodes` array, or over the element cap).
 */
function normalizeWithIssues(spec: DiagramSpec): { spec: DiagramSpec; issues: SpecIssue[] } {
  const nodes = isObject(spec) ? spec.nodes : undefined;
  if (!Array.isArray(nodes)) {
    throw new DiagramSpecError('Diagram spec must be an object with a `nodes` array.', { code: 'text-to-diagram/invalid-spec' });
  }
  const rawEdgeCount = isObject(spec) && Array.isArray(spec.edges) ? spec.edges.length : 0;
  if (nodes.length > MAX_SPEC_ELEMENTS || rawEdgeCount > MAX_SPEC_ELEMENTS) {
    throw new DiagramSpecError(`Diagram spec too large (${nodes.length} nodes / ${rawEdgeCount} edges > ${MAX_SPEC_ELEMENTS} cap).`, {
      code: 'text-to-diagram/spec-too-large',
      context: { nodes: nodes.length, edges: rawEdgeCount, cap: MAX_SPEC_ELEMENTS },
    });
  }
  const issues: SpecIssue[] = [];
  // Keep only entries that are objects with a string id — otherwise a non-object node (a bare string
  // or number from a malformed payload) would silently become a stray "service" record. Each drop is
  // recorded as an issue rather than vanishing.
  const validNodes = (nodes as unknown[]).filter((n): n is DiagramSpec['nodes'][number] => {
    const ok = isObject(n) && typeof n.id === 'string';
    if (!ok) issues.push({ code: 'dropped-node', message: 'Node entry is not an object with a string `id`.' });
    return ok;
  });
  const ids = new Set(validNodes.map((n) => n.id));
  const rawEdges = isObject(spec) ? spec.edges : undefined;
  const edges = (Array.isArray(rawEdges) ? (rawEdges as unknown[]) : []).filter((e): e is NonNullable<DiagramSpec['edges']>[number] => {
    const ok = isObject(e) && typeof e.from === 'string' && typeof e.to === 'string' && ids.has(e.from) && ids.has(e.to);
    if (!ok) {
      const ref = isObject(e) && typeof e.from === 'string' && typeof e.to === 'string' ? `${e.from}→${e.to}` : undefined;
      issues.push({ code: 'dropped-edge', message: 'Edge is malformed or references an unknown node id.', ...(ref ? { ref } : {}) });
    }
    return ok;
  });
  const outNodes = validNodes.map((n) => {
    if (!isKind(n.type)) issues.push({ code: 'coerced-type', message: `Unknown node type "${n.type}" coerced to "service".`, ref: n.id });
    return { ...n, type: isKind(n.type) ? n.type : 'service' };
  });
  return { spec: { nodes: outNodes, edges }, issues };
}

/** Validate + normalize an LLM `DiagramSpec` (unknown types fall back to `service`). */
export function normalizeSpec(spec: DiagramSpec): DiagramSpec {
  return normalizeWithIssues(spec).spec;
}

/** Build Nodus records from an already-normalized spec. */
function buildRecords(clean: DiagramSpec): NodusRecord[] {
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

export interface SpecAnalysis {
  records: NodusRecord[];
  /** Typed issues for every node/edge that was dropped or coerced (empty on a fully-clean spec). */
  issues: SpecIssue[];
}

/**
 * Convert a (possibly raw) LLM diagram spec into records AND the typed issues describing anything that
 * was dropped or coerced — so a host can warn the user rather than lose an element invisibly.
 */
export function analyzeSpec(spec: DiagramSpec): SpecAnalysis {
  const { spec: clean, issues } = normalizeWithIssues(spec);
  return { records: buildRecords(clean), issues };
}

/** Convert a (possibly raw) LLM diagram spec into Nodus records via the infra preset. */
export function recordsFromSpec(spec: DiagramSpec): NodusRecord[] {
  return analyzeSpec(spec).records;
}

/** Extract the spec from an Anthropic tool_use content block and convert to records. */
export function recordsFromToolUse(toolUse: { name: string; input: unknown }): NodusRecord[] {
  if (toolUse.name !== diagramTool.name)
    throw new DiagramSpecError(`Unexpected tool "${toolUse.name}" (expected "${diagramTool.name}").`, {
      code: 'text-to-diagram/invalid-spec',
      context: { expected: diagramTool.name, received: toolUse.name },
    });
  return recordsFromSpec(toolUse.input as DiagramSpec);
}
