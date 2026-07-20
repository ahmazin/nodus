/**
 * @nodus/from-mermaid — parse a Mermaid diagram string into Nodus records, reusing the
 * @nodus/preset-diagrams builders (so the result renders with the diagram node types + theme and
 * lays out under any registered engine, e.g. ELK). Deliberately scoped to the three subsets that
 * cover the common cases: `flowchart`/`graph`, `stateDiagram(-v2)`, and `erDiagram`.
 *
 *   const { records } = fromMermaid('graph LR\n A[Start] --> B{OK?} -->|yes| C[Done]');
 *   await importMermaid(editor, src);            // parse + add + ELK layout + fit
 *
 * NOT supported (parsed leniently — ignored, never thrown): flowchart subgraphs, `&` multi-targets,
 * class/style directives, composite states, ER attribute keys beyond PK/FK. Unknown lines are skipped.
 */
import { type Editor, type NodusRecord } from '@nodus/core';
import {
  buildERD,
  buildFlowchart,
  buildStateMachine,
  installDiagrams,
  type FlowLink,
  type FlowStep,
  type StateSpec,
  type TableSpec,
  type Transition,
} from '@nodus/preset-diagrams';

export type MermaidKind = 'flowchart' | 'state' | 'er';
export type Direction = 'TB' | 'LR' | 'RL' | 'BT';

export interface ParsedMermaid {
  kind: MermaidKind;
  direction: Direction;
  records: NodusRecord[];
  /** Count of body statements that matched no rule (flowchart only in v1; 0 for state/er). */
  skipped: number;
}

// ---------------------------------------------------------------------------
// shared preprocessing
// ---------------------------------------------------------------------------

/** Strip comments and blank lines; keep raw lines (ER needs line structure for its `{ }` blocks). */
function cleanLines(src: string): string[] {
  return src
    .split('\n')
    .map((l) => l.replace(/%%.*$/, '').replace(/\s+$/, '')) // drop `%%` comments + trailing ws
    .filter((l) => l.trim().length > 0);
}

function detectKind(firstLine: string): MermaidKind | null {
  const h = firstLine.trim().toLowerCase();
  if (h.startsWith('graph') || h.startsWith('flowchart')) return 'flowchart';
  if (h.startsWith('statediagram')) return 'state';
  if (h.startsWith('erdiagram')) return 'er';
  return null;
}

function readDirection(firstLine: string): Direction {
  const m = /\b(TB|TD|BT|RL|LR)\b/.exec(firstLine);
  const d = m?.[1] ?? 'TB';
  return (d === 'TD' ? 'TB' : d) as Direction;
}

