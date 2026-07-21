# Canvas Signature — S4 Signature Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The "feels like a real architecture tool" details: **spotlight/focus** (selecting a node dims + desaturates everything outside its connected subgraph, and flow collapses to the active edges), a **live flow-rate numeric readout** on edges when Flow is on, and **label→icon auto-classification** (a keyword heuristic picking a node glyph from the label).

**Architecture:** All three ride existing seams — the `paintItem` override param (S1) for spotlight muting, `drawFlowEdges` for the rate pill + flow collapse, and the infra node util's `draw` for the icon fallback. Spotlight muting is a static-layer effect that depends on selection, so its focus signature is folded into the static layer-cache key (learned from S2). Nothing enters the document/undo/canonical; exports (`paintRegion`) are never spotlit or rate-labelled.

**Tech Stack:** TypeScript strict, Vitest (node — pure helpers unit-tested; the paint additions verified via cache-enabled tests + browser drive), the S1 `color.ts` helpers, the core icon registry.

## Global Constraints

- `pnpm typecheck` after every task. Pure logic (`classifyIcon`, `formatRate`, focus-set computation) is unit-tested; paint additions get cache-enabled and/or browser verification.
- **Nothing enters the document/undo/canonical.** The focus set is derived from selection (ephemeral); the rate value is a live metric; the classified icon is a draw-time fallback never written to the record. Canonical tests stay green.
- **Exports stay full-fidelity:** `paintRegion` (PNG/SVG) must NOT spotlight-mute and NOT rate-label — the diagram export shows every node bright and unlabelled-by-rate. Only the live `paintStaticInto`/`paintFlow` paths get spotlight + readout.
- **Spotlight must invalidate the static layer cache** when the focus set changes (selection change) — fold the focus signature into `staticPrefix`, or muting will blit a stale bitmap.
- `classifyIcon` returns only **registered** core glyph names (`server`, `database`, `cache`, `queue`, `balancer`, `globe`, `cloud`, `user`, `gear`, `code`, `box`, `lock`, `function`, `bucket`) or `undefined`; an unknown name silently no-ops but must be avoided.
- Reduced-motion: spotlight/readout are static (not motion) so they're unaffected; but the muted-render must not animate.

## Key seams (from the audit)
- `paintItem(ctx, item, nodes, edges, theme, present?, override?, zoom?)` — `override` shallow-merged; `{opacity: 0.3}` dims via `ctx.globalAlpha *= tokens.opacity`. Call site `editor/index.ts:1632-1635`; edge slot already used by `edgeGradientOverride` (a muted edge override REPLACES it), node slot free. `paintRegion` (`editor/index.ts:2223`) passes none.
- Focus set: `selectedAtom.peek()` → `sceneIndex.edgesForNode(nodeId): Id[]` → `sceneIndex.getItem(edgeId)?.record` → `endpointNodeId(from/to)` (module-private `editor/index.ts:207`).
- Color: `mix(color, '#808080', t)` from `packages/core/src/renderer/color.ts` (no gray helper — compose it). `ResolvedTokens` has `fill/stroke/text/glow/opacity`.
- Flow: `drawFlowEdges` (`editor/index.ts:2130`, method on Editor — has `selectedAtom`/`sceneIndex`); metric value = `this.flowMetrics.get(item.id) ?? flow.data`; `resolveFlow` returns visuals only; `FlowScale`/`FlowSpec` have no unit/format. Mirror `drawEdgeLabel` (`builtins/index.ts:48`): `route[Math.floor(route.length/2)]` + `api.measureLabel` + `api.fillRoundRect` + `api.label`.
- Static cache key: `staticPrefix` + `sceneIndex.version` (search `staticPrefix` in `editor/index.ts`; S2 folded `presentationEpoch` into it — fold the focus signature the same way).
- Icon: infra util `draw` (`preset-infra/src/nodes.ts:54`): `drawStencil(api, node, tokens, { icon: <name>, label })`. Mirror `preset-diagrams/src/types.ts:173` `(n.props.icon as string) ?? …`.

---

