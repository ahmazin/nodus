import { describe, expect, it } from 'vitest';
import { Editor, isNodusError, type EdgeRecord, type NodeRecord, type NodusRecord } from '@ahmazin/core';
import { installDiagrams } from '@ahmazin/preset-diagrams';
import { elkLayout } from '@ahmazin/layout-elk';
import { fromMermaid, importMermaid, MAX_MERMAID_BYTES, parseERDiagram, parseFlowchart, parseStateDiagram } from '@ahmazin/from-mermaid';

const nodesOf = (recs: NodusRecord[]) => recs.filter((r): r is NodeRecord => r.typeName === 'node');
const edgesOf = (recs: NodusRecord[]) => recs.filter((r): r is EdgeRecord => r.typeName === 'edge');

describe('from-mermaid: flowchart', () => {
  it('parses shapes, chains, and labelled links', () => {
    const src = `flowchart LR
      A([Start]) --> B{OK?}
      B -->|yes| C(Process)
      B -->|no| D[[Retry]]
      C --> E((Done))`;
    const { kind, direction, records } = fromMermaid(src);
    expect(kind).toBe('flowchart');
    expect(direction).toBe('LR');
    const nodes = nodesOf(records);
    // A,B,C,D,E = 5 distinct nodes
    expect(nodes).toHaveLength(5);
    expect(nodes.map((n) => n.label).sort()).toEqual(['Done', 'OK?', 'Process', 'Retry', 'Start']);
    // decision shape → 'decision' type; terminal circle/stadium → 'pill'
    const byLabel = Object.fromEntries(nodes.map((n) => [n.label, n.type]));
    expect(byLabel['OK?']).toBe('decision');
    expect(byLabel['Start']).toBe('pill');
    expect(byLabel['Done']).toBe('pill');
    expect(byLabel['Process']).toBe('process');
    const edges = edgesOf(records);
    expect(edges).toHaveLength(4);
    expect(edges.filter((e) => e.label).map((e) => e.label).sort()).toEqual(['no', 'yes']);
  });

  it('handles inline-text links and TD/TB direction alias', () => {
    const { direction, records } = fromMermaid('graph TD\n A -- go --> B\n A --- C');
    expect(direction).toBe('TB');
    const edges = edgesOf(records);
    expect(edges).toHaveLength(2);
    expect(edges.some((e) => e.label === 'go')).toBe(true);
  });

  it('a bare reference does not clobber a labelled declaration', () => {
    const { steps } = parseFlowchart(['graph LR', 'A[Login] --> B', 'B --> A'].map((l) => l));
    expect(steps.find((s) => s.id === 'A')?.label).toBe('Login');
    expect(steps.find((s) => s.id === 'B')?.label).toBe('B'); // never labelled → falls back to id
  });

  it('ignores subgraph / style / class directives without throwing', () => {
    const src = `flowchart TB
      subgraph one
      A --> B
      end
      classDef fancy fill:#f9f
      class A fancy`;
    const { records } = fromMermaid(src);
    expect(nodesOf(records)).toHaveLength(2);
    expect(edgesOf(records)).toHaveLength(1);
  });

  it('reports skipped (unrecognized) flowchart lines', () => {
    const { skipped } = fromMermaid('flowchart LR\n  A[Web] --> B[(DB)]\n  %% comment stripped\n  @@@ not a statement');
    expect(skipped).toBe(1); // the "@@@" line is unparseable; comment is stripped, A/B parse fine
  });

  it('reports zero skipped for a clean flowchart', () => {
    expect(fromMermaid('flowchart LR\n A --> B').skipped).toBe(0);
  });
});