const unquote = (s: string): string => s.trim().replace(/^["'`]|["'`]$/g, '').trim();

/**
 * Split a diagram body into statements on `;` and newlines, but NOT inside a quoted label
 * (`"a; b"`), a shape wrapper (`[a; b]`), or a pipe label (`|a; b|`). Multi-line bracket content is
 * folded to a single space. This is what makes `A["Stop; wait"] --> B` and `graph TD; A-->B` correct.
 */
function splitStatements(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0; // [] () {} nesting
  let quote: string | null = null;
  let inPipe = false;
  const flush = (): void => {
    if (buf.trim()) out.push(buf.trim());
    buf = '';
  };
  for (const ch of text) {
    if (ch === '\n') {
      if (depth === 0) {
        flush();
        quote = null;
        inPipe = false;
      } else buf += ' ';
      continue;
    }
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === '|') {
      inPipe = !inPipe;
      buf += ch;
      continue;
    }
    if (ch === '[' || ch === '(' || ch === '{') depth++;
    else if (ch === ']' || ch === ')' || ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0 && !inPipe) {
      flush();
      continue;
    }
    buf += ch;
  }
  flush();
  return out;
}

/** Statements of a flowchart/state diagram: strip the header token in place (keeping any inline
 *  statements on its line), then split the whole body quote/bracket-aware. */
function bodyStatements(lines: string[]): string[] {
  if (lines.length === 0) return [];
  const head = lines[0]!.replace(/^\s*(graph|flowchart|stateDiagram-v2|stateDiagram|erDiagram)\b[ \t]*(TB|TD|BT|RL|LR)?[ \t]*;?/i, '');
  return splitStatements([head, ...lines.slice(1)].join('\n'));
}

// ---------------------------------------------------------------------------
// flowchart
// ---------------------------------------------------------------------------

// Shape wrappers, ORDERED longest/most-specific first so `((` beats `(`, `[[` beats `[`, etc.
const SHAPES: { open: string; close: string; kind: FlowStep['kind'] }[] = [
  { open: '([', close: '])', kind: 'start' }, // stadium → terminal
  { open: '((', close: '))', kind: 'start' }, // circle → terminal
  { open: '[[', close: ']]', kind: 'process' }, // subroutine
  { open: '[(', close: ')]', kind: 'process' }, // cylinder / db
  { open: '{{', close: '}}', kind: 'decision' }, // hexagon
  { open: '[', close: ']', kind: 'process' }, // rectangle
  { open: '(', close: ')', kind: 'process' }, // rounded
  { open: '{', close: '}', kind: 'decision' }, // rhombus
  { open: '>', close: ']', kind: 'process' }, // asymmetric
];

interface NodeTok {
  id: string;
  label: string;
  kind: FlowStep['kind'];
}

/** Consume `id` plus an optional shape wrapper at the start of `s`. Returns the token + the rest. */
function consumeNode(s: string): { tok: NodeTok; rest: string } | null {
  const idm = /^([A-Za-z0-9_.]+)/.exec(s);
  if (!idm) return null;
  const id = idm[1]!;
  let rest = s.slice(id.length);
  for (const sh of SHAPES) {
    if (rest.startsWith(sh.open)) {
      const end = rest.indexOf(sh.close, sh.open.length);
      if (end !== -1) {
        const label = unquote(rest.slice(sh.open.length, end));
        return { tok: { id, label: label || id, kind: sh.kind }, rest: rest.slice(end + sh.close.length) };
      }
    }
  }
  return { tok: { id, label: id, kind: 'process' }, rest };
}

// A flowchart link operator: dotted/thick/normal, arrow or open, with optional extra dashes.
const LINK_OP = /^\s*(<-->|-\.->|-\.-|-{2,}[>xo]?|={2,}>?)\s*/;

interface LinkTok {
  label?: string;
}

/** Split one flowchart statement into an alternating chain: node, link, node, link, ... */
function parseFlowStatement(stmt: string): { nodes: NodeTok[]; links: LinkTok[] } | null {
  // Normalise inline-text links (`A -- txt --> B`, `A == txt ==> B`, `A -. txt .-> B`) to pipe form.
  let s = stmt
    .replace(/(?:--|==)\s+([^|>\n]+?)\s+(-->|---|==>|===)/g, '$2|$1|')
    .replace(/-\.\s+([^|>\n]+?)\s+\.->/g, '-.->|$1|')
    .trim();
  const first = consumeNode(s);
  if (!first) return null;
  const nodes: NodeTok[] = [first.tok];
  const links: LinkTok[] = [];
  s = first.rest.trimStart();
  while (s.length) {
    const op = LINK_OP.exec(s);
    if (!op) break;
    s = s.slice(op[0].length);
    let label: string | undefined;
    const lbl = /^\|([^|]*)\|\s*/.exec(s);
    if (lbl) {
      label = unquote(lbl[1]!);
      s = s.slice(lbl[0].length);
    }
    const nx = consumeNode(s.trimStart());
    if (!nx) break;
    links.push(label !== undefined && label !== '' ? { label } : {});
    nodes.push(nx.tok);
    s = nx.rest.trimStart();
  }
  return { nodes, links };
}

function parseFlowchart(lines: string[]): { steps: FlowStep[]; links: FlowLink[]; skipped: number } {
  const steps = new Map<string, FlowStep>();
  const links: FlowLink[] = [];
  let skipped = 0;
  const note = (t: NodeTok): void => {
    const existing = steps.get(t.id);
    // A labelled/shaped occurrence wins over a bare reference (`A[Start]` beats a later bare `A`).
    if (!existing) steps.set(t.id, { id: t.id, kind: t.kind, label: t.label });
    else if (existing.label === existing.id && t.label !== t.id) steps.set(t.id, { id: t.id, kind: t.kind, label: t.label });
  };
  for (const line of bodyStatements(lines)) {
    if (/^(subgraph|end|direction|class|classDef|style|linkStyle|click)\b/i.test(line)) continue;
    const parsed = parseFlowStatement(line);
    if (!parsed || parsed.nodes.length === 0) {
      skipped++;
      continue;
    }
    for (const n of parsed.nodes) note(n);
    for (let i = 0; i < parsed.links.length; i++) {
      const from = parsed.nodes[i]!;
      const to = parsed.nodes[i + 1]!;
      const l = parsed.links[i]!;
      links.push(l.label ? { from: from.id, to: to.id, label: l.label } : { from: from.id, to: to.id });
    }
  }
  return { steps: [...steps.values()], links, skipped };
}

// ---------------------------------------------------------------------------
// state diagrams
// ---------------------------------------------------------------------------

const START_ID = '__mermaid_start__';
const END_ID = '__mermaid_end__';

function parseStateDiagram(lines: string[]): { states: StateSpec[]; transitions: Transition[] } {
  const states = new Map<string, StateSpec>();
  const transitions: Transition[] = [];
  const ensure = (id: string, label?: string, initial?: boolean): void => {
    const cur = states.get(id);
    if (!cur) states.set(id, { id, label: label ?? id, ...(initial ? { initial: true } : {}) });
    else {
      if (label && cur.label === cur.id) cur.label = label;
      if (initial) cur.initial = true;
    }
  };
  let inNote = false;
  for (const line of bodyStatements(lines)) {
    // skip multi-line `note ... end note` blocks (a single-line note carries its text after `:`)
    if (/^note\b/i.test(line)) {
      inNote = !/:/.test(line);
      continue;
    }
    if (inNote) {
      if (/^end\s+note\b/i.test(line)) inNote = false;
      continue;
    }
    if (/^(state\s+\w+\s*\{|\}|direction)\b/i.test(line)) continue;

    // `state "Long name" as S1`  /  `state S1 as Alias`
    const decl = /^state\s+"([^"]+)"\s+as\s+(\w+)/i.exec(line) ?? /^state\s+(\w+)\s+as\s+(\w+)/i.exec(line);
    if (decl) {
      ensure(decl[2]!, decl[1]!);
      continue;
    }
    // transition:  A --> B : event   (A/B may be `[*]`)
    const tr = /^(\[\*\]|\w+)\s*-->\s*(\[\*\]|\w+)\s*(?::\s*(.*))?$/.exec(line);
    if (tr) {
      const fromRaw = tr[1]!;
      const toRaw = tr[2]!;
      const label = tr[3] ? unquote(tr[3]) : undefined;
      const from = fromRaw === '[*]' ? START_ID : fromRaw;
      const to = toRaw === '[*]' ? END_ID : toRaw;
      if (from === START_ID) ensure(START_ID, '●');
      else ensure(from);
      if (to === END_ID) ensure(END_ID, '◉');
      else ensure(to, undefined, from === START_ID); // target of the start pseudo-state is initial
      transitions.push(label ? { from, to, label } : { from, to });
      continue;
    }
    // `S1 : description`
    const desc = /^(\w+)\s*:\s*(.+)$/.exec(line);
    if (desc) {
      ensure(desc[1]!, unquote(desc[2]!));
      continue;
    }
    // bare state name
    const bare = /^(\w+)$/.exec(line);
    if (bare) ensure(bare[1]!);
  }
  return { states: [...states.values()], transitions };
}

