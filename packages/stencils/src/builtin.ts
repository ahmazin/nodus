/**
 * Starter content shipped with the package. Everything here is authored from the core built-in
 * `rect` node type and `line` edge type, so it renders with zero extra registrations — a bare
 * `@nodus-dev/core` editor can drop any of these fragments or open any of these templates.
 *
 * Invariants (verified in `serialize.test.ts`): every record is a valid `NodusRecord`, ids are
 * unique within their fragment/snapshot, and every edge endpoint references a node present in the
 * same set — so `restore()` keeps all of them (`droppedEdges === 0`).
 */

import type { EdgeRecord, NodeRecord } from '@nodus-dev/core';
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

/** A load balancer fanning out to three web servers that all share one database. */
const loadBalancedWeb: Template = {
  id: 'load-balanced-web',
  name: 'Load-Balanced Web',
  description: 'A load balancer spreading traffic across three web servers over a shared database.',
  snapshot: {
    schemaVersion: 1,
    document: {
      records: [
        rect('node:lb', 200, 0, 160, 60, 'Load Balancer'),
        rect('node:web1', 0, 160, 160, 60, 'Web 1'),
        rect('node:web2', 200, 160, 160, 60, 'Web 2'),
        rect('node:web3', 400, 160, 160, 60, 'Web 3'),
        rect('node:db', 200, 320, 160, 60, 'Database'),
        edge('edge:lb-web1', 'node:lb', 'node:web1'),
        edge('edge:lb-web2', 'node:lb', 'node:web2'),
        edge('edge:lb-web3', 'node:lb', 'node:web3'),
        edge('edge:web1-db', 'node:web1', 'node:db'),
        edge('edge:web2-db', 'node:web2', 'node:db'),
        edge('edge:web3-db', 'node:web3', 'node:db'),
      ],
    },
  },
};

/** An API gateway routing to three services, each backed by a shared database and cache. */
const microservices: Template = {
  id: 'microservices',
  name: 'Microservices',
  description: 'An API gateway fronting Users, Orders, and Payments services over a shared database and cache.',
  snapshot: {
    schemaVersion: 1,
    document: {
      records: [
        rect('node:gateway', 200, 0, 160, 60, 'API Gateway'),
        rect('node:users', 0, 160, 160, 60, 'Users'),
        rect('node:orders', 200, 160, 160, 60, 'Orders'),
        rect('node:payments', 400, 160, 160, 60, 'Payments'),
        rect('node:db', 0, 320, 160, 60, 'Database'),
        rect('node:cache', 400, 320, 160, 60, 'Cache'),
        edge('edge:gw-users', 'node:gateway', 'node:users'),
        edge('edge:gw-orders', 'node:gateway', 'node:orders'),
        edge('edge:gw-payments', 'node:gateway', 'node:payments'),
        edge('edge:users-db', 'node:users', 'node:db'),
        edge('edge:orders-db', 'node:orders', 'node:db'),
        edge('edge:orders-cache', 'node:orders', 'node:cache'),
        edge('edge:payments-cache', 'node:payments', 'node:cache'),
      ],
    },
  },
};

/** Client → API Gateway → Function → Datastore, with a queue fanning to a second function. */
const serverlessEvent: Template = {
  id: 'serverless-event',
  name: 'Serverless Event-Driven',
  description: 'A request path through an API gateway and function to a datastore, with a queue triggering a worker function.',
  snapshot: {
    schemaVersion: 1,
    document: {
      records: [
        rect('node:client', 0, 0, 160, 60, 'Client'),
        rect('node:gateway', 200, 0, 160, 60, 'API Gateway'),
        rect('node:fn-api', 400, 0, 160, 60, 'API Function'),
        rect('node:datastore', 600, 0, 160, 60, 'Datastore'),
        rect('node:queue', 400, 160, 160, 60, 'Queue'),
        rect('node:fn-worker', 600, 160, 160, 60, 'Worker Function'),
        edge('edge:client-gw', 'node:client', 'node:gateway'),
        edge('edge:gw-fn', 'node:gateway', 'node:fn-api'),
        edge('edge:fn-datastore', 'node:fn-api', 'node:datastore'),
        edge('edge:fn-queue', 'node:fn-api', 'node:queue'),
        edge('edge:queue-worker', 'node:queue', 'node:fn-worker'),
        edge('edge:worker-datastore', 'node:fn-worker', 'node:datastore'),
      ],
    },
  },
};

/** Ingress → Service → three Pods, with a ConfigMap and a PersistentVolume attached. */
const k8sCluster: Template = {
  id: 'k8s-cluster',
  name: 'Kubernetes Cluster',
  description: 'Ingress routing through a Service to three Pods, backed by a ConfigMap and a PersistentVolume.',
  snapshot: {
    schemaVersion: 1,
    document: {
      records: [
        rect('node:ingress', 200, 0, 160, 60, 'Ingress'),
        rect('node:service', 200, 160, 160, 60, 'Service'),
        rect('node:pod1', 0, 340, 160, 60, 'Pod A'),
        rect('node:pod2', 200, 340, 160, 60, 'Pod B'),
        rect('node:pod3', 400, 340, 160, 60, 'Pod C'),
        rect('node:configmap', 600, 160, 160, 60, 'ConfigMap'),
        rect('node:pv', 200, 500, 160, 60, 'PersistentVolume'),
        edge('edge:ingress-service', 'node:ingress', 'node:service'),
        edge('edge:service-pod1', 'node:service', 'node:pod1'),
        edge('edge:service-pod2', 'node:service', 'node:pod2'),
        edge('edge:service-pod3', 'node:service', 'node:pod3'),
        edge('edge:pod3-configmap', 'node:pod3', 'node:configmap'),
        edge('edge:pod2-pv', 'node:pod2', 'node:pv'),
      ],
    },
  },
};

/** A left-to-right ETL flow from source to dashboard, branching raw data into a data lake. */
const dataPipeline: Template = {
  id: 'data-pipeline',
  name: 'Data Pipeline',
  description: 'A source-to-dashboard ETL flow — ingest, transform, warehouse — with a branch into a data lake.',
  snapshot: {
    schemaVersion: 1,
    document: {
      records: [
        rect('node:source', 0, 0, 160, 60, 'Source'),
        rect('node:ingest', 200, 0, 160, 60, 'Ingest'),
        rect('node:transform', 400, 0, 160, 60, 'Transform'),
        rect('node:warehouse', 600, 0, 160, 60, 'Warehouse'),
        rect('node:dashboard', 800, 0, 160, 60, 'Dashboard'),
        rect('node:lake', 200, 160, 160, 60, 'Data Lake'),
        edge('edge:source-ingest', 'node:source', 'node:ingest'),
        edge('edge:ingest-transform', 'node:ingest', 'node:transform'),
        edge('edge:transform-warehouse', 'node:transform', 'node:warehouse'),
        edge('edge:warehouse-dashboard', 'node:warehouse', 'node:dashboard'),
        edge('edge:ingest-lake', 'node:ingest', 'node:lake'),
      ],
    },
  },
};

export const builtinTemplates: Template[] = [
  blank,
  threeTier,
  cicd,
  loadBalancedWeb,
  microservices,
  serverlessEvent,
  k8sCluster,
  dataPipeline,
];
