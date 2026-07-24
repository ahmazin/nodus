/**
 * Regenerates the checked-in golden byte fixtures under
 * `packages/core/src/__tests__/fixtures/`.
 *
 * These fixtures PIN the on-disk canonical byte format (`toCanonicalString`) — the product moat
 * "diagrams you can code-review". `golden-fixtures.test.ts` asserts, on every PR, that restoring
 * and re-serializing each fixture reproduces its bytes EXACTLY; any byte-affecting change to
 * serialization (key order, number formatting, record sort, field omission) therefore fails CI
 * regardless of which files the PR touched.
 *
 * Regeneration is DELIBERATE, never automatic: run
 *   pnpm exec tsx scripts/gen-fixtures.ts
 * and REVIEW the resulting diff. A change that alters any fixture's bytes is a semver-BREAKING
 * change to the serialization contract and must ship with a changeset + explicit review in the
 * same PR (see apps/site/src/pages/docs/schema.md).
 *
 * Correctness rule enforced here: every fixture must be a CLEAN restore fixed-point — restoring it
 * drops nothing, repairs nothing, and raises zero issues. A fixture that tripped repair would pin
 * the *repaired* form, which is the wrong contract, so this script refuses to write one.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  deterministicIdFactory,
  restore,
  serializeRecords,
  toCanonicalString,
  type EdgeRecord,
  type NodeRecord,
  type NodusRecord,
  type PageRecord,
  type RestoreOptions,
  type Snapshot,
} from '@nodus/core';

const FIXTURES_DIR = fileURLToPath(new URL('../packages/core/src/__tests__/fixtures/', import.meta.url));

/** The SerializationIssue shape, recovered from the public onError callback (not exported by name). */
type Issue = Parameters<NonNullable<RestoreOptions['onError']>>[0];

// Explicit, human-readable ids via the deterministic factory (task #23): passing a seed makes each id
// exactly `<type>:<seed>`, so fixtures are fully reproducible and independent of any global counter.
const ids = deterministicIdFactory();
const nodeId = (seed: string) => ids.make('node', seed);
const edgeId = (seed: string) => ids.make('edge', seed);
const pageId = (seed: string) => ids.make('page', seed);

/**
 * Restore `snap` and fail loudly unless it is a clean fixed-point (zero drops / repairs / issues).
 * Returns the normalized records — the exact on-disk form we then canonicalize and write.
 */
function assertCleanRestore(name: string, snap: Snapshot): NodusRecord[] {
  const issues: Issue[] = [];
  const r = restore(snap, { onError: (i) => issues.push(i) });
  const problems: string[] = [];
  if (issues.length) problems.push(`${issues.length} issue(s) [${issues.map((i) => i.code).join(', ')}]`);
  if (r.droppedEdges) problems.push(`droppedEdges=${r.droppedEdges}`);
  if (r.migrationErrors) problems.push(`migrationErrors=${r.migrationErrors}`);
  if (r.unmigrated) problems.push(`unmigrated=${r.unmigrated}`);
  if (r.repointedPageRefs) problems.push(`repointedPageRefs=${r.repointedPageRefs}`);
  if (problems.length) {
    throw new Error(`fixture "${name}" is not a clean restore fixed-point: ${problems.join('; ')}`);
  }
  return r.records;
}

function writeFixture(name: string, records: NodusRecord[], typeVersions?: Record<string, number>): void {
  const opts = typeVersions ? { typeVersions } : undefined;
  // 1. Normalize to the on-disk fixed-point — and gate correctness (a repaired fixture is refused).
  const normalized = assertCleanRestore(name, serializeRecords(records, opts));
  // 2. Canonicalize. A non-finite number would surface here (JSON coerces it to null) — treat it as a
  //    defect too, so a fixture never silently pins a lossy coercion.
  const canonIssues: Issue[] = [];
  const bytes = toCanonicalString(serializeRecords(normalized, opts), { onError: (i) => canonIssues.push(i) });
  if (canonIssues.length) {
    throw new Error(`fixture "${name}" canonicalization raised ${canonIssues.length} issue(s) [${canonIssues.map((i) => i.code).join(', ')}]`);
  }
  writeFileSync(`${FIXTURES_DIR}${name}.nodus.json`, bytes);
  console.log(`  wrote ${name}.nodus.json  (${Buffer.byteLength(bytes)} bytes)`);
}

// ---------------------------------------------------------------------------
// Fixture builders — one per byte-contract concern.
// ---------------------------------------------------------------------------

/** (1) The empty-document envelope: exercises the `records:[]` branch of toCanonicalString. */
function minimalEnvelope(): void {
  writeFixture('01-minimal-envelope', []);
}

/** (2) Every record kind present, with a richly-populated node (props/style/meta/visual + rotation/
 *  locked/hidden/label) and both node-bound endpoint kinds on the edge. A page is present, so every
 *  node/edge carries an explicit pageId (the membership invariant). */
