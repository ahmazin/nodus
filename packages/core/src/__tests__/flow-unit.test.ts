/** The flow-rate unit label (FlowSpec.unit): parses from human input, rides resolveFlow untouched,
 *  shows on the pill text, and round-trips the canonical file format byte-stably. */
import { describe, expect, it } from 'vitest';
import {
  Editor,
  formatRateWithUnit,
  parseRate,
  resolveFlow,
  restore,
  serializeRecords,
  toCanonicalString,
  type EdgeRecord,
  type FlowSpec,
} from '../index.js';

describe('FlowSpec.unit', () => {
  it('rides resolveFlow untouched (display-only, never affects the scale mapping)', () => {
    const flow: FlowSpec = {
      unit: 'req/s',
      data: 500,
      scale: { domain: [0, 1000], speed: [10, 100] },
    };
    const resolved = resolveFlow(flow);
    expect(resolved.unit).toBe('req/s');
    expect(resolved.speed).toBeCloseTo(55); // mapping driven by the value alone
  });

  it('parses from the human form and formats back for the pill', () => {
    const parsed = parseRate('1.2k req/s');
    expect(parsed).toEqual({ value: 1200, unit: 'req/s' });
    expect(formatRateWithUnit(parsed!.value, parsed!.unit)).toBe('1.2k req/s');
  });

  it('round-trips the canonical file format byte-stably', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const b = ed.createNode({ type: 'rect', x: 200, y: 0 });
    const e = ed.connect({ kind: 'node', nodeId: a }, { kind: 'node', nodeId: b });
    ed.setFlow([e], { style: 'dots', data: 350, unit: 'req/s' });

    const bytes1 = toCanonicalString(ed.toJSON());
    const restored = restore(JSON.parse(bytes1));
    const edge = restored.records.find((r) => r.typeName === 'edge') as EdgeRecord;
    expect(edge.flow?.unit).toBe('req/s');
    expect(edge.flow?.data).toBe(350);

    const bytes2 = toCanonicalString(serializeRecords(restored.records));
    expect(bytes2).toBe(bytes1); // clean fixed point — the unit never churns the bytes
    ed.dispose();
  });
});