describe('from-mermaid: state diagram', () => {
  it('maps [*] to start/end pseudo-states and marks the initial state', () => {
    const src = `stateDiagram-v2
      [*] --> Idle
      Idle --> Running : start
      Running --> Idle : stop
      Running --> [*]`;
    const { kind, records } = fromMermaid(src);
    expect(kind).toBe('state');
    const { states, transitions } = parseStateDiagram(src.split('\n'));
    expect(states.find((s) => s.id === 'Idle')?.initial).toBe(true);
    expect(states.some((s) => s.label === '●')).toBe(true); // start pseudo-state
    expect(states.some((s) => s.label === '◉')).toBe(true); // end pseudo-state
    expect(transitions.filter((t) => t.label).map((t) => t.label).sort()).toEqual(['start', 'stop']);
    // all states are 'state'-typed nodes
    expect(nodesOf(records).every((n) => n.type === 'state')).toBe(true);
  });
});

describe('from-mermaid: ER diagram', () => {
  it('parses entity attribute blocks and cardinality relations', () => {
    const src = `erDiagram
      CUSTOMER ||--o{ ORDER : places
      CUSTOMER {
        string name PK
        string email
      }
      ORDER {
        int id PK
        float total
      }`;
    const { kind, records } = fromMermaid(src);
    expect(kind).toBe('er');
    const { tables, relations } = parseERDiagram(src.split('\n'));
    expect(tables.map((t) => t.id).sort()).toEqual(['CUSTOMER', 'ORDER']);
    const cust = tables.find((t) => t.id === 'CUSTOMER')!;
    expect(cust.columns).toContain('name : string PK');
    expect(cust.columns).toContain('email : string');
    expect(relations[0]).toMatchObject({ from: 'CUSTOMER', to: 'ORDER', label: 'places' });
    expect(nodesOf(records).every((n) => n.type === 'table')).toBe(true);
  });
});

describe('from-mermaid: review regressions', () => {
  it('ER hyphenated entity names keep their relations and entities', () => {
    const { tables, relations } = parseERDiagram(
      ['erDiagram', 'CUSTOMER ||--o{ ORDER : places', 'ORDER ||--|{ LINE-ITEM : contains', 'CUSTOMER }|..|{ DELIVERY-ADDRESS : uses'].map((l) => l),
    );
    expect(tables.map((t) => t.id).sort()).toEqual(['CUSTOMER', 'DELIVERY-ADDRESS', 'LINE-ITEM', 'ORDER']);
    expect(relations).toHaveLength(3);
  });

  it('a semicolon inside a quoted label does not shred the statement', () => {
    const { records } = fromMermaid('flowchart LR\n  A["Stop; wait"] --> B[Go]');
    const nodes = nodesOf(records);
    expect(nodes.map((n) => n.label).sort()).toEqual(['Go', 'Stop; wait']);
    expect(edgesOf(records)).toHaveLength(1);
  });

  it('a pipe label containing a semicolon is not split', () => {
    const { records } = fromMermaid('graph LR\n A -->|yes; ok| B');
    expect(edgesOf(records).find((e) => e.label)?.label).toBe('yes; ok');
    expect(edgesOf(records)).toHaveLength(1);
  });

  it('inline statements on the header line are parsed (compact one-liner form)', () => {
    const { records } = fromMermaid('graph TD; A-->B; B-->C');
    expect(nodesOf(records).map((n) => n.label).sort()).toEqual(['A', 'B', 'C']);
    expect(edgesOf(records)).toHaveLength(2);
  });

  it('state note blocks do not create phantom states', () => {
    const { states } = parseStateDiagram(['stateDiagram-v2', '[*] --> Active', 'note right of Active', '    pending', 'end note'].map((l) => l));
    expect(states.some((s) => s.id === 'pending')).toBe(false);
    expect(states.map((s) => s.id).filter((id) => id === 'Active')).toHaveLength(1);
  });

  it('standalone ER entity declarations become (empty) tables', () => {
    const { tables } = parseERDiagram(['erDiagram', 'CUSTOMER', 'PRODUCT'].map((l) => l));
    expect(tables.map((t) => t.id).sort()).toEqual(['CUSTOMER', 'PRODUCT']);
    expect(tables.every((t) => t.columns.length === 0)).toBe(true);
  });

  it('inline-link normalization does not catastrophically backtrack on a no-arrow run of spaces (ReDoS)', () => {
    // `A --<many spaces>x` opens the inline-link form (`-- <label> -->`) but never closes it. With the
    // old `\s+ … [^|>\n]+? … \s+` regex this backtracked ~cubically (4000 chars froze the event loop for
    // ~30s+); the anchored label class makes it linear. Guard with a strict time bound.
    const pathological = 'flowchart LR\nA --' + ' '.repeat(4000) + 'x';
    const t0 = performance.now();
    const { records } = fromMermaid(pathological);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(100); // unpatched: seconds; patched: sub-millisecond
    // It parses as two bare nodes (no label was closed), never throws.
    expect(nodesOf(records).length).toBeGreaterThanOrEqual(1);
  });

  it('the dotted `-. txt .->` inline form is equally guarded against ReDoS', () => {
    const pathological = 'flowchart LR\nA -.' + ' '.repeat(4000) + 'x';
    const t0 = performance.now();
    fromMermaid(pathological);
    expect(performance.now() - t0).toBeLessThan(100);
  });

  it('inline-text links with internal spaces keep their full label after the ReDoS fix', () => {
    // Regression guard that the anchored label class did not drop internal spaces or change parsing.
    const solid = fromMermaid('graph LR\n A -- two words --> B');
    expect(edgesOf(solid.records).find((e) => e.label)?.label).toBe('two words');
    const dotted = fromMermaid('graph LR\n A -. keep spaces .-> B');
    expect(edgesOf(dotted.records).find((e) => e.label)?.label).toBe('keep spaces');
    const thick = fromMermaid('graph LR\n A == build now ==> B');
    expect(edgesOf(thick.records).find((e) => e.label)?.label).toBe('build now');
  });
});