function allRecordKinds(): void {
  const p = pageId('p1');
  const page: PageRecord = { id: p, typeName: 'page', version: 0, name: 'Main', index: 'a0' };
  const n1: NodeRecord = {
    id: nodeId('n1'),
    typeName: 'node',
    version: 0,
    type: 'infra.service',
    x: 120,
    y: 80,
    w: 160,
    h: 64,
    rotation: 15,
    locked: true,
    z: 'a0',
    pageId: p,
    visual: { state: 'accent', overlay: 'error', focused: true },
    label: 'API Gateway',
    style: { fill: '#22d3ee', stroke: '#0e7490', strokeWidth: 1.5, dash: [4, 2], radius: 8 },
    props: { port: 8080, replicas: 3, endpoints: ['/health', '/ready'] },
    meta: { createdBy: 'seed', tags: ['public', 'edge'] },
  };
  const n2: NodeRecord = {
    id: nodeId('n2'),
    typeName: 'node',
    version: 0,
    type: 'rect',
    x: 400,
    y: 200,
    w: 100,
    h: 50,
    hidden: true,
    z: 'a1',
    pageId: p,
    visual: { state: 'solid' },
    props: {},
  };
  const e1: EdgeRecord = {
    id: edgeId('e1'),
    typeName: 'edge',
    version: 0,
    type: 'flow',
    from: { kind: 'node', nodeId: n1.id },
    to: { kind: 'outline', nodeId: n2.id },
    pageId: p,
    visual: { state: 'solid' },
    label: 'requests',
    style: { stroke: '#f59e0b', strokeWidth: 2, dash: [6, 3] },
    props: { bidirectional: false },
    meta: { protocol: 'grpc' },
  };
  writeFixture('02-all-record-kinds', [page, n1, n2, e1]);
}

/** (3) Multi-page membership: two pages, nodes/edges split across them, plus a parentId group ref.
 *  Pins that pageId resolves to a real page for every record (zero repointing). */
function pagesMembership(): void {
  const pa = pageId('pa');
  const pb = pageId('pb');
  const overview: PageRecord = { id: pa, typeName: 'page', version: 0, name: 'Overview', index: 'a0' };
  const detail: PageRecord = { id: pb, typeName: 'page', version: 0, name: 'Detail', index: 'a1' };
  const na1: NodeRecord = {
    id: nodeId('na1'), typeName: 'node', version: 0, type: 'rect',
    x: 0, y: 0, w: 100, h: 50, z: 'a0', pageId: pa, visual: { state: 'solid' }, props: {},
  };
  const na2: NodeRecord = {
    id: nodeId('na2'), typeName: 'node', version: 0, type: 'rect',
    x: 200, y: 0, w: 100, h: 50, z: 'a1', parentId: na1.id, pageId: pa, visual: { state: 'solid' }, props: {},
  };
  const nb1: NodeRecord = {
    id: nodeId('nb1'), typeName: 'node', version: 0, type: 'rect',
    x: 0, y: 0, w: 100, h: 50, z: 'a0', pageId: pb, visual: { state: 'ghost' }, props: {},
  };
  const ea: EdgeRecord = {
    id: edgeId('ea'), typeName: 'edge', version: 0, type: 'link',
    from: { kind: 'node', nodeId: na1.id }, to: { kind: 'node', nodeId: na2.id },
    pageId: pa, visual: { state: 'solid' }, props: {},
  };
  writeFixture('03-pages-membership', [overview, detail, na1, na2, nb1, ea]);
}

/** (4) typeVersions stamp: pins the per-shape `props` version block (sorted keys) that rides in the
 *  snapshot envelope. Restored WITHOUT a migration resolver, so the stamp is carried, not applied. */
function typeVersions(): void {
  const m1: NodeRecord = {
    id: nodeId('m1'), typeName: 'node', version: 0, type: 'infra.db',
    x: 40, y: 40, w: 120, h: 60, z: 'a0', visual: { state: 'solid' }, props: { engine: 'postgres', major: 16 },
  };
  const m2: NodeRecord = {
    id: nodeId('m2'), typeName: 'node', version: 0, type: 'infra.cache',
    x: 240, y: 40, w: 120, h: 60, z: 'a1', visual: { state: 'solid' }, props: { ttl: 300 },
  };
  const md: EdgeRecord = {
    id: edgeId('md'), typeName: 'edge', version: 0, type: 'flow',
    from: { kind: 'node', nodeId: m1.id }, to: { kind: 'node', nodeId: m2.id },
    visual: { state: 'solid' }, props: {},
  };
  writeFixture('04-type-versions', [m1, m2, md], { 'infra.db': 2, 'infra.cache': 1, flow: 3 });
}

/** (5) Flow: a rich per-edge FlowSpec incl. a data-driven FlowScale (domain + speed/count/size ranges
 *  + ordered color stops + gradient). Pins the nested arrays whose ORDER is meaningful. The global
 *  FlowRuntimeConfig is ephemeral/never-serialized, so only these per-edge fields reach the bytes. */
