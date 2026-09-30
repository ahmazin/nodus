import { describe, expect, it } from 'vitest';
import { Editor } from '../index.js';

/**
 * History bounding (PRR P2). A new Editor caps undo growth at 500 entries by default (was unbounded —
 * a long session leaked memory), while `history: { limit: Infinity }` opts back into an unbounded
 * stack. `{ limit: n }` caps at n. Each `createNode` is one immediately-captured undo entry.
 */
describe('history.limit default', () => {
  const fillHistory = (ed: Editor, n: number): void => {
    for (let i = 0; i < n; i++) ed.createNode({ type: 'rect', x: i, y: 0, w: 10, h: 10 });
  };
  const drainUndo = (ed: Editor): number => {
    let count = 0;
    while (ed.undo()) count++;
    return count;
  };

  it('a default Editor evicts undo entries past 500', () => {
    const ed = new Editor();
    fillHistory(ed, 600);
    expect(drainUndo(ed)).toBe(500); // oldest 100 evicted; only the last 500 remain undoable
  });

  it('history.limit: Infinity keeps every entry (opt-out)', () => {
    const ed = new Editor({ history: { limit: Infinity } });
    fillHistory(ed, 600);
    expect(drainUndo(ed)).toBe(600);
  });

  it('history.limit: n caps the stack at n', () => {
    const ed = new Editor({ history: { limit: 10 } });
    fillHistory(ed, 25);
    expect(drainUndo(ed)).toBe(10);
  });
});