describe('from-mermaid: importMermaid + ELK', () => {
  it('adds records, auto-installs diagram types, and lays them out with ELK (no overlaps)', async () => {
    const ed = new Editor();
    ed.registerLayout(elkLayout);
    const parsed = await importMermaid(ed, 'flowchart LR\n A[Start] --> B[Middle] --> C[End]');
    expect(parsed.kind).toBe('flowchart');
    expect(ed.nodes.has('process')).toBe(true); // auto-installed
    const nodes = ed.store.nodes();
    expect(nodes).toHaveLength(3);
    // ELK laid them out left-to-right: distinct, increasing x, no two share a position
    const xs = nodes.map((n) => n.x).sort((a, b) => a - b);
    expect(new Set(nodes.map((n) => `${n.x},${n.y}`)).size).toBe(3);
    expect(xs[2]! - xs[0]!).toBeGreaterThan(0);
    expect(ed.store.edges()).toHaveLength(2);
  });

  it('respects layout:false (records added but left unpositioned)', async () => {
    const ed = new Editor();
    installDiagrams(ed);
    await importMermaid(ed, 'graph TD\n A --> B', { layout: false, fit: false });
    expect(ed.store.nodes()).toHaveLength(2);
    expect(ed.store.nodes().every((n) => n.x === 0)).toBe(true); // builders leave x=0 until layout
  });

  it('throws a clear error on an unrecognized header', () => {
    expect(() => fromMermaid('sequenceDiagram\n A->>B: hi')).toThrow(/unrecognized diagram header/);
  });
});