function flow(): void {
  const f1: NodeRecord = {
    id: nodeId('f1'), typeName: 'node', version: 0, type: 'rect',
    x: 0, y: 0, w: 100, h: 50, z: 'a0', visual: { state: 'solid' }, props: {},
  };
  const f2: NodeRecord = {
    id: nodeId('f2'), typeName: 'node', version: 0, type: 'rect',
    x: 300, y: 0, w: 100, h: 50, z: 'a1', visual: { state: 'solid' }, props: {},
  };
  const fe: EdgeRecord = {
    id: edgeId('fe'), typeName: 'edge', version: 0, type: 'flow',
    from: { kind: 'node', nodeId: f1.id }, to: { kind: 'node', nodeId: f2.id },
    visual: { state: 'solid' },
    flow: {
      speed: 80,
      color: '#22d3ee',
      style: 'dots',
      size: 4,
      count: 6,
      reverse: true,
      data: 42,
      scale: {
        domain: [0, 100],
        speed: [20, 120],
        count: [2, 10],
        size: [2, 6],
        colors: [
          { at: 0, color: '#22c55e' },
          { at: 50, color: '#f59e0b' },
          { at: 90, color: '#ef4444' },
        ],
        gradient: true,
      },
    },
    props: {},
  };
  writeFixture('05-flow', [f1, f2, fe]);
}

/** (6) Unicode: emoji (incl. an astral + ZWJ sequence), RTL scripts, and combining marks in labels,
 *  plus non-ASCII property KEYS spanning several scripts — pinning the code-unit key ordering that
 *  stableStringify applies (locale-independent). */
function unicodeLabels(): void {
  const u1: NodeRecord = {
    id: nodeId('u1'), typeName: 'node', version: 0, type: 'rect',
    x: 0, y: 0, w: 140, h: 60, z: 'a0', visual: { state: 'solid' },
    label: '🎉 Launch 日本語 👨‍👩‍👧',
    // Deliberately unsorted, mixed-script keys — the canonical form must sort them by UTF-16 code unit.
    props: { z: 1, a: 2, '0': 3, 'Ä': 4, 'ä': 5, '日': 6, 'ключ': 7, '😀': 8 },
  };
  const u2: NodeRecord = {
    id: nodeId('u2'), typeName: 'node', version: 0, type: 'rect',
    x: 240, y: 0, w: 140, h: 60, z: 'a1', visual: { state: 'solid' },
    label: 'שלום עולם', // Hebrew (RTL)
    props: { name: 'José café' }, // combining acute (NFD) — must NOT be normalized away
  };
  const ue: EdgeRecord = {
    id: edgeId('ue'), typeName: 'edge', version: 0, type: 'flow',
    from: { kind: 'node', nodeId: u1.id }, to: { kind: 'node', nodeId: u2.id },
    visual: { state: 'solid' },
    label: 'À́ → 流れ ←', // stacked combining marks + arrows
    props: {},
  };
  writeFixture('06-unicode-labels', [u1, u2, ue]);
}

/** (7) Number normalization: values whose canonical JSON form differs from the source literal — -0,
 *  exponential thresholds (1e21, 1e-7), integer-valued floats, and a beyond-safe-integer round.
 *  These sit in geometry fields (num-coerced), in props (passthrough), and in point-endpoint coords.
 *  The fixture already holds the COERCED form; the test proves that form is a stable fixed-point. */
function numberNormalization(): void {
  const q1: NodeRecord = {
    id: nodeId('q1'), typeName: 'node', version: 0, type: 'rect',
    x: -0, // → "0"
    y: 1e21, // → "1e+21"
    w: 0.0000001, // → "1e-7"
    h: 100.0, // integer-valued float → "100"
    z: 'a0',
    visual: { state: 'solid' },
    props: {
      negZero: -0, // → "0"
      big: 1e21, // → "1e+21"
      tiny: 1e-7, // → "1e-7"
      frac: 0.1,
      intFloat: 5.0, // → "5"
      neg: -3.5,
      small: 1.5e-10, // → "1.5e-10"
      hundred: 1e2, // → "100"
      beyondSafe: 9007199254740993, // rounds to 9007199254740992 in IEEE-754 → pins that coercion
    },
  };
  const qe: EdgeRecord = {
    id: edgeId('qe'), typeName: 'edge', version: 0, type: 'flow',
    // point endpoints carry their own coords (no node needed) — pins endpoint number coercion.
    from: { kind: 'point', x: -0, y: 1e-7 },
    to: { kind: 'point', x: 1e21, y: 0.5 },
    visual: { state: 'solid' },
    props: {},
  };
  writeFixture('07-number-normalization', [q1, qe]);
}

function main(): void {
  mkdirSync(FIXTURES_DIR, { recursive: true });
  console.log(`Regenerating golden fixtures in ${FIXTURES_DIR}`);
  minimalEnvelope();
  allRecordKinds();
  pagesMembership();
  typeVersions();
  flow();
  unicodeLabels();
  numberNormalization();
  console.log('Done. Review the diff — a byte change is a BREAKING serialization change.');
}

main();
