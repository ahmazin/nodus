import { describe, expect, it } from 'vitest';
import { Editor, renderSVG } from '../index.js';

function diagramWithFlow(style: 'dash' | 'dots') {
  const ed = new Editor({ viewport: { w: 400, h: 200 } });
  const a = ed.createNode({ type: 'rect', x: 20, y: 20, w: 80, h: 40 });
  const b = ed.createNode({ type: 'rect', x: 260, y: 20, w: 80, h: 40 });
  ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b });
  const eid = ed.store.edges()[0]!.id;
  ed.setFlow([eid], { style });
  return ed;
}

describe('renderSVG animateFlow', () => {
  it('emits a seamless looping dash animation for a dash flow', () => {
    const svg = renderSVG(diagramWithFlow('dash'), { animateFlow: true });
    expect(svg).toContain('class="nodus-flow"');
    expect(svg).toContain('<animate attributeName="stroke-dashoffset"');
    expect(svg).toContain('repeatCount="indefinite"');
  });

  it('emits packet dots riding the route for a dots flow', () => {
    const svg = renderSVG(diagramWithFlow('dots'), { animateFlow: true });
    expect(svg).toContain('class="nodus-flow"');
    expect(svg).toContain('<animateMotion path=');
    expect(svg).toContain('repeatCount="indefinite"');
    expect(svg).toContain('<circle');
  });

  it('omits the flow group when animateFlow is off (frozen/no flow)', () => {
    expect(renderSVG(diagramWithFlow('dash'))).not.toContain('nodus-flow');
  });

  it('emits no flow group when no edge carries a flow spec', () => {
    const ed = new Editor({ viewport: { w: 200, h: 200 } });
    ed.createNode({ type: 'rect', x: 10, y: 10, w: 50, h: 30 });
    expect(renderSVG(ed, { animateFlow: true })).not.toContain('nodus-flow');
  });

  it('is deterministic (same scene → same animated SVG)', () => {
    const a = renderSVG(diagramWithFlow('dots'), { animateFlow: true });
    const b = renderSVG(diagramWithFlow('dots'), { animateFlow: true });
    expect(a).toBe(b);
  });
});
