// A pure, framework-free unified line-diff utility.
//
// Computes a line-level diff between two text strings via a classic LCS
// (longest-common-subsequence) dynamic program, then walks it to produce a
// GitHub-style unified diff model. Zero dependencies, no React/DOM imports.
//
// This drives a "PR-review" diff view over canonical `.nodus.json` documents
// (one record per line, sorted by identity), so correct add/del/context
// classification and 1-based line numbers are the whole point.

export type DiffLineKind = 'context' | 'add' | 'del';

export interface UnifiedDiffLine {
  kind: DiffLineKind;
  /** The line content, WITHOUT its trailing newline. */
  text: string;
  /** 1-based line number in oldText; null for 'add' lines. */
  oldLineNo: number | null;
  /** 1-based line number in newText; null for 'del' lines. */
  newLineNo: number | null;
}

export interface UnifiedDiffResult {
  /** Full ordered diff (context + del + add interleaved), for a unified view. */
  lines: UnifiedDiffLine[];
  /** Count of kind==='add' lines. */
  adds: number;
  /** Count of kind==='del' lines. */
  dels: number;
  /** adds + dels > 0 */
  changed: boolean;
}

/**
 * Split `text` into lines, normalizing a SINGLE trailing newline first.
 *
 * We strip exactly one trailing `"\n"` (if present) before splitting. This
 * matters because canonical serialization (`toCanonicalString`) always ends in
 * a trailing `"\n"`; without this normalization every diff would report a
 * spurious empty final line. Consequences of the rule:
 *   - `"a\nb\n"` -> `["a", "b"]`
 *   - `"a\nb"`   -> `["a", "b"]`
 *   - `""`       -> `[]`   (zero lines, NOT `[""]`)
 *   - `"\n"`     -> `[]`   (the one trailing newline is stripped)
 * Interior blank lines are preserved: `"a\n\nb\n"` -> `["a", "", "b"]`.
 */
function splitLines(text: string): string[] {
  const normalized = text.endsWith('\n') ? text.slice(0, -1) : text;
  if (normalized === '') return [];
  return normalized.split('\n');
}

/**
 * Line-level unified diff of `oldText` vs `newText`.
 *
 * Uses an O(n·m) time/memory LCS dynamic program (inputs are small — dozens to
 * low-hundreds of lines). Within each divergent run, all `del` lines are
 * emitted before all `add` lines (GitHub-style hunk ordering), regardless of
 * how the LCS tie-breaking fell.
 */
export function unifiedDiff(oldText: string, newText: string): UnifiedDiffResult {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const n = oldLines.length;
  const m = newLines.length;

  // dp[i][j] = length of the LCS of oldLines[i..n) and newLines[j..m).
  // Built bottom-up so the forward walk below can greedily choose the move that
  // preserves the longest common subsequence.
  const dp: number[][] = [];
  for (let i = 0; i <= n; i++) {
    dp.push(new Array<number>(m + 1).fill(0));
  }
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i]!;
    const next = dp[i + 1]!;
    const oi = oldLines[i]!;
    for (let j = m - 1; j >= 0; j--) {
      if (oi === newLines[j]!) {
        row[j] = next[j + 1]! + 1;
      } else {
        const down = next[j]!;
        const right = row[j + 1]!;
        row[j] = down >= right ? down : right;
      }
    }
  }

  const lines: UnifiedDiffLine[] = [];
  let adds = 0;
  let dels = 0;
  // Next line number to assign on each side (1-based). Every old-side line
  // (context or del) consumes an oldLineNo; every new-side line (context or
  // add) consumes a newLineNo. The two counters are independent.
  let oldNo = 1;
  let newNo = 1;

  // Buffer the current divergent run so we can emit all dels, then all adds.
  const pendingDel: string[] = [];
  const pendingAdd: string[] = [];
  const flush = (): void => {
    for (const text of pendingDel) {
      lines.push({ kind: 'del', text, oldLineNo: oldNo, newLineNo: null });
      oldNo++;
      dels++;
    }
    for (const text of pendingAdd) {
      lines.push({ kind: 'add', text, oldLineNo: null, newLineNo: newNo });
      newNo++;
      adds++;
    }
    pendingDel.length = 0;
    pendingAdd.length = 0;
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const oi = oldLines[i]!;
    const nj = newLines[j]!;
    if (oi === nj) {
      // A common line: close out any pending divergence, then emit context.
      flush();
      lines.push({ kind: 'context', text: oi, oldLineNo: oldNo, newLineNo: newNo });
      oldNo++;
      newNo++;
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      // Advancing old preserves an LCS at least as long: this old line is a del.
      pendingDel.push(oi);
      i++;
    } else {
      // Advancing new is strictly better: this new line is an add.
      pendingAdd.push(nj);
      j++;
    }
  }
  // Tail: whatever remains on one side is a pure block of dels or adds.
  while (i < n) {
    pendingDel.push(oldLines[i]!);
    i++;
  }
  while (j < m) {
    pendingAdd.push(newLines[j]!);
    j++;
  }
  flush();

  return { lines, adds, dels, changed: adds + dels > 0 };
}
