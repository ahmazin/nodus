import { describe, expect, it } from 'vitest';
import { Editor, boxEncloses } from '../index.js';

/**
 * Keyboard traversal of canvas nodes: `editor.selectNextNode(dir)` cycles the sole selection
 * through nodes in reading order (top-to-bottom by y, then left-to-right by x, ties by id) and
 * pans the camera — without changing zoom — to keep the focused node on screen.
 * (The DOM Tab/arrow wiring lives in `@ahmazin/react`'s host and is browser-verified separately.)
 */
describe('keyboard traversal — selectNextNode', () => {
  it('with nothing selected, dir 1 selects the first node and dir -1 the last (reading order)', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, label: 'A' }); // top
    const b = ed.createNode({ type: 'rect', x: 0, y: 100, label: 'B' }); // middle
    const c = ed.createNode({ type: 'rect', x: 0, y: 200, label: 'C' }); // bottom

    ed.clearSelection();
    expect(ed.selectNextNode(1)).toBe(a);
    expect(ed.selectedIdsArray()).toEqual([a]);

    ed.clearSelection();
    expect(ed.selectNextNode(-1)).toBe(c);
    expect(ed.selectedIdsArray()).toEqual([c]);
  });

  it('advances forward and wraps around the end', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const b = ed.createNode({ type: 'rect', x: 0, y: 100 });
    const c = ed.createNode({ type: 'rect', x: 0, y: 200 });

    ed.clearSelection();
    expect(ed.selectNextNode(1)).toBe(a); // first
    expect(ed.selectNextNode(1)).toBe(b);
    expect(ed.selectNextNode(1)).toBe(c);
    expect(ed.selectNextNode(1)).toBe(a); // wrap
  });

  it('advances backward and wraps around the start', () => {
    const ed = new Editor();
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    const b = ed.createNode({ type: 'rect', x: 0, y: 100 });
    const c = ed.createNode({ type: 'rect', x: 0, y: 200 });

    ed.select([a]);
    expect(ed.selectNextNode(-1)).toBe(c); // wrap backward past the start
    expect(ed.selectNextNode(-1)).toBe(b);
    expect(ed.selectNextNode(-1)).toBe(a);
  });

  it('keeps the selection size at exactly one throughout traversal', () => {
    const ed = new Editor();
    ed.createNode({ type: 'rect', x: 0, y: 0 });
    ed.createNode({ type: 'rect', x: 0, y: 100 });
    ed.createNode({ type: 'rect', x: 0, y: 200 });
    ed.selectAll();
    expect(ed.selectedIdsArray().length).toBe(3);

    for (let i = 0; i < 6; i++) {
      ed.selectNextNode(1);
      expect(ed.selectedIdsArray().length).toBe(1);
    }
  });

  it('breaks reading-order ties left-to-right by x when y is equal', () => {
    const ed = new Editor();
    // deliberately created out of order; reading order should be left→right on the same row
    const right = ed.createNode({ type: 'rect', x: 300, y: 50 });
    const left = ed.createNode({ type: 'rect', x: 0, y: 50 });

    ed.clearSelection();
    expect(ed.selectNextNode(1)).toBe(left);
    expect(ed.selectNextNode(1)).toBe(right);
  });

  it('returns null when there are no nodes', () => {
    const ed = new Editor();
    expect(ed.selectNextNode(1)).toBeNull();
    expect(ed.selectNextNode(-1)).toBeNull();
  });

  it('pans (keeping zoom) to bring an off-screen node into the viewport', () => {
    const ed = new Editor(); // default viewport 800x600, camera {0,0,z:1}
    const near = ed.createNode({ type: 'rect', x: 10, y: 10 });
    const far = ed.createNode({ type: 'rect', x: 5000, y: 5000 }); // well outside the viewport

    const farBounds = ed.sceneIndex.getItem(far)!.aabb;
    // Precondition: with the default camera the far node is NOT visible — the pan must be real.
    expect(boxEncloses(ed.worldViewport(), farBounds)).toBe(false);

    ed.clearSelection();
    expect(ed.selectNextNode(1)).toBe(near); // near stays on-screen, no pan needed
    const zBefore = ed.camera.z;

    expect(ed.selectNextNode(1)).toBe(far); // reaching far pans the camera to center it
    expect(boxEncloses(ed.worldViewport(), farBounds)).toBe(true);
    expect(ed.camera.z).toBe(zBefore); // zoom is preserved
  });
});
