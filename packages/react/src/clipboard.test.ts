import { describe, expect, it } from 'vitest';
import { Editor } from '@nodus/core';
import { pasteFromSystem } from './clipboard.js';

/** Minimal DataTransfer stand-in: enough for the text branch of `pasteFromSystem` (the image branch
 *  needs a browser `FileReader`/`Image` and is exercised by the browser E2E, not here). */
function fakeClipboard(opts: { text?: string; items?: { kind: string; type: string }[] }): DataTransfer {
  return {
    items: (opts.items ?? []) as unknown as DataTransferItemList,
    getData: (type: string) => (type === 'text/plain' ? (opts.text ?? '') : ''),
  } as unknown as DataTransfer;
}

describe('pasteFromSystem — plain-text branch', () => {
  it('inserts pasted text as a selected node labeled with the text', () => {
    const ed = new Editor();
    const consumed = pasteFromSystem(ed, fakeClipboard({ text: 'hello world' }), { textNodeType: 'rect' });
    expect(consumed).toBe(true);
    const nodes = ed.store.nodes();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.label).toBe('hello world');
    expect(ed.selectedIdsArray()).toContain(nodes[0]!.id);
  });

  it('ignores text when no textNodeType is configured', () => {
    const ed = new Editor();
    expect(pasteFromSystem(ed, fakeClipboard({ text: 'hi' }), {})).toBe(false);
    expect(ed.store.nodes()).toHaveLength(0);
  });

  it('ignores whitespace-only text and null clipboard data', () => {
    const ed = new Editor();
    expect(pasteFromSystem(ed, fakeClipboard({ text: '   ' }), { textNodeType: 'rect' })).toBe(false);
    expect(pasteFromSystem(ed, null, { textNodeType: 'rect' })).toBe(false);
    expect(ed.store.nodes()).toHaveLength(0);
  });
});
