import { describe, expect, it } from 'vitest';
import { Registry, validateNodeUtil, validateEdgeUtil, type NodeUtil, type EdgeUtil } from './index.js';

const baseNode: NodeUtil = {
  type: 'demo',
  getDefaultProps: () => ({}),
  getGeometry: () => ({}) as never,
  draw: () => {},
};
const baseEdge: EdgeUtil = { type: 'demo-edge', getRoute: () => [], draw: () => {} };

describe('migration registration validation', () => {
  it('accepts a node util with an array of migration functions', () => {
    expect(() => validateNodeUtil({ ...baseNode, migrations: [(p) => p, (p) => p] })).not.toThrow();
  });
  it('accepts a util with no migrations field', () => {
    expect(() => validateNodeUtil(baseNode)).not.toThrow();
  });
  it('rejects migrations that is not an array', () => {
    expect(() => validateNodeUtil({ ...baseNode, migrations: 'nope' as never })).toThrow(/migrations/);
  });
  it('rejects an array whose entries are not all functions', () => {
    expect(() => validateNodeUtil({ ...baseNode, migrations: [(p) => p, 3 as never] })).toThrow(/migrations/);
  });
  it('validates edge util migrations the same way, and Registry.register enforces it', () => {
    const edges = new Registry<EdgeUtil>({ label: 'edge type', validate: validateEdgeUtil });
    expect(() => edges.register({ ...baseEdge, migrations: [1 as never] })).toThrow(/migrations/);
    expect(() => edges.register({ ...baseEdge, migrations: [(p) => p] })).not.toThrow();
  });
});
