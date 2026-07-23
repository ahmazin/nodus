/**
 * Editor + scene-index page wiring: createPage / moveToPage / deletePage, the active-page atom, and
 * page culling in the scene index (render / marquee). Also guards the byte-stability invariant — a
 * document that never creates a second page carries no page records and no `pageId`.
 */
import { describe, expect, it } from 'vitest';
import { Editor, toCanonicalString, type NodeUtil } from '../index.js';
import type { Id, NodeRecord, EdgeRecord } from '../model.js';

const boxUtil: NodeUtil = {
  type: 'box',
  getDefaultProps: () => ({}),
  getDefaultSize: () => ({ w: 20, h: 20 }),
  getGeometry: (n) => ({ bounds: () => ({ x: n.x, y: n.y, w: n.w, h: n.h }) }) as never,
  draw: () => {},
};
const makeEditor = () => {
  const ed = new Editor();
  ed.registerNodeType(boxUtil);
  return ed;
};
const pageOf = (ed: Editor, id: Id) => (ed.store.peek(id) as NodeRecord | EdgeRecord | undefined)?.pageId;

describe('pages — byte-stability (no pages ⇒ no pageId)', () => {
  it('a single-page document serializes with no page records and no pageId', () => {
    const ed = makeEditor();
    ed.createNode({ type: 'box', x: 0, y: 0 });
    ed.createNode({ type: 'box', x: 40, y: 0 });
    const bytes = toCanonicalString(ed.toJSON());
    expect(bytes).not.toContain('pageId');
    expect(bytes).not.toContain('"typeName":"page"');
    expect(ed.pages()).toHaveLength(0);
    expect(ed.activePageId()).toBe(null);
  });
});

describe('pages — createPage materializes then appends', () => {
  it('first createPage makes Page 1 for existing content and switches to the new page', () => {
    const ed = makeEditor();
    const a = ed.createNode({ type: 'box', x: 0, y: 0 });
    const b = ed.createNode({ type: 'box', x: 40, y: 0 });
    const page2 = ed.createPage();
    const pages = ed.pages();
    expect(pages).toHaveLength(2);
    const page1 = pages[0]!.id;
    expect(pageOf(ed, a)).toBe(page1);
    expect(pageOf(ed, b)).toBe(page1);
    expect(ed.activePageId()).toBe(page2); // switched to the new (empty) page

    // round-trips with every record explicit (no repair needed)
    const reloaded = makeEditor();
    reloaded.loadSnapshot(ed.toJSON());
    expect(reloaded.pages()).toHaveLength(2);
    expect(pageOf(reloaded, a)).toBe(page1);
  });

  it('a second createPage just appends (no re-backfill of existing records)', () => {
    const ed = makeEditor();
    const a = ed.createNode({ type: 'box', x: 0, y: 0 });
    ed.createPage();
    const p1 = ed.pages()[0]!.id;
    ed.createPage();
    expect(ed.pages()).toHaveLength(3);
    expect(pageOf(ed, a)).toBe(p1); // unchanged
  });
});

describe('pages — moveToPage / deletePage', () => {
  it('moveToPage sets pageId; deletePage cascades members and refuses the last page', () => {
    const ed = makeEditor();
    const a = ed.createNode({ type: 'box', x: 0, y: 0 });
    const b = ed.createNode({ type: 'box', x: 40, y: 0 });
    const page2 = ed.createPage();
    const page1 = ed.pages()[0]!.id;

    ed.moveToPage([b], page2);
    expect(pageOf(ed, b)).toBe(page2);

    // delete page2 (currently active) → b cascades away, active falls back to page1
    expect(ed.deletePage(page2)).toBe(true);
    expect(ed.store.peek(b)).toBeUndefined();
    expect(ed.store.peek(a)).toBeDefined();
    expect(ed.activePageId()).toBe(page1);
    expect(ed.pages()).toHaveLength(1);

    // refuse to delete the last page
    expect(ed.deletePage(page1)).toBe(false);
    expect(ed.pages()).toHaveLength(1);
  });
});

describe('pages — scene index culls to the active page', () => {
  it('paintOrder / enclosedNodes exclude records not on the active page', () => {
    const ed = makeEditor();
    const a = ed.createNode({ type: 'box', x: 0, y: 0 });
    const b = ed.createNode({ type: 'box', x: 40, y: 0 });
    const page2 = ed.createPage();
    const page1 = ed.pages()[0]!.id;
    ed.moveToPage([b], page2);
    const bigBox = { x: -100, y: -100, w: 400, h: 400 };

    ed.setActivePage(page1);
    expect(ed.sceneIndex.paintOrder().map((i) => i.id)).toEqual([a]);
    expect(ed.sceneIndex.enclosedNodes(bigBox)).toEqual([a]);

    ed.setActivePage(page2);
    expect(ed.sceneIndex.paintOrder().map((i) => i.id)).toEqual([b]);
    expect(ed.sceneIndex.enclosedNodes(bigBox)).toEqual([b]);

    ed.setActivePage(null); // implicit page ⇒ show everything
    expect(ed.sceneIndex.paintOrder().map((i) => i.id).sort()).toEqual([a, b].sort());
  });
});