// Regression: ReDoS + resource-exhaustion at the mermaid parse boundary (pre-publication audit,
// 2026-07-22). Each timing case would run ~7–8s on the pre-fix O(n²) code (measured: whitespace-strip
// 7453ms @100k, inline-link 8373ms @32k `--`) and completes in tens of ms after the fix. The 2000ms
// ceiling is a ~4× margin under the pre-fix cost and ~40× above the post-fix cost — discriminating,
// not flaky.
describe('from-mermaid: ReDoS + input-size guards', () => {
  const under = (ms: number, fn: () => void): number => {
    const t0 = performance.now();
    fn();
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(ms);
    return dt;
  };

  it('H2: /\\s+$/ trailing-whitespace strip is linear (long space-run + non-space)', () => {
    // Pre-fix: cleanLines `.replace(/\s+$/,'')` backtracked O(n²) → 7453ms. Post-fix `.trimEnd()` is O(n).
    const src = 'flowchart LR\n' + ' '.repeat(100_000) + 'x';
    under(2000, () => {
      const r = fromMermaid(src);
      expect(r.kind).toBe('flowchart');
    });
  });

  it('H3: inline-link normalization is linear on repeated `--`/`==` operators (no arrow)', () => {
    // Pre-fix: label class `[^|>\n]*` re-backtracked the line at each operator → O(n²), 8373ms @32k.
    under(2000, () => fromMermaid('flowchart LR\nA ' + '-- '.repeat(30_000)));
    under(2000, () => fromMermaid('flowchart LR\nA ' + '== '.repeat(30_000)));
    under(2000, () => fromMermaid('flowchart LR\nA ' + '-. '.repeat(30_000)));
  });

  it('H3: a normal-length inline label still normalizes to a pipe-form edge (fix is behaviour-preserving)', () => {
    const recs = fromMermaid('flowchart LR\nA -- ' + 'x'.repeat(50) + ' --> B').records;
    const edge = recs.find((r) => r.typeName === 'edge') as EdgeRecord | undefined;
    expect(edge?.label).toBe('x'.repeat(50));
  });

  it('M2: source over the byte cap is rejected before parsing', () => {
    const tooBig = 'flowchart LR\n' + 'A-->B\n'.repeat(100_000); // ~600 KB > 512 KB cap
    expect(tooBig.length).toBeGreaterThan(MAX_MERMAID_BYTES);
    expect(() => fromMermaid(tooBig)).toThrow(/too large/);
  });
});

// F34 — the shared importer error convention: malformed input throws a coded NodusError; partial
// input surfaces typed issues; valid input is unchanged.
describe('from-mermaid: error convention (F34)', () => {
  const thrown = (fn: () => unknown): unknown => {
    try {
      fn();
    } catch (e) {
      return e;
    }
    throw new Error('expected the call to throw, but it returned');
  };

  it('an unrecognized header throws a coded NodusError, not a bare Error', () => {
    const e = thrown(() => fromMermaid('sequenceDiagram\n A->>B: hi'));
    expect(isNodusError(e)).toBe(true);
    expect((e as { code: string }).code).toBe('from-mermaid/parse-failed');
  });

  it('empty source throws parse-failed', () => {
    const e = thrown(() => fromMermaid('   \n  \n'));
    expect(isNodusError(e)).toBe(true);
    expect((e as { code: string }).code).toBe('from-mermaid/parse-failed');
  });

  it('over-cap source throws a distinct source-too-large code with the cap in context', () => {
    const tooBig = 'flowchart LR\n' + 'A-->B\n'.repeat(100_000);
    const e = thrown(() => fromMermaid(tooBig));
    expect(isNodusError(e)).toBe(true);
    expect((e as { code: string }).code).toBe('from-mermaid/source-too-large');
    expect((e as { context?: { cap?: number } }).context?.cap).toBe(MAX_MERMAID_BYTES);
  });

  it('unparsable flowchart statements surface as typed issues with the offending line', () => {
    const { skipped, issues } = fromMermaid('flowchart LR\n A[Web] --> B[(DB)]\n @@@ not a statement');
    expect(skipped).toBe(1);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('unparsable-statement');
    expect(issues[0]!.statement).toContain('@@@');
  });

  it('a clean flowchart yields zero issues (regression guard)', () => {
    expect(fromMermaid('flowchart LR\n A --> B').issues).toEqual([]);
  });
});
