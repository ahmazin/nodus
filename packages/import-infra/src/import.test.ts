import { describe, expect, it } from 'vitest';
import { Editor, type EdgeRecord, type NodeRecord } from '@nodus/core';
import { installInfraPreset } from '@nodus/preset-infra';
import { analyzeTerraform, fromKubernetes, fromTerraform, kubernetesKind, terraformKind } from '@nodus/import-infra';

describe('terraform import', () => {
  it('maps resource types to infra kinds', () => {
    expect(terraformKind('aws_dynamodb_table')).toBe('db');
    expect(terraformKind('aws_elasticache_cluster')).toBe('cache');
    expect(terraformKind('aws_sqs_queue')).toBe('queue');
    expect(terraformKind('aws_lb')).toBe('lb');
    expect(terraformKind('aws_cloudfront_distribution')).toBe('edge');
    expect(terraformKind('aws_lambda_function')).toBe('service');
  });

  it('builds a diagram from terraform show -json (resources + depends_on)', () => {
    const show = {
      values: {
        root_module: {
          resources: [
            { address: 'aws_cloudfront_distribution.cdn', type: 'aws_cloudfront_distribution', name: 'cdn', depends_on: [] },
            { address: 'aws_lambda_function.api', type: 'aws_lambda_function', name: 'api', depends_on: ['aws_cloudfront_distribution.cdn'] },
            { address: 'aws_dynamodb_table.orders', type: 'aws_dynamodb_table', name: 'orders', depends_on: ['aws_lambda_function.api'] },
          ],
        },
      },
    };
    const records = fromTerraform(show);
    const ed = new Editor();
    installInfraPreset(ed);
    ed.loadSnapshot({ schemaVersion: 1, document: { records } });
    expect(ed.store.nodes()).toHaveLength(3);
    expect(ed.store.edges()).toHaveLength(2);
    expect(ed.store.nodes().find((n: NodeRecord) => n.label === 'orders')!.type).toBe('infra.db');
  });

  // A `terraform show -json` PLAN: nodes come from planned_values, edges from configuration references.
  const PLAN = {
    format_version: '1.2',
    planned_values: {
      root_module: {
        resources: [
          { address: 'aws_vpc.main', type: 'aws_vpc', name: 'main' },
          { address: 'aws_subnet.main', type: 'aws_subnet', name: 'main' },
          { address: 'aws_instance.web', type: 'aws_instance', name: 'web' },
          { address: 'aws_db_instance.orders', type: 'aws_db_instance', name: 'orders' },
        ],
      },
    },
    configuration: {
      root_module: {
        resources: [
          { address: 'aws_vpc.main', type: 'aws_vpc', name: 'main', expressions: { cidr_block: { constant_value: '10.0.0.0/16' } } },
          { address: 'aws_subnet.main', type: 'aws_subnet', name: 'main', expressions: { vpc_id: { references: ['aws_vpc.main.id', 'aws_vpc.main'] } } },
          {
            address: 'aws_instance.web', type: 'aws_instance', name: 'web',
            expressions: {
              // nested block reference must be found by the recursive walker
              network_interface: [{ subnet_id: { references: ['aws_subnet.main.id', 'aws_subnet.main'] } }],
              ami: { references: ['data.aws_ami.ubuntu.id', 'data.aws_ami.ubuntu'] }, // data.* → ignored
              key_name: { references: ['var.key_name'] },                             // var.* → ignored
            },
          },
          { address: 'aws_db_instance.orders', type: 'aws_db_instance', name: 'orders', expressions: { vpc_security_group_ids: { references: ['aws_instance.web.id'] } } },
        ],
      },
    },
  };

  it('infers edges from implicit configuration references (not just depends_on)', () => {
    const { records, notes } = analyzeTerraform(PLAN);
    const ed = new Editor();
    installInfraPreset(ed);
    ed.loadSnapshot({ schemaVersion: 1, document: { records } });
    expect(ed.store.nodes()).toHaveLength(4);
    // vpc→subnet, subnet→web, web→orders. data.* and var.* references create NO edges.
    expect(ed.store.edges()).toHaveLength(3);
    expect(notes).toHaveLength(0); // configuration present → no "state only" note
  });

  it('directs each inferred edge from the dependency to the dependent (subnet -> web, never web -> subnet)', () => {
    const { records } = analyzeTerraform(PLAN);
    const ed = new Editor();
    installInfraPreset(ed);
    ed.loadSnapshot({ schemaVersion: 1, document: { records } });
    const labelOf = new Map(ed.store.nodes().map((n: NodeRecord) => [n.id, n.label]));
    const web = ed.store.nodes().find((n: NodeRecord) => n.label === 'web')!;
    // aws_instance.web's network_interface references aws_subnet.main, so exactly one edge lands on `web`.
    const edgeIntoWeb = (ed.store.edges() as EdgeRecord[]).find(
      (e) => e.to.kind === 'node' && e.to.nodeId === web.id,
    );
    expect(edgeIntoWeb).toBeDefined();
    const from = edgeIntoWeb!.from;
    if (from.kind !== 'node') throw new Error('expected a node-bound endpoint');
    // subnet is the dependency web references, so it must be the edge's SOURCE (from), landing at web (to).
    expect(labelOf.get(from.nodeId)).toBe('main');
  });

  it('unions references with depends_on and de-dups', () => {
    const withDep = structuredClone(PLAN) as typeof PLAN & { planned_values: { root_module: { resources: Array<{ depends_on?: string[] }> } } };
    // orders already gets web→orders via a reference; add the SAME edge via depends_on — must not double.
    (withDep.planned_values.root_module.resources[3] as { depends_on?: string[] }).depends_on = ['aws_instance.web'];
    const { records } = analyzeTerraform(withDep);
    const ed = new Editor();
    installInfraPreset(ed);
    ed.loadSnapshot({ schemaVersion: 1, document: { records } });
    expect(ed.store.edges()).toHaveLength(3); // still 3, not 4
  });

  it('notes that state-only JSON (no configuration) limits edges to depends_on', () => {
    const stateOnly = { values: { root_module: { resources: [
      { address: 'aws_instance.web', type: 'aws_instance', name: 'web' },
      { address: 'aws_db_instance.orders', type: 'aws_db_instance', name: 'orders', depends_on: ['aws_instance.web'] },
    ] } } };
    const { records, notes } = analyzeTerraform(stateOnly);
    const ed = new Editor();
    installInfraPreset(ed);
    ed.loadSnapshot({ schemaVersion: 1, document: { records } });
    expect(ed.store.edges()).toHaveLength(1);
    expect(notes.join(' ')).toMatch(/state JSON/i);
  });

  it('resolves references inside a child module', () => {
    const modPlan = {
      planned_values: { root_module: { child_modules: [{
        address: 'module.data',
        resources: [
          { address: 'module.data.aws_subnet.db', type: 'aws_subnet', name: 'db' },
          { address: 'module.data.aws_db_instance.main', type: 'aws_db_instance', name: 'main' },
        ],
      }] } },
      configuration: { root_module: { module_calls: { data: { module: { resources: [
        { address: 'aws_subnet.db', type: 'aws_subnet', name: 'db', expressions: {} },
        { address: 'aws_db_instance.main', type: 'aws_db_instance', name: 'main', expressions: { subnet_id: { references: ['aws_subnet.db.id', 'aws_subnet.db'] } } },
      ] } } } } },
    };
    const { records } = analyzeTerraform(modPlan);
    const ed = new Editor();
    installInfraPreset(ed);
    ed.loadSnapshot({ schemaVersion: 1, document: { records } });
    expect(ed.store.nodes()).toHaveLength(2);
    expect(ed.store.edges()).toHaveLength(1); // module.data.aws_subnet.db → module.data.aws_db_instance.main
  });
});