## File Structure
- `packages/preset-infra/src/classify-icon.ts` — CREATE: pure `classifyIcon(label)`.
- `packages/preset-infra/src/classify-icon.test.ts` — CREATE.
- `packages/preset-infra/src/nodes.ts` — MODIFY: wire the classifier into `infraNodeUtil.draw`.
- `packages/core/src/flow.ts` OR a new `packages/core/src/flow-format.ts` — CREATE `formatRate`.
- `packages/core/src/editor/index.ts` — MODIFY: rate pill in `drawFlowEdges`; `focusSet()`/`spotlightAtom`; muted override in `paintStaticInto`; focus signature in `staticPrefix`; collapse flow to focused edges.
- Tests: `flow-format.test.ts`, `editor/spotlight.test.ts` (focus-set + muted override + cache-enabled), plus a browser drive.

---

### Task 1: `classifyIcon` (label → core glyph) + wire into infra nodes

**Files:** Create `packages/preset-infra/src/classify-icon.ts` + `.test.ts`; modify `packages/preset-infra/src/nodes.ts`.

**Interfaces:**
- Produces: `export function classifyIcon(label: string | undefined): string | undefined` — lowercases the label, matches keywords to a **registered** core glyph name, else `undefined`. Mapping (first match wins; only registered names): `lambda|function|func|fn`→`function`; `queue|kafka|sqs|rabbit|topic|stream`→`queue`; `cache|redis|memcache`→`cache`; `db|database|postgres|mysql|sql|mongo|dynamo|rds`→`database`; `bucket|s3|blob|storage|object store`→`bucket`; `gateway|api|router|route|ingress|proxy|cdn|edge`→`globe`; `balancer|lb|load`→`balancer`; `auth|user|client|account|identity|login`→`user`; `lock|secret|vault|kms|security`→`lock`; `server|service|compute|ec2|vm|host|worker|backend`→`server`; `code|app|web|frontend|ui|function app`→`code`; `config|settings|gear|ops`→`gear`; `cloud`→`cloud`. No match → `undefined`.
- Wire: in `infraNodeUtil.draw`, `drawStencil(api, node, tokens, { icon: (node.props.icon as string) ?? classifyIcon(node.label) ?? KIND_ICON[kind], label: node.label ?? kind })`. So an explicit `props.icon` wins; else a label-classified glyph; else the type default. Never written to the record.

- [ ] **Step 1: Write the failing test** — `classify-icon.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { classifyIcon } from './classify-icon.js';
describe('classifyIcon', () => {
  it('maps keywords to registered core glyph names', () => {
    expect(classifyIcon('Auth Lambda')).toBe('function');
    expect(classifyIcon('Orders Queue (Kafka)')).toBe('queue');
    expect(classifyIcon('Postgres')).toBe('database');
    expect(classifyIcon('Redis cache')).toBe('cache');
    expect(classifyIcon('S3 bucket')).toBe('bucket');
    expect(classifyIcon('API Gateway')).toBe('globe');
    expect(classifyIcon('Auth service')).toBe('user'); // 'auth' matches before 'service'
  });
  it('returns undefined for no match or empty', () => {
    expect(classifyIcon('Widget 42')).toBeUndefined();
    expect(classifyIcon(undefined)).toBeUndefined();
    expect(classifyIcon('')).toBeUndefined();
  });
  it('only ever returns registered core glyph names', () => {
    const REGISTERED = new Set(['server','database','cache','queue','balancer','globe','cloud','user','gear','code','box','lock','function','bucket']);
    for (const l of ['lambda','kafka','redis','postgres','s3','gateway','load balancer','auth','vault','ec2','frontend','config','cloud','nothing']) {
      const r = classifyIcon(l);
      if (r !== undefined) expect(REGISTERED.has(r)).toBe(true);
    }
  });
});
```
- [ ] **Step 2: Run — FAIL** (module missing): `pnpm exec vitest run packages/preset-infra/src/classify-icon.test.ts`
- [ ] **Step 3: Implement** `classify-icon.ts` — an ordered array of `[RegExp, glyphName]` pairs tested against the lowercased label; return the first match's glyph or `undefined`. (Order matters: put more-specific/earlier per the mapping above — e.g. `auth` before generic `service`.)
- [ ] **Step 4: Run — PASS.** Wire into `nodes.ts` (`import { classifyIcon }`). Confirm the record is NOT mutated (draw-time only).
- [ ] **Step 5:** `pnpm typecheck` + `pnpm exec vitest run packages/preset-infra`. Report to controller.

---

### Task 2: Live flow-rate readout pill

**Files:** Create `packages/core/src/flow-format.ts` + `.test.ts`; modify `packages/core/src/editor/index.ts` (`drawFlowEdges`).

