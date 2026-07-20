import { describe, expect, it } from 'vitest';
import { unifiedDiff, type UnifiedDiffLine, type UnifiedDiffResult } from './unified-diff';

/** Reconstruct the old side: context + del lines, in order, must reproduce oldText's lines. */
function oldSide(result: UnifiedDiffResult): string[] {
  return result.lines.filter((l) => l.kind !== 'add').map((l) => l.text);
}

/** Reconstruct the new side: context + add lines, in order, must reproduce newText's lines. */
function newSide(result: UnifiedDiffResult): string[] {
  return result.lines.filter((l) => l.kind !== 'del').map((l) => l.text);
}

/** Same normalization the implementation documents: strip one trailing "\n", "" -> []. */
function expectedLines(text: string): string[] {
  const normalized = text.endsWith('\n') ? text.slice(0, -1) : text;
  return normalized === '' ? [] : normalized.split('\n');
}

/** Assert the reconstruction invariant + that line numbers are strictly increasing per side. */
function assertInvariants(oldText: string, newText: string, result: UnifiedDiffResult): void {
  expect(oldSide(result)).toEqual(expectedLines(oldText));
  expect(newSide(result)).toEqual(expectedLines(newText));

  // Line numbers strictly increasing within each side, and present/null per kind.
  let lastOld = 0;
  let lastNew = 0;
  for (const line of result.lines) {
    if (line.kind === 'add') {
      expect(line.oldLineNo).toBeNull();
      expect(line.newLineNo).not.toBeNull();
    } else if (line.kind === 'del') {
      expect(line.newLineNo).toBeNull();
      expect(line.oldLineNo).not.toBeNull();
    } else {
      expect(line.oldLineNo).not.toBeNull();
      expect(line.newLineNo).not.toBeNull();
    }
    if (line.oldLineNo !== null) {
      expect(line.oldLineNo).toBe(lastOld + 1);
      lastOld = line.oldLineNo;
    }
    if (line.newLineNo !== null) {
      expect(line.newLineNo).toBe(lastNew + 1);
      lastNew = line.newLineNo;
    }
  }

  // Counts agree with the classified lines.
  expect(result.adds).toBe(result.lines.filter((l) => l.kind === 'add').length);
  expect(result.dels).toBe(result.lines.filter((l) => l.kind === 'del').length);
  expect(result.changed).toBe(result.adds + result.dels > 0);
}

describe('unifiedDiff — identical inputs', () => {
  it('classifies every line as context with sequential numbers on both sides', () => {
    const text = 'a\nb\nc\n';
    const result = unifiedDiff(text, text);
    expect(result.adds).toBe(0);
    expect(result.dels).toBe(0);
    expect(result.changed).toBe(false);
    expect(result.lines.map((l) => l.kind)).toEqual(['context', 'context', 'context']);
    expect(result.lines.map((l) => l.oldLineNo)).toEqual([1, 2, 3]);
    expect(result.lines.map((l) => l.newLineNo)).toEqual([1, 2, 3]);
    assertInvariants(text, text, result);
  });
});

describe('unifiedDiff — pure additions', () => {
  it('empty old vs populated new is all adds with correct newLineNo and no dels', () => {
    const oldText = '';
    const newText = 'x\ny\nz\n';
    const result = unifiedDiff(oldText, newText);
    expect(result.dels).toBe(0);
    expect(result.adds).toBe(3);
    expect(result.changed).toBe(true);
    expect(result.lines.map((l) => l.kind)).toEqual(['add', 'add', 'add']);
    expect(result.lines.map((l) => l.newLineNo)).toEqual([1, 2, 3]);
    expect(result.lines.every((l) => l.oldLineNo === null)).toBe(true);
    assertInvariants(oldText, newText, result);
  });

  it('old ⊂ new: appended lines become adds, existing lines stay context', () => {
    const oldText = 'a\nb\n';
    const newText = 'a\nb\nc\nd\n';
    const result = unifiedDiff(oldText, newText);
    expect(result.dels).toBe(0);
    expect(result.adds).toBe(2);
    const adds = result.lines.filter((l) => l.kind === 'add');
    expect(adds.map((l) => l.text)).toEqual(['c', 'd']);
    expect(adds.map((l) => l.newLineNo)).toEqual([3, 4]);
    assertInvariants(oldText, newText, result);
  });
});

describe('unifiedDiff — pure removals', () => {
  it('populated old vs empty new is all dels with correct oldLineNo and no adds', () => {
    const oldText = 'x\ny\nz\n';
    const newText = '';
    const result = unifiedDiff(oldText, newText);
    expect(result.adds).toBe(0);
    expect(result.dels).toBe(3);
    expect(result.changed).toBe(true);
    expect(result.lines.map((l) => l.kind)).toEqual(['del', 'del', 'del']);
    expect(result.lines.map((l) => l.oldLineNo)).toEqual([1, 2, 3]);
    expect(result.lines.every((l) => l.newLineNo === null)).toBe(true);
    assertInvariants(oldText, newText, result);
  });

  it('removes a middle line: one del, surrounding context keeps numbers', () => {
    const oldText = 'a\nb\nc\n';
    const newText = 'a\nc\n';
    const result = unifiedDiff(oldText, newText);
    expect(result.dels).toBe(1);
    expect(result.adds).toBe(0);
    const del = result.lines.find((l) => l.kind === 'del')!;
    expect(del.text).toBe('b');
    expect(del.oldLineNo).toBe(2);
    expect(del.newLineNo).toBeNull();
    assertInvariants(oldText, newText, result);
  });
});

