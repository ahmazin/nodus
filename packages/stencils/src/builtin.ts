/**
 * Starter content shipped with the package. Everything here is authored from the core built-in
 * `rect` node type and `line` edge type, so it renders with zero extra registrations — a bare
 * `@nodus/core` editor can drop any of these fragments or open any of these templates.
 *
 * Invariants (verified in `serialize.test.ts`): every record is a valid `NodusRecord`, ids are
 * unique within their fragment/snapshot, and every edge endpoint references a node present in the
 * same set — so `restore()` keeps all of them (`droppedEdges === 0`).
 */

import type { EdgeRecord, NodeRecord } from '@nodus/core';
import type { Stencil, StencilLibrary, Template } from './types.js';

/** A minimal, valid `rect` node. `id` carries the `node:` prefix required by the branded `Id` type. */
function rect(
  id: `node:${string}`,
  x: number,
  y: number,
  w: number,
  h: number,
  label?: string,
): NodeRecord {
  return {
    id,
    typeName: 'node',
    version: 0,
    type: 'rect',
    x,
    y,
    w,
    h,
    z: 'a0',
    visual: { state: 'solid' },
    props: {},
    ...(label !== undefined ? { label } : {}),
  };
}

/** A minimal, valid `line` edge bound to two nodes' outlines (so it slides as they move). */
function edge(
  id: `edge:${string}`,
  from: `node:${string}`,
  to: `node:${string}`,
  label?: string,
): EdgeRecord {
  return {
    id,
    typeName: 'edge',
    version: 0,
    type: 'line',
    from: { kind: 'outline', nodeId: from },
    to: { kind: 'outline', nodeId: to },
    visual: { state: 'solid' },
    props: {},
    ...(label !== undefined ? { label } : {}),
  };
}

function stencil(id: string, name: string, tags: string[], records: NodeRecord[]): Stencil {
  return { id, name, tags, records };
}

/**
 * Four single-node starter stencils. A real "diamond" node type isn't guaranteed to be registered,
 * so the decision shape is a labeled `rect` like the others — the label carries the intent.
 */
export const builtinStencils: StencilLibrary = {
  name: 'Starter',
  stencils: [
    stencil('box', 'Box', ['basic'], [rect('node:box', 0, 0, 120, 60, 'Box')]),
    stencil('note', 'Note', ['basic', 'annotation'], [rect('node:note', 0, 0, 160, 90, 'Note')]),
    stencil('decision', 'Decision', ['flowchart'], [rect('node:decision', 0, 0, 140, 80, 'Decision?')]),
    stencil('terminal', 'Terminal', ['flowchart'], [rect('node:terminal', 0, 0, 120, 50, 'Start')]),
  ],
};

/** An empty document — the "start from scratch" option. */
const blank: Template = {
  id: 'blank',
  name: 'Blank',
  description: 'An empty canvas.',
  snapshot: { schemaVersion: 1, document: { records: [] } },
};

/** Web → API → Database, stacked vertically with connecting edges. */
const threeTier: Template = {
  id: 'three-tier-web',
  name: '3-Tier Web App',
  description: 'A web tier, an API tier, and a database, connected top to bottom.',
  snapshot: {
    schemaVersion: 1,
    document: {
      records: [
        rect('node:web', 40, 0, 160, 60, 'Web'),
        rect('node:api', 40, 120, 160, 60, 'API'),
        rect('node:db', 40, 240, 160, 60, 'Database'),
        edge('edge:web-api', 'node:web', 'node:api'),
        edge('edge:api-db', 'node:api', 'node:db'),
      ],
    },
  },
};

/** Source → Build → Test → Deploy, left to right, as a pipeline. */
const cicd: Template = {
  id: 'cicd-pipeline',
  name: 'CI/CD Pipeline',
  description: 'A four-stage delivery pipeline: source, build, test, deploy.',
  snapshot: {
    schemaVersion: 1,
    document: {
      records: [
        rect('node:source', 0, 0, 120, 56, 'Source'),
        rect('node:build', 180, 0, 120, 56, 'Build'),
        rect('node:test', 360, 0, 120, 56, 'Test'),
        rect('node:deploy', 540, 0, 120, 56, 'Deploy'),
        edge('edge:source-build', 'node:source', 'node:build'),
        edge('edge:build-test', 'node:build', 'node:test'),
        edge('edge:test-deploy', 'node:test', 'node:deploy'),
      ],
    },
  },
};

export const builtinTemplates: Template[] = [blank, threeTier, cicd];