**Interfaces:**
- Produces: `export function formatRate(n: number): string` — compact: `>= 1e6`→`${(n/1e6).toFixed(1)}M`, `>= 1e3`→`${(n/1e3).toFixed(1)}k` (trim a trailing `.0`), else `Math.round(n)` as a string; negatives handled (sign preserved); non-finite → `''`.
- In `drawFlowEdges`, for each flowing edge (flow enabled — the pass already gates on that), read `const value = this.flowMetrics.get(item.id) ?? (item.record as EdgeRecord).flow?.data;` and, when `value != null && Number.isFinite(value)` and `item.route` has ≥2 points, draw a small pill at `route[Math.floor(route.length/2)]` (mirror `drawEdgeLabel`): construct a `DrawApi`, `const txt = formatRate(value)`, `const w = api.measureLabel(txt, 10) + 12`, fill a rounded-rect bg (`resolved.color ?? tokens.stroke` at reduced alpha, or `tokens.fill`), then `api.label(txt, mid, { fontSize: 10, color: <contrasting>, weight: '600' })`. Drawn AFTER the markers so it sits on top. Keep it small and legible.

- [ ] **Step 1: Write the failing test** — `flow-format.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatRate } from './flow-format.js';
describe('formatRate', () => {
  it('formats compactly', () => {
    expect(formatRate(42)).toBe('42');
    expect(formatRate(1200)).toBe('1.2k');
    expect(formatRate(1000)).toBe('1k');
    expect(formatRate(2_500_000)).toBe('2.5M');
    expect(formatRate(0)).toBe('0');
    expect(formatRate(-350)).toBe('-350');
  });
  it('handles non-finite', () => {
    expect(formatRate(NaN)).toBe('');
    expect(formatRate(Infinity)).toBe('');
  });
});
```
- [ ] **Step 2: Run — FAIL.** `pnpm exec vitest run packages/core/src/flow-format.test.ts`
- [ ] **Step 3: Implement** `flow-format.ts` (`formatRate`), then the pill in `drawFlowEdges`. Import `formatRate`. Construct a `DrawApi` per edge for the pill. Do NOT change `paintFlowMarkers` or the export path beyond what `drawFlowEdges` already does (note `drawFlowEdges` is also called from `paintRegion` with `opts.flow` — the pill will appear in an explicit flow-snapshot export, which is acceptable/desired; it does NOT appear in a normal `grid:false` export).
- [ ] **Step 4: Run — PASS** + `pnpm exec vitest run packages/core`. Typecheck.
- [ ] **Step 5:** `pnpm verify:render` (a flow sample if present renders clean). Report to controller.

---

### Task 3: Spotlight / focus (subgraph dim + desaturate)

**Files:** Modify `packages/core/src/editor/index.ts`. Test: `packages/core/src/editor/spotlight.test.ts` (create; includes a cache-enabled case).

**Interfaces:**
- Produces:
  - `readonly spotlightAtom: Atom<boolean>` (default `true`), `setSpotlight(on: boolean): void`.
  - `focusSet(): ReadonlySet<Id> | null` — `null` when `!spotlightAtom.peek()` or `selectedAtom.peek().size === 0`. Otherwise the set of: every selected id; for each selected NODE, its incident edge ids (`sceneIndex.edgesForNode(id)`) and the far-end node ids (`endpointNodeId(from/to)`). (Selected edges include their own endpoints.)
  - `paintStaticInto`: when `focus = this.focusSet()` is non-null, for each item NOT in `focus`, pass a **muted override** instead of the normal override — nodes: `{ opacity: 0.28, glow: null, fill: mixGray(t.fill), stroke: mixGray(t.stroke), text: mixGray(t.text) }` (where `t = resolveTokensCached(theme, rec)` and `mixGray(c) = mix(c, '#808080', 0.7)`); edges: `{ opacity: 0.22, glow: null, strokeGradient: undefined, stroke: mixGray(t.stroke) }` (drops the S1 gradient + dims). Focused items paint normally (their existing override).
  - `staticPrefix`: when `focusSet()` is active, append a focus signature `|sl:${[...selected].sort().join('~')}` so a selection change invalidates the static layer cache (else the muted bitmap is stale). When spotlight inactive, append nothing (base behavior).
  - `drawFlowEdges`: when `focusSet()` is non-null, SKIP glow/markers/rate-pill for edges NOT in the focus set (flow collapses to the active subgraph).
  - `paintRegion` (export): unchanged — never spotlights (exports show the full bright diagram).
- Add a private `mixGray(c: string): string { return mix(c, '#808080', 0.7); }` (import `mix` from `../renderer/color.js`).

