/**
 * Observable unknown types at the scene-index layer (task A8): a record whose `type` isn't registered
 * warns ONCE per type per document build (deduped, cleared on rebuild), and is dropped unless an
 * unknownNodeUtil placeholder is supplied — in which case it builds + hit-tests. Each `it` fails on the
 * pre-change index (silent drop, no warning).
 */
import { describe, expect, it } from 'vitest';
import { SceneIndex, type SceneIndexErrorContext } from './index.js';
import { Registry, type NodeUtil, type EdgeUtil } from '../registries/index.js';
import { unknownNodeUtil } from '../builtins/index.js';
import type { Id, NodeRecord } from '../model.js';

function mkNode(id: string, type: string, box = { x: 0, y: 0, w: 10, h: 10 }): NodeRecord {
  return { id: id as Id<'node'>, typeName: 'node', version: 0, type, ...box, z: 'a0', visual: { state: 'solid' }, props: {} };
}
const emptyNodes = (): Registry<NodeUtil> => new Registry<NodeUtil>();
const emptyEdges = (): Registry<EdgeUtil> => new Registry<EdgeUtil>();

describe('SceneIndex — missing-util warning', () => {
  it('warns EXACTLY ONCE per unknown type per build (deduped), re-warns after a fresh rebuild', () => {
    const warnings: SceneIndexErrorContext[] = [];
    const idx = new SceneIndex({
      getRecord: () => undefined,
      nodes: emptyNodes(),
      edges: emptyEdges(),
      onError: (_e, ctx) => warnings.push(ctx),
    });
    const missing = (): SceneIndexErrorContext[] => warnings.filter((w) => w.phase === 'missing-util');

    idx.rebuild([mkNode('node:a', 'ghost'), mkNode('node:b', 'ghost'), mkNode('node:c', 'ghost')]);
    expect(missing()).toHaveLength(1); // 3 ghost nodes → a single warning
    expect(missing()[0]!.type).toBe('ghost');

    idx.rebuild([mkNode('node:a', 'ghost')]); // a fresh document clears the dedupe set → re-warn
    expect(missing()).toHaveLength(2);
  });

  it('drops an unknown-type node by default, but indexes + hit-tests it with a placeholder', () => {
    const bare = new SceneIndex({ getRecord: () => undefined, nodes: emptyNodes(), edges: emptyEdges() });
    bare.rebuild([mkNode('node:g', 'ghost', { x: 0, y: 0, w: 100, h: 50 })]);
    expect(bare.hitTest({ x: 50, y: 25 }, 4)).toBeNull(); // inert-but-preserved default: not indexed

    const withPlaceholder = new SceneIndex({
      getRecord: () => undefined,
      nodes: emptyNodes(),
      edges: emptyEdges(),
      unknownNodeUtil,
    });
    withPlaceholder.rebuild([mkNode('node:g', 'ghost', { x: 0, y: 0, w: 100, h: 50 })]);
    expect(withPlaceholder.hitTest({ x: 50, y: 25 }, 4)?.id).toBe('node:g'); // placeholder box is hit-testable
  });
});
