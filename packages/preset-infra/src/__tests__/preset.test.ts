import { describe, expect, it } from 'vitest';
import { Editor, resolveTokens, type NodeRecord } from '@ahmazin/core';
import {
  ACCENTS,
  InfraCanvas,
  darkInfraTheme,
  infraNodeUtils,
  installInfraPreset,
  modelToRecords,
  revealMode,
} from '../index.js';

describe('infra preset registration', () => {
  it('registers six node types + the connector edge', () => {
    const ed = new Editor();
    installInfraPreset(ed);
    for (const kind of ['service', 'db', 'cache', 'queue', 'lb', 'edge']) {
      expect(ed.nodes.has(`infra.${kind}`)).toBe(true);
    }
    expect(ed.edges.has('infra.connector')).toBe(true);
    expect(infraNodeUtils).toHaveLength(6);
  });
});

describe('darkInfraTheme tokens', () => {
  it('gives each infra type its accent color in the accent state', () => {
    const t = resolveTokens(darkInfraTheme, { state: 'accent' }, 'infra.db');
    expect(t.stroke).toBe(ACCENTS.db);
    expect(t.glow).toBe(ACCENTS.db);
  });

  it('locked forces the "?" label and a dashed border with no glow', () => {
    const t = resolveTokens(darkInfraTheme, { state: 'locked' }, 'infra.service');
    expect(t.labelOverride).toBe('?');
    expect(t.dash).toBeTruthy();
    expect(t.glow).toBeNull();
  });

  it('an evaluation overlay ring overrides the type accent', () => {
    const t = resolveTokens(darkInfraTheme, { state: 'accent', overlay: 'missed' }, 'infra.cache');
    expect(t.stroke).toBe('#ef4444');
  });
});

describe('modelToRecords', () => {
  it('maps friendly specs to records and wires edges by key', () => {
    const records = modelToRecords({
      nodes: [
        { key: 'a', type: 'service', label: 'A', x: 0, y: 0 },
        { key: 'b', type: 'db', label: 'B', x: 200, y: 0 },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });
    const nodes = records.filter((r) => r.typeName === 'node') as NodeRecord[];
    const edges = records.filter((r) => r.typeName === 'edge');
    expect(nodes.map((n) => n.type)).toEqual(['infra.service', 'infra.db']);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.type).toBe('infra.connector');
  });

  it('drops edges whose endpoints do not resolve', () => {
    const records = modelToRecords({
      nodes: [{ key: 'a', type: 'service', x: 0, y: 0 }],
      edges: [{ from: 'a', to: 'missing' }],
    });
    expect(records.filter((r) => r.typeName === 'edge')).toHaveLength(0);
  });
});

describe('InfraCanvas facade', () => {
  it('loads a model into a fully indexed, renderable scene', () => {
    const handle = InfraCanvas({
      model: {
        nodes: [
          { key: 'a', type: 'service', label: 'A', x: 0, y: 0 },
          { key: 'b', type: 'db', label: 'B', x: 300, y: 0 },
        ],
        edges: [{ from: 'a', to: 'b' }],
      },
    });
    expect(handle.editor.store.nodes()).toHaveLength(2);
    expect(handle.editor.sceneIndex.all()).toHaveLength(3); // 2 nodes + 1 edge
    const json = handle.editor.toJSON();
    expect(json.document.records.length).toBe(3);
  });
});

describe('arena modes', () => {
  it('stages (Evolution) loads the next snapshot and ghosts the previous one', () => {
    const h = InfraCanvas({
      model: {
        nodes: [
          { key: 'a', type: 'service', label: 'A', x: 0, y: 0 },
          { key: 'b', type: 'db', label: 'B', x: 200, y: 0 },
        ],
        edges: [{ from: 'a', to: 'b' }],
      },
      mode: 'stages',
    });
    expect(h.advance).toBeTypeOf('function');
    // advance to a stage where B is gone
    h.advance!(modelToRecords({ nodes: [{ key: 'a', type: 'service', label: 'A', x: 0, y: 0 }] }));
    expect(h.editor.store.nodes()).toHaveLength(1);
    expect(h.editor.overlaysAtom.peek().length).toBeGreaterThan(0); // ghost overlay for removed B
  });
});

describe('reveal mode', () => {
  it('locks keyed nodes until unlocked', () => {
    const ed = new Editor();
    installInfraPreset(ed);
    ed.loadSnapshot({
      schemaVersion: 1,
      document: {
        records: modelToRecords({
          nodes: [{ key: 'secret', type: 'db', label: 'Hidden', x: 0, y: 0, state: 'accent' }],
        }),
      },
    });
    const controller = revealMode(ed, []);
    expect((ed.store.nodes()[0] as NodeRecord).visual.state).toBe('locked');
    controller.unlock('secret');
    expect((ed.store.nodes()[0] as NodeRecord).visual.state).toBe('accent');
  });
});

// E3 rotation-capability audit conclusion for the infra preset: the six symbol-forward stencil nodes
// are upright by design (an infra diagram reads by icon; a rotated server/db glyph is never wanted), so
// none opt into rotation. That matches core's capabilitiesOf default (canRotate:false) — no explicit
// declaration needed. This guard locks the decision.
describe('rotation capability (E3 audit)', () => {
  it('no infra stencil node opts into rotation', () => {
    for (const util of infraNodeUtils) {
      expect(util.capabilities?.canRotate).not.toBe(true);
    }
  });
});