describe('unifiedDiff — a single changed line in the middle', () => {
  it('yields exactly one del + one add, with correct context line numbers', () => {
    const oldText = 'a\nX\nc\n';
    const newText = 'a\nY\nc\n';
    const result = unifiedDiff(oldText, newText);

    expect(result.dels).toBe(1);
    expect(result.adds).toBe(1);
    expect(result.changed).toBe(true);

    // GitHub-style ordering: del before add within the hunk.
    const kinds = result.lines.map((l) => l.kind);
    expect(kinds).toEqual(['context', 'del', 'add', 'context']);

    const [ctxA, del, add, ctxC] = result.lines as [
      UnifiedDiffLine,
      UnifiedDiffLine,
      UnifiedDiffLine,
      UnifiedDiffLine,
    ];
    expect(ctxA).toMatchObject({ kind: 'context', text: 'a', oldLineNo: 1, newLineNo: 1 });
    expect(del).toMatchObject({ kind: 'del', text: 'X', oldLineNo: 2, newLineNo: null });
    expect(add).toMatchObject({ kind: 'add', text: 'Y', oldLineNo: null, newLineNo: 2 });
    // Trailing context: old line 3, new line 3 (numbering advanced correctly past the change).
    expect(ctxC).toMatchObject({ kind: 'context', text: 'c', oldLineNo: 3, newLineNo: 3 });

    assertInvariants(oldText, newText, result);
  });
});

describe('unifiedDiff — a record "move" analogue', () => {
  it('two canonical-ish lines swapping order is expressed as dels + adds, not silently equal', () => {
    // Records are one-per-line and sorted by identity; reordering surfaces as a
    // real change (not a no-op), which is what the PR-review view depends on.
    const oldText = '{"id":"a"}\n{"id":"b"}\n';
    const newText = '{"id":"b"}\n{"id":"a"}\n';
    const result = unifiedDiff(oldText, newText);

    expect(result.changed).toBe(true);
    // A swap of two distinct lines: exactly one line moves past the other, so
    // one del + one add (the other line becomes shared context).
    expect(result.dels).toBe(1);
    expect(result.adds).toBe(1);
    assertInvariants(oldText, newText, result);
  });

  it('a node "added" among sorted records is a single add', () => {
    const oldText = '{"id":"a"}\n{"id":"c"}\n';
    const newText = '{"id":"a"}\n{"id":"b"}\n{"id":"c"}\n';
    const result = unifiedDiff(oldText, newText);
    expect(result.dels).toBe(0);
    expect(result.adds).toBe(1);
    const add = result.lines.find((l) => l.kind === 'add')!;
    expect(add.text).toBe('{"id":"b"}');
    expect(add.newLineNo).toBe(2);
    assertInvariants(oldText, newText, result);
  });
});

describe('unifiedDiff — trailing-newline normalization', () => {
  it('identical trailing-newline text reports no changes', () => {
    const result = unifiedDiff('a\nb\n', 'a\nb\n');
    expect(result.changed).toBe(false);
    expect(result.adds).toBe(0);
    expect(result.dels).toBe(0);
    expect(result.lines.map((l) => l.text)).toEqual(['a', 'b']);
  });

  it('appending one line with trailing newlines yields exactly one add of "c" at newLineNo 3', () => {
    const oldText = 'a\nb\n';
    const newText = 'a\nb\nc\n';
    const result = unifiedDiff(oldText, newText);
    expect(result.dels).toBe(0);
    expect(result.adds).toBe(1);
    const add = result.lines.find((l) => l.kind === 'add')!;
    expect(add.text).toBe('c');
    expect(add.newLineNo).toBe(3);
    expect(add.oldLineNo).toBeNull();
    assertInvariants(oldText, newText, result);
  });

  it('treats "a\\nb\\n" and "a\\nb" identically (single trailing newline stripped)', () => {
    const result = unifiedDiff('a\nb\n', 'a\nb');
    expect(result.changed).toBe(false);
    expect(result.lines.map((l) => l.kind)).toEqual(['context', 'context']);
  });
});

describe('unifiedDiff — empty inputs', () => {
  it('empty vs empty yields zero lines and not-changed', () => {
    const result = unifiedDiff('', '');
    expect(result.lines).toEqual([]);
    expect(result.adds).toBe(0);
    expect(result.dels).toBe(0);
    expect(result.changed).toBe(false);
  });

  it('a bare newline normalizes to zero lines', () => {
    const result = unifiedDiff('\n', '\n');
    expect(result.lines).toEqual([]);
    expect(result.changed).toBe(false);
  });
});

describe('unifiedDiff — reconstruction invariant (the strongest check)', () => {
  const fixtures: Array<[string, string]> = [
    ['a\nb\nc\nd\ne\n', 'a\nX\nc\nd\nY\n'],
    ['one\ntwo\nthree\n', 'zero\none\ntwo\n'],
    ['', 'only\nnew\nlines\n'],
    ['only\nold\nlines\n', ''],
    ['keep\ndrop\nkeep2\nadd-after\n', 'keep\nkeep2\nadd-after\nbrand-new\n'],
    ['a\n\nb\n', 'a\nb\n'], // interior blank line handling
  ];

  for (const [oldText, newText] of fixtures) {
    it(`old(${JSON.stringify(oldText)}) -> new(${JSON.stringify(newText)}) reproduces both sides`, () => {
      const result = unifiedDiff(oldText, newText);
      // context+del reproduces old; context+add reproduces new; numbers consistent.
      assertInvariants(oldText, newText, result);
    });
  }
});
