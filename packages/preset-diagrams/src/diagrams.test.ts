import { describe, expect, it } from 'vitest';
import { Editor } from '@nodus-dev/core';
import { buildERD, buildFlowchart, buildOrgChart, buildStateMachine, diagramNodeUtils, imageNode, installDiagrams } from '@nodus-dev/preset-diagrams';

function load(recs: ReturnType<typeof buildFlowchart>): Editor {
  const ed = new Editor();
  installDiagrams(ed);
  ed.loadSnapshot({ schemaVersion: 1, document: { records: recs } });
  return ed;
}

describe('preset-diagrams builders', () => {
  it('registers all diagram types', () => {
    const ed = new Editor();
    installDiagrams(ed);
    for (const t of ['pill', 'process', 'decision', 'state', 'table', 'card']) expect(ed.nodes.has(t)).toBe(true);
    expect(ed.edges.has('flow')).toBe(true);
  });

  it('flowchart: steps + links become a fully indexed scene', () => {
    const ed = load(
      buildFlowchart({
        steps: [
          { id: 'a', kind: 'start', label: 'Start' },
          { id: 'b', kind: 'decision', label: 'OK?' },
          { id: 'c', kind: 'process', label: 'Handle' },
          { id: 'd', kind: 'end', label: 'End' },
        ],
        links: [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'c', label: 'yes' },
          { from: 'c', to: 'd' },
        ],
      }),
    );
    expect(ed.store.nodes()).toHaveLength(4);
    expect(ed.store.edges()).toHaveLength(3);
    expect(ed.sceneIndex.all()).toHaveLength(7);
    expect(ed.store.nodes().find((n) => n.label === 'OK?')!.type).toBe('decision');
  });

  it('state machine, ERD, and org chart build valid records', () => {
    const sm = buildStateMachine({ states: [{ id: 'i', label: 'idle', initial: true }, { id: 'l', label: 'load' }], transitions: [{ from: 'i', to: 'l', label: 'GO' }] });
    expect(sm.filter((r) => r.typeName === 'node')).toHaveLength(2);
    expect(sm.filter((r) => r.typeName === 'edge')).toHaveLength(1);

    const erd = buildERD({ tables: [{ id: 'u', name: 'users', columns: ['id', 'email'] }, { id: 'o', name: 'orders', columns: ['id', 'user_id'] }], relations: [{ from: 'u', to: 'o' }] });
    const table = erd.find((r) => r.typeName === 'node')!;
    expect(table.typeName === 'node' && table.type).toBe('table');
    expect(erd.filter((r) => r.typeName === 'edge')).toHaveLength(1);

    const org = buildOrgChart({ people: [{ id: 'ceo', label: 'CEO' }, { id: 'cto', label: 'CTO', reportsTo: 'ceo' }, { id: 'eng', label: 'Eng', reportsTo: 'cto' }] });
    expect(org.filter((r) => r.typeName === 'node')).toHaveLength(3);
    expect(org.filter((r) => r.typeName === 'edge')).toHaveLength(2);
  });
});

// E3 rotation-capability audit conclusion for this preset: rotation is OPT-IN here — only the media
// node (`diagram.image`) declares canRotate:true. The structured shapes (flowchart/ERD/org/state/icon)
// stay non-rotatable by intent, which is exactly what core's capabilitiesOf default (false) gives them,
// so no explicit declaration is added. This guard locks that decision against accidental drift.
describe('rotation capability (E3 audit)', () => {
  it('the image media node opts into rotation', () => {
    expect(imageNode.capabilities?.canRotate).toBe(true);
  });

  it('structured diagram shapes do NOT opt into rotation (non-rotatable is the intended default)', () => {
    for (const util of diagramNodeUtils) {
      if (util.type === 'diagram.image') continue;
      expect(util.capabilities?.canRotate).not.toBe(true);
    }
  });
});
