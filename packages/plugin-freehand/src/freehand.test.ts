import { describe, expect, it } from 'vitest';
import { Editor, type NodeRecord } from '@nodus-dev/core';
import { installFreehand } from '@nodus-dev/plugin-freehand';

describe('freehand plugin', () => {
  it('registers a tool + type through the public API and draws a stroke', () => {
    const ed = new Editor({ viewport: { w: 800, h: 600 } });
    installFreehand(ed);
    expect(ed.nodes.has('freehand')).toBe(true);
    expect(ed.toolManager.has('freehand')).toBe(true);

    ed.setTool('freehand');
    ed.pointerDown({ x: 100, y: 100 });
    ed.pointerMove({ x: 140, y: 120 });
    ed.pointerMove({ x: 180, y: 100 });
    ed.pointerMove({ x: 220, y: 130 });
    ed.pointerUp({ x: 220, y: 130 });

    const strokes = ed.store.nodes().filter((n) => n.type === 'freehand');
    expect(strokes).toHaveLength(1);
    const pts = (strokes[0] as NodeRecord).props.points as unknown[];
    expect(pts.length).toBeGreaterThanOrEqual(4);
    // the stroke node is indexed (hit-testable)
    expect(ed.sceneIndex.all().filter((i) => i.record.type === 'freehand')).toHaveLength(1);
  });

  it('a whole stroke is one undo entry, and it moves with the node', () => {
    const ed = new Editor({ viewport: { w: 800, h: 600 } });
    installFreehand(ed);
    ed.setTool('freehand');
    ed.pointerDown({ x: 50, y: 50 });
    ed.pointerMove({ x: 90, y: 90 });
    ed.pointerMove({ x: 130, y: 60 });
    ed.pointerUp({ x: 130, y: 60 });

    const id = ed.store.nodes().find((n) => n.type === 'freehand')!.id;
    const x0 = (ed.store.peek(id) as NodeRecord).x;
    ed.moveBy([id], 40, 0);
    expect((ed.store.peek(id) as NodeRecord).x).toBe(x0 + 40);

    ed.undo(); // undo the move
    ed.undo(); // undo the whole stroke
    expect(ed.store.nodes().filter((n) => n.type === 'freehand')).toHaveLength(0);
  });
});