// ---------------------------------------------------------------------------
// ER diagrams
// ---------------------------------------------------------------------------

// CUSTOMER ||--o{ ORDER : places   — cardinality glyphs are parsed but not modelled (label kept).
// Entity names may contain hyphens (Mermaid's own canonical example uses LINE-ITEM, DELIVERY-ADDRESS).
const ER_REL = /^([\w-]+)\s+[|}{o<>.\-]+\s+([\w-]+)\s*:\s*(.+)$/;
const ER_NAME = /^[A-Za-z0-9_-]+$/;

function parseERDiagram(lines: string[]): { tables: TableSpec[]; relations: { from: string; to: string; label?: string }[] } {
  const tables = new Map<string, TableSpec>();
  const relations: { from: string; to: string; label?: string }[] = [];
  const ensure = (id: string): TableSpec => {
    let t = tables.get(id);
    if (!t) {
      t = { id, name: id, columns: [] };
      tables.set(id, t);
    }
    return t;
  };
  const body = lines.slice(1);
  for (let i = 0; i < body.length; i++) {
    const line = body[i]!.trim();
    if (!line) continue;

    // entity block:  ENTITY {  ... attributes ...  }
    const block = /^([\w-]+)\s*\{$/.exec(line);
    if (block) {
      const t = ensure(block[1]!);
      for (i++; i < body.length && !body[i]!.trim().startsWith('}'); i++) {
        const attr = body[i]!.trim();
        if (!attr) continue;
        // `type name [PK|FK] ["comment"]`
        const m = /^(\w+)\s+(\w+)(?:\s+(PK|FK|UK))?/.exec(attr);
        if (m) {
          const key = m[3] ? ` ${m[3]}` : '';
          t.columns.push(`${m[2]} : ${m[1]}${key}`);
        } else {
          t.columns.push(attr);
        }
      }
      continue;
    }

    const rel = ER_REL.exec(line);
    if (rel) {
      ensure(rel[1]!);
      ensure(rel[2]!);
      const label = unquote(rel[3]!);
      relations.push(label ? { from: rel[1]!, to: rel[2]!, label } : { from: rel[1]!, to: rel[2]! });
      continue;
    }
    // standalone entity declaration: a bare entity name on its own line (no attributes/relations)
    if (ER_NAME.test(line)) ensure(line);
  }
  return { tables: [...tables.values()], relations };
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/** Parse a Mermaid string into diagram records (unpositioned — run a layout to place them). */
export function fromMermaid(src: string): ParsedMermaid {
  const lines = cleanLines(src);
  if (lines.length === 0) throw new Error('fromMermaid: empty source');
  const kind = detectKind(lines[0]!);
  if (!kind) throw new Error(`fromMermaid: unrecognized diagram header "${lines[0]}" (expected graph/flowchart, stateDiagram, or erDiagram)`);
  const direction = kind === 'flowchart' ? readDirection(lines[0]!) : 'TB';

  let records: NodusRecord[];
  let skipped = 0;
  if (kind === 'flowchart') {
    const parsed = parseFlowchart(lines);
    records = buildFlowchart(parsed);
    skipped = parsed.skipped;
  } else if (kind === 'state') records = buildStateMachine(parseStateDiagram(lines));
  else records = buildERD(parseERDiagram(lines));

  return { kind, direction, records, skipped };
}

export interface ImportMermaidOptions {
  /** Layout engine id to run after import (must be registered). Pass false to skip. Default 'elk'. */
  layout?: string | false;
  /** Override the flow direction fed to the layout engine (defaults to the diagram's own). */
  direction?: Direction;
  /** Zoom to fit after layout (default true). */
  fit?: boolean;
}

/**
 * Parse `src`, add the records to `editor`, and lay them out. Registers the diagram node types via
 * installDiagrams() if they are not already present. Returns the parse result.
 */
export async function importMermaid(editor: Editor, src: string, opts: ImportMermaidOptions = {}): Promise<ParsedMermaid> {
  const parsed = fromMermaid(src);
  if (!editor.nodes.has('process')) installDiagrams(editor);
  editor.store.apply(
    parsed.records.map((record) => ({ op: 'add', record })),
    { capture: 'immediately' }, // one undo entry for the whole import
  );
  editor.sceneIndex.rebuild(editor.store.allRecords());
  const engine = opts.layout ?? 'elk';
  if (engine) await editor.layout(engine, { direction: opts.direction ?? parsed.direction });
  if (opts.fit !== false) editor.zoomToFit(48);
  return parsed;
}

// Re-export the low-level parsers for hosts that want the intermediate spec (e.g. to tweak before build).
export { parseFlowchart, parseStateDiagram, parseERDiagram };
