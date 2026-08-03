import { describe, expect, it } from 'vitest';
import { Editor } from '@nodus-dev/core';
import { diamondShape, drawShortcut, ellipseShape, installDrawTools, rectShape, textNode } from '@nodus-dev/preset-draw';

describe('preset-draw', () => {
  it('registers shapes, edges, and the line tool', () => {
    const ed = new Editor();
    installDrawTools(ed);
    for (const t of ['draw.rect', 'draw.ellipse', 'draw.diamond', 'draw.text']) expect(ed.nodes.has(t)).toBe(true);
    expect(ed.edges.has('draw.line')).toBe(true);
    expect(ed.edges.has('draw.arrow')).toBe(true);
    expect(ed.toolManager.has('line')).toBe(true);
  });

  it('R/E/L/A/T shortcuts switch tools + create type', () => {
    const ed = new Editor();
    installDrawTools(ed);
    expect(drawShortcut(ed, 'r')).toBe(true);
    expect(ed.currentToolId).toBe('create');
    expect(drawShortcut(ed, 'a')).toBe(true);
    expect(ed.currentToolId).toBe('line');
    expect(drawShortcut(ed, 'v')).toBe(true);
    expect(ed.currentToolId).toBe('select');
    expect(drawShortcut(ed, 'x')).toBe(false);
  });

  it('the line/arrow tool draws a floating arrow between two empty points', () => {
    const ed = new Editor({ viewport: { w: 800, h: 600 } });
    installDrawTools(ed);
    drawShortcut(ed, 'a');
    ed.pointerDown({ x: 100, y: 100 });
    ed.pointerUp({ x: 300, y: 200 });
    const edges = ed.store.edges();
    expect(edges).toHaveLength(1);
    expect(edges[0]!.type).toBe('draw.arrow');
    expect(edges[0]!.from).toEqual({ kind: 'point', x: 100, y: 100 });
    expect(edges[0]!.to).toEqual({ kind: 'point', x: 300, y: 200 });
    expect(ed.currentToolId).toBe('select'); // returns to select after one draw
  });

  it('a stray click (no drag) creates no degenerate/self-loop edge', () => {
    const ed = new Editor({ viewport: { w: 800, h: 600 } });
    installDrawTools(ed);
    drawShortcut(ed, 'a');
    ed.pointerDown({ x: 150, y: 150 });
    ed.pointerUp({ x: 151, y: 150 }); // 1px "click" — below the drag threshold
    expect(ed.store.edges()).toHaveLength(0);
    // clicking on a node must not create an outline→outline self-loop either
    const nid = ed.createNode({ type: 'draw.rect', x: 200, y: 200, w: 80, h: 50 });
    drawShortcut(ed, 'a');
    ed.pointerDown({ x: 240, y: 225 });
    ed.pointerUp({ x: 240, y: 225 });
    expect(ed.store.edges()).toHaveLength(0);
    expect(ed.store.peek(nid)).toBeTruthy();
  });

  it('places a shape via the create tool, and text nodes are multi-line editable', () => {
    const ed = new Editor({ viewport: { w: 800, h: 600 } });
    installDrawTools(ed);
    drawShortcut(ed, 'e');
    ed.pointerDown({ x: 50, y: 50 });
    ed.pointerUp({ x: 50, y: 50 });
    expect(ed.store.nodes()[0]!.type).toBe('draw.ellipse');
    const tid = ed.createNode({ type: 'draw.text', label: 'line 1\nline 2', x: 0, y: 0, w: 120, h: 40 });
    expect(ed.isMultilineEdit(tid)).toBe(true);
    expect(ed.isMultilineEdit(ed.store.nodes()[0]!.id)).toBe(false); // ellipse is single-line
  });
});

// E3 rotation-capability audit: core's `capabilitiesOf` will resolve an unset `canRotate` to the
// DEFAULT_CAPABILITIES value (false), so whiteboard shapes must declare rotation EXPLICITLY or lose
// their rotate handle. (`capabilitiesOf` may not be exported yet — core #36 — so assert the declared
// capability object directly, which is what that helper reads.)
describe('rotation capability (E3 audit)', () => {
  it('freeform whiteboard shapes declare canRotate:true so rotation survives the default flip', () => {
    for (const util of [rectShape, ellipseShape, diamondShape]) {
      expect(util.capabilities?.canRotate).toBe(true);
    }
  });

  it('text stays upright — it opts out with an explicit canRotate:false', () => {
    expect(textNode.capabilities?.canRotate).toBe(false);
  });
});
