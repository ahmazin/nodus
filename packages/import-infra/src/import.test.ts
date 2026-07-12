import { describe, expect, it } from 'vitest';
import { Editor, type NodeRecord } from '@nodus/core';
import { installInfraPreset } from '@nodus/preset-infra';
import { fromKubernetes, fromTerraform, kubernetesKind, terraformKind } from '@nodus/import-infra';

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