describe('kubernetes import', () => {
  it('maps kinds and infers Ingress->Service->workload edges', () => {
    expect(kubernetesKind('StatefulSet')).toBe('db');
    expect(kubernetesKind('Ingress')).toBe('edge');
    expect(kubernetesKind('ConfigMap')).toBeNull();

    const objects = [
      { kind: 'Ingress', metadata: { name: 'web' }, spec: { rules: [{ http: { paths: [{ backend: { service: { name: 'orders-svc' } } }] } }] } },
      { kind: 'Service', metadata: { name: 'orders-svc' }, spec: { selector: { app: 'orders' } } },
      { kind: 'Deployment', metadata: { name: 'orders' }, spec: { template: { metadata: { labels: { app: 'orders' } } } } },
      { kind: 'StatefulSet', metadata: { name: 'pg', labels: { app: 'pg' } }, spec: {} },
      { kind: 'ConfigMap', metadata: { name: 'cfg' } },
    ];
    const records = fromKubernetes(objects);
    const ed = new Editor();
    installInfraPreset(ed);
    ed.loadSnapshot({ schemaVersion: 1, document: { records } });
    expect(ed.store.nodes()).toHaveLength(4); // ConfigMap skipped
    // Ingress web -> Service orders-svc, Service orders-svc -> Deployment orders
    expect(ed.store.edges().length).toBeGreaterThanOrEqual(2);
  });
});