- [ ] **Step 1: Write the failing tests** — `spotlight.test.ts` (unit + cache-enabled):
```ts
import { describe, expect, it } from 'vitest';
import { Editor } from '../index.js';
// build: A—B (edge), C isolated. Select A → focusSet = {A, edgeAB, B}, NOT C.

describe('focusSet', () => {
  it('is null with no selection or spotlight off', () => {
    const ed = new Editor({ viewport: { w: 800, h: 600 } });
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 60, h: 40 });
    expect(ed.focusSet()).toBeNull();
    ed.select([a]);
    expect(ed.focusSet()).not.toBeNull();
    ed.setSpotlight(false);
    expect(ed.focusSet()).toBeNull();
  });
  it('includes selected node + incident edges + neighbors, excludes unconnected', () => {
    const ed = new Editor({ viewport: { w: 800, h: 600 } });
    const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 60, h: 40 });
    const b = ed.createNode({ type: 'rect', x: 200, y: 0, w: 60, h: 40 });
    const c = ed.createNode({ type: 'rect', x: 0, y: 200, w: 60, h: 40 });
    const e = ed.createEdge({ from: { kind: 'node', nodeId: a }, to: { kind: 'node', nodeId: b } });
    ed.select([a]);
    const f = ed.focusSet()!;
    expect(f.has(a)).toBe(true);
    expect(f.has(e)).toBe(true);
    expect(f.has(b)).toBe(true);
    expect(f.has(c)).toBe(false);
  });
});
```
  (Adjust `createEdge` to the real editor API — read it; S2's tests used `createEdge({ from:{kind:'node',nodeId}, to:{...} })`.) For the **cache-enabled** test, mirror `packages/core/src/editor/motion-cache.test.ts`: enable the offscreen factory, render with a selection (spotlight active), then change the selection and render again, asserting the non-focused node's pixels differ (muted → un-muted) — proving the focus signature invalidates the static cache. If pixel sampling is heavy, at minimum assert `staticPrefix`-level: two different selections yield two different cache keys (expose a tiny test hook or assert via a re-render count).

- [ ] **Step 2: Run — FAIL** (`focusSet`/`setSpotlight` undefined).
- [ ] **Step 3: Implement** `spotlightAtom`/`setSpotlight`/`focusSet`/`mixGray`; the muted-override branch in `paintStaticInto`; the focus signature in `staticPrefix`; the focus filter in `drawFlowEdges`. Leave `paintRegion` untouched.
- [ ] **Step 4: Run — PASS** + `pnpm exec vitest run packages/core` (+ the layer-cache tests must stay green — no-selection = base key = normal caching). `pnpm exec vitest run -t "canonical"` unchanged.
- [ ] **Step 5:** Typecheck. `pnpm verify:render`. Report to controller.

---

## Final verification (whole plan — lead)
- [ ] `pnpm typecheck` clean; `pnpm test` whole suite green (new: `classifyIcon`, `formatRate`, `focusSet`/spotlight + cache-enabled).
- [ ] `pnpm exec vitest run -t "canonical"` — serialization unchanged.
- [ ] `pnpm verify:render` — headless PNGs regenerate clean.
- [ ] **Browser drive:** `node scripts/browser-verify.mjs` against `pnpm dev` — zero console errors. Plus a chrome-devtools/playwright screenshot showing: a selected node with its subgraph bright and the rest dimmed/desaturated; a flowing edge with a numeric rate pill; label-classified glyphs on infra nodes — sent to the user for the acceptance gate.

## Self-review notes (author)
- **Spec coverage:** spotlight/focus (dim+desaturate non-subgraph + flow collapse) → T3; live flow-rate readout → T2; label→icon → T1.
- **Invariants:** nothing enters document/undo/canonical (focus derived from selection; rate is a live metric; icon is a draw-time fallback). Exports (`paintRegion`) never spotlight/rate-label. The muted override only in `paintStaticInto`. Spotlight folds the focus signature into the static cache key (the S2 lesson) with a cache-enabled test.
- **Fast paths:** spotlight off OR no selection → `focusSet()` null → no muted override, base cache key, normal flow — exact prior behavior. `classifyIcon`/rate readout are additive fallbacks. `bolt`/`route`/etc. deliberately avoided (unregistered → no-op).
- **LOD interaction:** classified glyphs (like all glyphs) still drop below 0.5 zoom (S1 LOD) — consistent.
