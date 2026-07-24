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
  it('accepts a node util with an array of { id, migrate } steps', () => {
    expect(() =>
      validateNodeUtil({
        ...baseNode,
        migrations: [
          { id: 'a', migrate: (p) => p },
          { id: 'b', migrate: (p) => p },
        ],
      }),
    ).not.toThrow();
  });
  it('accepts a util with no migrations field', () => {
    expect(() => validateNodeUtil(baseNode)).not.toThrow();
  });
  it('rejects migrations that is not an array', () => {
    expect(() => validateNodeUtil({ ...baseNode, migrations: 'nope' as never })).toThrow(/migrations/);
  });
  it('rejects an array whose entries are not { id, migrate } steps', () => {
    expect(() => validateNodeUtil({ ...baseNode, migrations: [{ id: 'a', migrate: (p) => p }, 3 as never] })).toThrow(
      /migrations/,
    );
  });
  it('rejects duplicate step ids within a type', () => {
    expect(() =>
      validateNodeUtil({
        ...baseNode,
        migrations: [
          { id: 'dup', migrate: (p) => p },
          { id: 'dup', migrate: (p) => p },
        ],
      }),
    ).toThrow(/duplicate migration id/);
  });
  it('validates edge util migrations the same way, and Registry.register enforces it', () => {
    const edges = new Registry<EdgeUtil>({ label: 'edge type', validate: validateEdgeUtil });
    expect(() => edges.register({ ...baseEdge, migrations: [1 as never] })).toThrow(/migrations/);
    expect(() => edges.register({ ...baseEdge, migrations: [{ id: 'x', migrate: (p) => p }] })).not.toThrow();
  });
});

describe('migrations are append-only across re-registration', () => {
  const mk = (ids: string[]): NodeUtil => ({
    ...baseNode,
    migrations: ids.map((id) => ({ id, migrate: (p) => p })),
  });

  it('allows appending a new step (prior ids stay a prefix)', () => {
    const reg = new Registry<NodeUtil>({ label: 'node type', validate: validateNodeUtil });
    reg.register(mk(['a']));
    expect(() => reg.register(mk(['a', 'b']))).not.toThrow(); // appended 'b'
    expect(() => reg.register(mk(['a', 'b', 'c']))).not.toThrow();
  });

  it('rejects reordering an existing step', () => {
    const reg = new Registry<NodeUtil>({ label: 'node type', validate: validateNodeUtil });
    reg.register(mk(['a', 'b']));
    expect(() => reg.register(mk(['b', 'a']))).toThrow(/append-only/);
  });

  it('rejects inserting a step before an existing one (changes step index)', () => {
    const reg = new Registry<NodeUtil>({ label: 'node type', validate: validateNodeUtil });
    reg.register(mk(['a', 'b']));
    expect(() => reg.register(mk(['a', 'x', 'b']))).toThrow(/append-only/);
  });

  it('rejects renaming an existing step', () => {
    const reg = new Registry<NodeUtil>({ label: 'node type', validate: validateNodeUtil });
    reg.register(mk(['a', 'b']));
    expect(() => reg.register(mk(['a', 'renamed']))).toThrow(/append-only/);
  });
});
