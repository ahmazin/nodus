# Flow Authoring UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-edge flow authoring to `@nodus-dev/react` across two surfaces — a rich Properties-panel Flow section (full `FlowSpec` + data-driven `FlowScale`) and context-menu quick-toggles — at an elevated polish bar, with no core changes.

**Architecture:** Two new React modules in `packages/react/src`. `flow-controls.tsx` owns `<FlowControls>` (basic `FlowSpec` controls + an animated CSS preview strip + the Advanced disclosure) plus the shared `DEFAULT_FLOW`/`DEFAULT_SCALE` constants and patch helpers. `flow-scale-editor.tsx` owns the pure, unit-tested `buildRampCss` helper and `<FlowScaleEditor>` (the color-stop ramp with draggable handles, the three visual ranges, the stops list, and the live metric scrubber). `Properties` renders `<FlowControls>` below the Style section; `contextMenuItems` gains a flow group in its edge branch. All writes go through the existing `editor.setFlow(ids, spec|null, {capture})` + `editor.mark()` undo-batching pattern; live metric preview uses ephemeral `editor.setFlowMetric(id, value)`.

**Tech Stack:** React 18 (function components, hooks), TypeScript (NodeNext, `.js` import specifiers), inline `CSSProperties` styling (no CSS files), Vitest (node env, pure-function unit tests only — no DOM), `playwright-core` headless Chromium for browser E2E.

## Global Constraints

- **No core changes.** The core API from sub-projects ①/③ is sufficient: `editor.setFlow`, `editor.setFlowMetric`, `editor.flowMetric`, `editor.store.peek`, `editor.mark`, and the exported `colorForValue`/`resolveFlow`/`resolveTokens` from `@nodus-dev/core`. Do not edit anything under `packages/core`.
- **Palette (reuse verbatim, add ONE accent):** `--bg #0d1310`, `--field-bg #12161c`, `--border #28322c`, `--text #cdd5d0`, `--row-label #8b958f`, `--micro-label #556058`, and the ONE new flow accent `--flow #2dd4bf` (teal). Threshold stop defaults: `#22c55e` / `#f59e0b` / `#ef4444`.
- **Font:** `ui-monospace, monospace`, base `fontSize: 12`; uppercase micro-labels `fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase'`.
- **Undo batching:** continuous controls (sliders, color pickers, draggable ramp handles) call the mutation with `{ capture: 'later' }` on `onChange`/drag-move and `editor.mark()` on `onPointerUp`/`onBlur`. Discrete controls (checkbox, select, add/remove button) mutate and `mark()` synchronously in the same handler (or rely on `setFlow`'s default `capture: 'immediately'`).
- **Ephemeral state never touches history:** `setFlowMetric` (the scrubber) must NOT be wrapped in `capture`/`mark`.
- **Multi-select model:** display the FIRST selected edge's values; apply every write to ALL selected edge ids.
- **Edge-only:** flow applies to edges. When the selection contains no edge, `<FlowControls>` renders nothing.
- **A11y / motion:** every control keyboard-operable with visible focus; ramp handles have numeric `at` + color-picker fallbacks; the preview animation and the disclosure height/chevron transitions respect `prefers-reduced-motion` (pure CSS media query — a static frame under reduce).
- **Tests must be `.test.ts`** (the Vitest glob is `packages/**/*.test.ts`; `.test.tsx` is silently ignored). No DOM env is configured, so react unit tests must be pure functions only (`buildRampCss`).
- **Import specifiers use `.js`** even for `.tsx` sources (NodeNext/tsup convention used throughout the barrel).

---

## Reference: exact core types (already exist, do not redefine)

```ts
// @nodus-dev/core — packages/core/src/model.ts
interface FlowColorStop { at: number; color: string }
interface FlowScale {
  domain: [number, number];
  speed?: [number, number];
  count?: [number, number];
  size?: [number, number];
  colors?: FlowColorStop[];
  gradient?: boolean;
}
interface FlowSpec {
  speed?: number; color?: string; style?: 'dots' | 'dash';
  size?: number; count?: number; reverse?: boolean;
  scale?: FlowScale; data?: number;
}
interface EdgeRecord extends BaseRecord<'edge'> { /* ...; */ flow?: FlowSpec }

// Editor methods (packages/core/src/editor/index.ts)
setFlow(ids: Id[], flow: FlowSpec | null, opts?: { capture?: 'immediately'|'later'|'never' }): void
setFlowMetric(id: Id, value: number): void
flowMetric(id: Id): number | undefined
store.peek(id: Id): NodusRecord | undefined
mark(): void
themeAtom.peek(): Theme
// exported helpers:
resolveTokens(theme, visual, type, style): { stroke: string; strokeWidth?: number; ... }
colorForValue(scale: FlowScale, value: number): string | undefined
resolveFlow(flow: FlowSpec, metric?: number): FlowSpec
```

## File structure

- **Create** `packages/react/src/flow-controls.tsx` — `DEFAULT_FLOW`, `DEFAULT_SCALE`, shared flow style constants, the `<FlowControls>` component (basic `FlowSpec` controls + animated preview strip + Advanced disclosure that mounts `<FlowScaleEditor>`), the injected keyframe `<style>`, and the flow patch helpers.
- **Create** `packages/react/src/flow-scale-editor.tsx` — the pure `buildRampCss(stops, domain, gradient)` helper (exported) and the `<FlowScaleEditor>` component (color-stop ramp with draggable handles, Domain, three visual ranges, Gradient, the stops list, and the metric scrubber).
- **Create** `packages/react/src/__tests__/flow-controls.test.ts` — Vitest unit tests for `buildRampCss` and the shape of `DEFAULT_FLOW`/`DEFAULT_SCALE`.
- **Modify** `packages/react/src/properties.tsx` — render `<FlowControls editor={editor} ids={ids} />` at the end of the panel.
- **Modify** `packages/react/src/context-menu.tsx` — import `DEFAULT_FLOW` + types; add the flow quick-toggle group to the `edge` branch.
- **Modify** `packages/react/src/index.tsx` — export `FlowControls`, `DEFAULT_FLOW`, `DEFAULT_SCALE`, `FlowControlsProps` (from flow-controls) and `buildRampCss`, `FlowScaleEditor` (from flow-scale-editor).
- **Modify** `scripts/browser-verify.mjs` — add the flow authoring E2E checks (Task 4).

**DEVIATION FROM SPEC (intentional, flagged):** the spec's file-structure note places `DEFAULT_FLOW` in `context-menu.tsx`. This plan co-locates `DEFAULT_FLOW` and `DEFAULT_SCALE` in `flow-controls.tsx` (both are flow-authoring constants) and has `context-menu.tsx` import `DEFAULT_FLOW` from `./flow-controls.js`. This removes a task-ordering hazard (Task 1's `FlowControls` needs `DEFAULT_FLOW` before Task 3 runs) and keeps the two flow defaults together. The barrel still exports `DEFAULT_FLOW`. No import cycle results (`flow-controls` imports only `@nodus-dev/core`; `context-menu` imports from `flow-controls`, not vice-versa).

---

### Task 1: FlowControls scaffold — basic FlowSpec controls, animated preview strip, Properties wiring

**Files:**
- Create: `packages/react/src/flow-controls.tsx`
- Modify: `packages/react/src/properties.tsx:91` (insert `<FlowControls>` before the closing `</div>`)
- Modify: `packages/react/src/index.tsx:310` (add barrel export line after the Properties export)

**Interfaces:**
- Produces (consumed by later tasks):
  - `export const DEFAULT_FLOW: FlowSpec = { style: 'dots', speed: 70, size: 3 }`
  - `export const DEFAULT_SCALE: FlowScale = { domain: [0, 100], colors: [{ at: 0, color: '#22c55e' }, { at: 60, color: '#f59e0b' }, { at: 85, color: '#ef4444' }] }`
  - `export interface FlowControlsProps { editor: Editor; ids: Id[] }`
  - `export function FlowControls(props: FlowControlsProps): ReactElement | null`
  - Shared style constants (module-level) reused by `flow-scale-editor.tsx`: `flowRow`, `flowMicro`, `flowField`, `numField`, `swatch`, `FLOW`, `BORDER`, `FIELD_BG`, `TEXT`, `ROW_LABEL`, `MICRO`, `BG` — and the `flowRow(label, control)` render helper is inlined per-file (do not export closures).
- Consumes from later tasks: in Step for the disclosure, `FlowControls` will import `FlowScaleEditor` from `./flow-scale-editor.js` — that import is added in **Task 2**. In Task 1 the Advanced disclosure section is present but its body is a placeholder `null` (wired in Task 2). Do not block Task 1 on Task 2.

- [ ] **Step 1: Create `flow-controls.tsx` with constants, helpers, keyframes, and the basic component.**

```tsx
/** Per-edge flow authoring — a Flow section for the Properties panel. Basic FlowSpec controls +
 *  an animated preview strip; an Advanced disclosure (Task 2) holds the data-driven scale editor. */
import { useEffect, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { resolveTokens, type Editor, type EdgeRecord, type FlowScale, type FlowSpec, type Id } from '@nodus-dev/core';

// ---- flow-authoring defaults (shared with context-menu.tsx) ----
export const DEFAULT_FLOW: FlowSpec = { style: 'dots', speed: 70, size: 3 };
export const DEFAULT_SCALE: FlowScale = {
  domain: [0, 100],
  colors: [
    { at: 0, color: '#22c55e' },
    { at: 60, color: '#f59e0b' },
    { at: 85, color: '#ef4444' },
  ],
};

// ---- palette (inherit the panel; add ONE flow accent) ----
export const BG = '#0d1310';
export const FIELD_BG = '#12161c';
export const BORDER = '#28322c';
export const TEXT = '#cdd5d0';
export const ROW_LABEL = '#8b958f';
export const MICRO = '#556058';
export const FLOW = '#2dd4bf'; // teal — "live signal"

export const flowRowCss: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 26 };
export const flowMicro: CSSProperties = { fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: MICRO };
export const swatch: CSSProperties = { width: 34, height: 20, padding: 0, border: `1px solid ${BORDER}`, background: 'transparent', borderRadius: 4 };
export const flowSelect: CSSProperties = { background: FIELD_BG, color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 5, fontSize: 12, padding: '2px 4px' };
export const numField: CSSProperties = { width: 52, background: FIELD_BG, color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 5, fontSize: 11.5, padding: '2px 4px' };
export const ghostBtn: CSSProperties = { background: FIELD_BG, color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '3px 7px', fontSize: 11, cursor: 'pointer' };

// One injected stylesheet: preview keyframes + a reduced-motion kill-switch for preview + disclosure.
export const FLOW_STYLE = `
@keyframes nodus-flow-dots { from { transform: translateX(0) } to { transform: translateX(var(--nodus-flow-shift, 0px)) } }
@keyframes nodus-flow-dash { from { background-position-x: 0px } to { background-position-x: var(--nodus-flow-shift, 0px) } }
@media (prefers-reduced-motion: reduce) {
  .nodus-flow-anim { animation: none !important }
  .nodus-flow-disc { transition: none !important }
  .nodus-flow-chevron { transition: none !important }
}
`;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export interface FlowControlsProps {
  editor: Editor;
  ids: Id[];
}

export function FlowControls({ editor, ids }: FlowControlsProps): ReactElement | null {
  const edgeIds = ids.filter((id) => editor.store.peek(id)?.typeName === 'edge');
  const first = edgeIds[0];
  const [advOpen, setAdvOpen] = useState(false);
  if (!first) return null;

  const rec = editor.store.peek(first) as EdgeRecord | undefined;
  const flow = rec?.flow;
  const on = !!flow;

  // display-first / apply-to-all: read the first edge's flow, merge a patch, write to all edges.
  const patch = (p: Partial<FlowSpec>, capture: 'later' | 'immediately' = 'later'): void => {
    const cur = (editor.store.peek(first) as EdgeRecord | undefined)?.flow ?? {};
    const next: FlowSpec = { ...cur };
    for (const k of Object.keys(p) as (keyof FlowSpec)[]) {
      const v = p[k];
      if (v === undefined) delete next[k];
      else (next as Record<string, unknown>)[k] = v;
    }
    editor.setFlow(edgeIds, next, { capture });
  };
  const commit = (): void => editor.mark();
  const setFlowOnOff = (enabled: boolean): void => editor.setFlow(edgeIds, enabled ? DEFAULT_FLOW : null);

  const row = (label: string, control: ReactNode): ReactElement => (
    <label style={flowRowCss}>
      <span style={{ color: ROW_LABEL }}>{label}</span>
      {control}
    </label>
  );

  const style = flow?.style ?? 'dots';

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${BORDER}` }}>
      <style>{FLOW_STYLE}</style>
      <div style={{ ...flowMicro, marginBottom: 8 }}>
        Flow · {edgeIds.length} edge{edgeIds.length === 1 ? '' : 's'}
      </div>

      {/* signature: live preview strip (basic mode). Data-driven ramp is swapped in during Task 2. */}
      <FlowPreview editor={editor} edgeId={first} flow={flow} />

      {row(
        'Animate',
        <input
          data-testid="flow-animate"
          type="checkbox"
          checked={on}
          onChange={(e) => setFlowOnOff(e.target.checked)}
        />,
      )}

      {on && (
        <>
          {row(
            'Style',
            <select
              data-testid="flow-style"
              value={style}
              onChange={(e) => { patch({ style: e.target.value as FlowSpec['style'] }, 'immediately'); }}
              style={flowSelect}
            >
              <option value="dots">dots</option>
              <option value="dash">dash</option>
            </select>,
          )}
          {row(
            'Speed',
            <input
              data-testid="flow-speed"
              type="range" min={10} max={200} step={1}
              value={flow?.speed ?? 70}
              onChange={(e) => patch({ speed: Number(e.target.value) })}
              onPointerUp={commit} onBlur={commit}
            />,
          )}
          {row(
            'Size',
            <input
              data-testid="flow-size"
              type="range" min={1} max={12} step={0.5}
              value={flow?.size ?? 3}
              onChange={(e) => patch({ size: Number(e.target.value) })}
              onPointerUp={commit} onBlur={commit}
            />,
          )}
          {style === 'dots' && row(
            'Count',
            <input
              data-testid="flow-count"
              type="range" min={1} max={30} step={1}
              value={flow?.count ?? 8}
              onChange={(e) => patch({ count: Number(e.target.value) })}
              onPointerUp={commit} onBlur={commit}
            />,
          )}
          {row(
            'Reverse',
            <input
              data-testid="flow-reverse"
              type="checkbox"
              checked={!!flow?.reverse}
              onChange={(e) => patch({ reverse: e.target.checked }, 'immediately')}
            />,
          )}
          {row(
            'Color',
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                data-testid="flow-color"
                type="color"
                value={flow?.color && /^#[0-9a-f]{6}$/i.test(flow.color) ? flow.color : resolvedStroke(editor, first)}
                onChange={(e) => patch({ color: e.target.value })}
                onBlur={commit}
                style={swatch}
              />
              <button
                data-testid="flow-color-reset"
                title="Reset to edge stroke"
                style={ghostBtn}
                onClick={() => patch({ color: undefined }, 'immediately')}
              >
                reset
              </button>
            </span>,
          )}

          {/* Advanced / data-driven disclosure. Chevron rotates; grid-rows animates height. */}
          <button
            data-testid="flow-advanced-toggle"
            onClick={() => setAdvOpen((v) => !v)}
            style={{ ...flowMicro, display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 0, padding: '6px 0 4px', cursor: 'pointer', width: '100%' }}
          >
            <span className="nodus-flow-chevron" style={{ transition: 'transform 160ms ease', transform: advOpen ? 'rotate(90deg)' : 'rotate(0deg)', color: FLOW }}>▸</span>
            Advanced · data-driven
          </button>
          <div className="nodus-flow-disc" style={{ display: 'grid', gridTemplateRows: advOpen ? '1fr' : '0fr', transition: 'grid-template-rows 180ms ease' }}>
            <div style={{ overflow: 'hidden' }}>
              {/* Task 2 renders <FlowScaleEditor editor={editor} edgeIds={edgeIds} firstEdge={first} /> here. */}
              {null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// resolved edge stroke — the fallback color the renderer uses when flow.color is unset.
export function resolvedStroke(editor: Editor, edgeId: Id): string {
  const rec = editor.store.peek(edgeId) as EdgeRecord | undefined;
  if (!rec) return '#7a8a80';
  try {
    const t = resolveTokens(editor.themeAtom.peek(), rec.visual, rec.type, rec.style);
    return t.stroke ?? '#7a8a80';
  } catch {
    return '#7a8a80';
  }
}

// ---- signature: the animated preview strip (basic mode) ----
function FlowPreview({ editor, edgeId, flow }: { editor: Editor; edgeId: Id; flow: FlowSpec | undefined }): ReactElement {
  const track: CSSProperties = {
    position: 'relative', width: '100%', height: 24, marginBottom: 8, borderRadius: 6,
    border: `1px solid ${BORDER}`, background: 'linear-gradient(#0a0f0c, #0a0f0c)', overflow: 'hidden',
  };
  if (!flow) {
    return <div style={{ ...track, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MICRO, fontSize: 10.5 }}>flow off</div>;
  }
  const color = flow.color && /^#[0-9a-f]{6}$/i.test(flow.color) ? flow.color : resolvedStroke(editor, edgeId);
  const speed = clamp(flow.speed ?? 70, 1, 400);
  const reverse = !!flow.reverse;

  if (flow.style === 'dash') {
    const lineW = clamp(flow.size ?? 1.5, 1, 8);
    const dashLen = clamp((flow.size ?? 6) * 2, 4, 40);
    const period = dashLen * 2;
    const dur = clamp(period / speed, 0.15, 4);
    return (
      <div style={track}>
        <div
          className="nodus-flow-anim"
          style={{
            position: 'absolute', top: '50%', left: 0, right: 0, height: lineW, transform: 'translateY(-50%)',
            backgroundImage: `repeating-linear-gradient(90deg, ${color} 0, ${color} ${dashLen}px, transparent ${dashLen}px, transparent ${period}px)`,
            animation: `nodus-flow-dash ${dur}s linear infinite`,
            ['--nodus-flow-shift' as string]: `${reverse ? -period : period}px`,
          }}
        />
      </div>
    );
  }
  // dots
  const r = clamp(flow.size ?? 3, 1, 8);
  const count = clamp(Math.round(flow.count ?? 8), 1, 30);
  const spacing = clamp(180 / count, 8, 60);
  const dur = clamp(spacing / speed, 0.12, 3);
  const dots: ReactElement[] = [];
  for (let i = 0; i < count + 2; i++) {
    dots.push(
      <span key={i} style={{
        position: 'absolute', top: '50%', left: i * spacing, width: r * 2, height: r * 2, marginTop: -r, marginLeft: -r,
        borderRadius: '50%', background: color, filter: `drop-shadow(0 0 ${r * 2.5}px ${color})`,
      }} />,
    );
  }
  return (
    <div style={track}>
      <div
        className="nodus-flow-anim"
        style={{
          position: 'absolute', top: 0, bottom: 0, left: 0, width: '200%',
          animation: `nodus-flow-dots ${dur}s linear infinite`,
          ['--nodus-flow-shift' as string]: `${reverse ? -spacing : spacing}px`,
        }}
      >
        {dots}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire `<FlowControls>` into `Properties`.** In `packages/react/src/properties.tsx`, add the import and render the component at the end of the panel.

Add to the imports (after line 4):
```tsx
import { FlowControls } from './flow-controls.js';
```
Insert `<FlowControls editor={editor} ids={ids} />` immediately BEFORE the closing `</div>` of the panel (currently line 91, after the `Clear style` `<button>`):
```tsx
      <button style={btn} onClick={() => { editor.clearStyle(ids, { capture: 'later' }); commit(); }}>
        Clear style
      </button>
      <FlowControls editor={editor} ids={ids} />
    </div>
```

- [ ] **Step 3: Export from the barrel.** In `packages/react/src/index.tsx`, add after the `Properties` export (line 310):
```tsx
export { FlowControls, DEFAULT_FLOW, DEFAULT_SCALE, type FlowControlsProps } from './flow-controls.js';
```

- [ ] **Step 4: Typecheck + build.**

Run: `cd /home/ali/workspaces/InfraCanvas && pnpm typecheck`
Expected: PASS (no type errors). If `resolveTokens`/`EdgeRecord` aren't exported from `@nodus-dev/core`, verify the export names with `grep -n "export" packages/core/src/index.ts` and adjust the import — do NOT add core exports (they already exist; substrate.test.ts imports `resolveTokens`).

Run: `cd /home/ali/workspaces/InfraCanvas && pnpm --filter @nodus-dev/react build`
Expected: tsup build succeeds.

- [ ] **Step 5: Commit.**
```bash
git add packages/react/src/flow-controls.tsx packages/react/src/properties.tsx packages/react/src/index.tsx
git commit -m "feat(react): FlowControls — basic FlowSpec authoring + animated preview strip

Adds a Flow section to the Properties panel for edges: Animate on/off,
style (dots/dash), speed/size/count sliders, reverse, and color with reset.
A pure-CSS preview strip renders live packets/dashes reflecting the spec and
freezes under prefers-reduced-motion. Sub-project 2 of configurable live flow.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Acceptance:** Selecting an edge shows a Flow section below Style. Toggling Animate adds/removes `flow` on all selected edges (undoable in one step). Style/Speed/Size/Count/Reverse/Color edit the spec; a slider drag is one undo entry. The preview strip animates dots or dashes matching the spec; Count row hidden for `dash`. No typecheck/build errors.

---

### Task 2: buildRampCss (TDD) + FlowScaleEditor — data-driven scale authoring

**Files:**
- Create: `packages/react/src/flow-scale-editor.tsx`
- Create: `packages/react/src/__tests__/flow-controls.test.ts`
- Modify: `packages/react/src/flow-controls.tsx` (add the `FlowScaleEditor` import + swap the disclosure placeholder + swap the preview strip to the ramp when data-driven)
- Modify: `packages/react/src/index.tsx` (export `buildRampCss`, `FlowScaleEditor`)

**Interfaces:**
- Consumes: `DEFAULT_SCALE`, palette constants, `numField`, `swatch`, `ghostBtn`, `flowRowCss`, `flowMicro` from `./flow-controls.js`; `colorForValue` from `@nodus-dev/core`.
- Produces:
  - `export function buildRampCss(stops: FlowColorStop[], domain: [number, number], gradient?: boolean): string`
  - `export interface FlowScaleEditorProps { editor: Editor; edgeIds: Id[]; firstEdge: Id }`
  - `export function FlowScaleEditor(props: FlowScaleEditorProps): ReactElement`

- [ ] **Step 1: Write the failing test** — `packages/react/src/__tests__/flow-controls.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildRampCss, DEFAULT_FLOW, DEFAULT_SCALE } from '@nodus-dev/react';

describe('buildRampCss', () => {
  it('emits one CSS stop per color at normalized positions (gradient)', () => {
    expect(
      buildRampCss([{ at: 0, color: '#00ff00' }, { at: 50, color: '#ffff00' }, { at: 100, color: '#ff0000' }], [0, 100], true),
    ).toBe('linear-gradient(90deg, #00ff00 0%, #ffff00 50%, #ff0000 100%)');
  });

  it('emits doubled boundaries with 0%/100% bookends (stepped)', () => {
    expect(
      buildRampCss([{ at: 0, color: '#22c55e' }, { at: 50, color: '#f59e0b' }, { at: 80, color: '#ef4444' }], [0, 100], false),
    ).toBe('linear-gradient(90deg, #22c55e 0%, #22c55e 50%, #f59e0b 50%, #f59e0b 80%, #ef4444 80%, #ef4444 100%)');
  });

  it('sorts stops ascending by at before building', () => {
    expect(
      buildRampCss([{ at: 80, color: '#ef4444' }, { at: 0, color: '#22c55e' }, { at: 50, color: '#f59e0b' }], [0, 100], true),
    ).toBe('linear-gradient(90deg, #22c55e 0%, #f59e0b 50%, #ef4444 80%)');
  });

  it('clamps out-of-domain stop positions to [0,100]%', () => {
    expect(
      buildRampCss([{ at: -20, color: '#00ff00' }, { at: 150, color: '#ff0000' }], [0, 100], true),
    ).toBe('linear-gradient(90deg, #00ff00 0%, #ff0000 100%)');
  });

  it('renders a single stop as a solid fill and no stops as transparent', () => {
    expect(buildRampCss([{ at: 40, color: '#2dd4bf' }], [0, 100], true)).toBe('linear-gradient(90deg, #2dd4bf 0%, #2dd4bf 100%)');
    expect(buildRampCss([], [0, 100], true)).toBe('transparent');
  });

  it('guards a zero-width domain', () => {
    expect(buildRampCss([{ at: 5, color: '#111111' }, { at: 5, color: '#222222' }], [5, 5], true)).toBe('linear-gradient(90deg, #111111 0%, #222222 0%)');
  });
});

describe('flow defaults', () => {
  it('DEFAULT_FLOW is dots at speed 70 size 3', () => {
    expect(DEFAULT_FLOW).toEqual({ style: 'dots', speed: 70, size: 3 });
  });
  it('DEFAULT_SCALE spans [0,100] with three threshold stops', () => {
    expect(DEFAULT_SCALE.domain).toEqual([0, 100]);
    expect(DEFAULT_SCALE.colors).toEqual([
      { at: 0, color: '#22c55e' },
      { at: 60, color: '#f59e0b' },
      { at: 85, color: '#ef4444' },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `cd /home/ali/workspaces/InfraCanvas && pnpm exec vitest run packages/react/src/__tests__/flow-controls.test.ts`
Expected: FAIL — `buildRampCss` is not exported from `@nodus-dev/react` (import error / undefined).

- [ ] **Step 3: Create `flow-scale-editor.tsx` with `buildRampCss` + `FlowScaleEditor`.**

```tsx
/** Data-driven flow scale authoring: the color-stop ramp (draggable handles), Domain, the three
 *  visual ranges, Gradient, the stops list, and the live metric scrubber. */
import { useEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { colorForValue, type Editor, type EdgeRecord, type FlowColorStop, type FlowScale, type FlowSpec, type Id } from '@nodus-dev/core';
import { BORDER, DEFAULT_SCALE, FIELD_BG, FLOW, flowMicro, flowRowCss, ghostBtn, MICRO, numField, ROW_LABEL, swatch, TEXT } from './flow-controls.js';

/** Pure: build a CSS `background` string for the ramp. gradient=true → one stop per color;
 *  gradient=false → stepped bands (doubled boundaries) matching colorForValue's floor rule. */
export function buildRampCss(stops: FlowColorStop[], domain: [number, number], gradient = false): string {
  const [min, max] = domain;
  const span = max - min;
  const pct = (at: number): number => {
    const p = span === 0 ? 0 : (at - min) / span;
    const c = p < 0 ? 0 : p > 1 ? 1 : p;
    return +(c * 100).toFixed(2);
  };
  const sorted = [...stops].sort((a, b) => a.at - b.at);
  if (sorted.length === 0) return 'transparent';
  if (sorted.length === 1) return `linear-gradient(90deg, ${sorted[0]!.color} 0%, ${sorted[0]!.color} 100%)`;
  if (gradient) {
    return `linear-gradient(90deg, ${sorted.map((s) => `${s.color} ${pct(s.at)}%`).join(', ')})`;
  }
  const parts: string[] = [`${sorted[0]!.color} 0%`];
  for (let i = 1; i < sorted.length; i++) {
    const p = pct(sorted[i]!.at);
    parts.push(`${sorted[i - 1]!.color} ${p}%`);
    parts.push(`${sorted[i]!.color} ${p}%`);
  }
  parts.push(`${sorted[sorted.length - 1]!.color} 100%`);
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const isHex6 = (c: string): boolean => /^#[0-9a-f]{6}$/i.test(c);

export interface FlowScaleEditorProps {
  editor: Editor;
  edgeIds: Id[];
  firstEdge: Id;
}

export function FlowScaleEditor({ editor, edgeIds, firstEdge }: FlowScaleEditorProps): ReactElement {
  const rec = editor.store.peek(firstEdge) as EdgeRecord | undefined;
  const flow = rec?.flow ?? {};
  const scale = flow.scale;

  // ---- scale write helpers (display-first / apply-to-all, undo-batched) ----
  const writeScale = (next: FlowScale | undefined, capture: 'later' | 'immediately'): void => {
    const cur = (editor.store.peek(firstEdge) as EdgeRecord | undefined)?.flow ?? {};
    const merged: FlowSpec = { ...cur };
    if (next === undefined) delete merged.scale;
    else merged.scale = next;
    editor.setFlow(edgeIds, merged, { capture });
  };
  const patchScale = (p: Partial<FlowScale>, capture: 'later' | 'immediately' = 'later'): void => {
    const base = (((editor.store.peek(firstEdge) as EdgeRecord | undefined)?.flow?.scale) ?? DEFAULT_SCALE);
    const next: FlowScale = { ...base };
    for (const k of Object.keys(p) as (keyof FlowScale)[]) {
      const v = p[k];
      if (v === undefined) delete next[k];
      else (next as Record<string, unknown>)[k] = v;
    }
    writeScale(next, capture);
  };
  const commit = (): void => editor.mark();

  const row = (label: string, control: ReactNode): ReactElement => (
    <label style={flowRowCss}><span style={{ color: ROW_LABEL }}>{label}</span>{control}</label>
  );

  // ---- Data-driven master toggle ----
  const dataOn = !!scale;
  const domain: [number, number] = scale?.domain ?? DEFAULT_SCALE.domain;

  return (
    <div style={{ marginTop: 4 }}>
      {row(
        'Data-driven',
        <input
          data-testid="flow-datadriven"
          type="checkbox"
          checked={dataOn}
          onChange={(e) => writeScale(e.target.checked ? DEFAULT_SCALE : undefined, 'immediately')}
        />,
      )}

      {dataOn && scale && (
        <>
          <RampStrip editor={editor} edgeIds={edgeIds} firstEdge={firstEdge} scale={scale} onDrag={patchScale} onCommit={commit} />

          {row(
            'Domain',
            <span style={{ display: 'flex', gap: 6 }}>
              <input data-testid="flow-domain-min" type="number" style={numField} value={domain[0]}
                onChange={(e) => patchScale({ domain: [Number(e.target.value), domain[1]] })} onBlur={commit} />
              <input data-testid="flow-domain-max" type="number" style={numField} value={domain[1]}
                onChange={(e) => patchScale({ domain: [domain[0], Number(e.target.value)] })} onBlur={commit} />
            </span>,
          )}

          <RangeRow label="Speed range" testid="speed" value={scale.speed} fallback={[40, 120]}
            onToggle={(v) => patchScale({ speed: v }, 'immediately')} onEdit={(v) => patchScale({ speed: v })} onCommit={commit} />
          <RangeRow label="Count range" testid="count" value={scale.count} fallback={[2, 16]}
            onToggle={(v) => patchScale({ count: v }, 'immediately')} onEdit={(v) => patchScale({ count: v })} onCommit={commit} />
          <RangeRow label="Size range" testid="size" value={scale.size} fallback={[2, 6]}
            onToggle={(v) => patchScale({ size: v }, 'immediately')} onEdit={(v) => patchScale({ size: v })} onCommit={commit} />

          {row(
            'Gradient',
            <input data-testid="flow-gradient" type="checkbox" checked={!!scale.gradient}
              onChange={(e) => patchScale({ gradient: e.target.checked }, 'immediately')} />,
          )}

          <StopsList scale={scale} domain={domain} onChange={(colors, capture) => patchScale({ colors }, capture)} onCommit={commit} />

          <MetricScrubber editor={editor} edgeIds={edgeIds} firstEdge={firstEdge} domain={domain} />
        </>
      )}
    </div>
  );
}

// ---- the color-stop ramp with draggable handles (signature, data-driven mode) ----
function RampStrip({ editor, firstEdge, scale, onDrag, onCommit }: {
  editor: Editor; edgeIds: Id[]; firstEdge: Id; scale: FlowScale;
  onDrag: (p: Partial<FlowScale>, capture?: 'later' | 'immediately') => void; onCommit: () => void;
}): ReactElement {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [min, max] = scale.domain;
  const span = max - min || 1;
  const stops = scale.colors ?? [];
  const pos = (at: number): number => clamp((at - min) / span, 0, 1) * 100;

  const onPointerMove = (e: PointerEvent): void => {
    if (dragIdx == null || !barRef.current) return;
    const r = barRef.current.getBoundingClientRect();
    const frac = clamp((e.clientX - r.left) / r.width, 0, 1);
    const at = +(min + frac * span).toFixed(2);
    const next = stops.map((s, i) => (i === dragIdx ? { ...s, at } : s));
    onDrag({ colors: next }, 'later');
  };
  const onPointerUp = (): void => { setDragIdx(null); onCommit(); };

  useEffect(() => {
    if (dragIdx == null) return;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [dragIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ marginBottom: 8 }}>
      <div
        ref={barRef}
        data-testid="flow-ramp"
        style={{ position: 'relative', width: '100%', height: 24, borderRadius: 6, border: `1px solid ${BORDER}`, background: buildRampCss(stops, scale.domain, scale.gradient) }}
      >
        {stops.map((s, i) => (
          <span
            key={i}
            data-testid={`flow-ramp-handle-${i}`}
            onPointerDown={(e) => { e.preventDefault(); setDragIdx(i); }}
            title={`${s.at}`}
            style={{
              position: 'absolute', top: -3, left: `${pos(s.at)}%`, width: 10, height: 30, transform: 'translateX(-50%)',
              borderRadius: 3, border: `1.5px solid ${FLOW}`, background: isHex6(s.color) ? s.color : '#000', cursor: 'ew-resize', boxSizing: 'border-box',
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ---- enable + [lo][hi] for a scale visual range (speed/count/size) ----
function RangeRow({ label, testid, value, fallback, onToggle, onEdit, onCommit }: {
  label: string; testid: string; value: [number, number] | undefined; fallback: [number, number];
  onToggle: (v: [number, number] | undefined) => void; onEdit: (v: [number, number]) => void; onCommit: () => void;
}): ReactElement {
  const on = !!value;
  const v = value ?? fallback;
  return (
    <label style={flowRowCss}>
      <span style={{ color: ROW_LABEL }}>{label}</span>
      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input data-testid={`flow-range-${testid}`} type="checkbox" checked={on}
          onChange={(e) => onToggle(e.target.checked ? fallback : undefined)} />
        <input type="number" style={{ ...numField, opacity: on ? 1 : 0.4 }} value={v[0]} disabled={!on}
          onChange={(e) => onEdit([Number(e.target.value), v[1]])} onBlur={onCommit} />
        <input type="number" style={{ ...numField, opacity: on ? 1 : 0.4 }} value={v[1]} disabled={!on}
          onChange={(e) => onEdit([v[0], Number(e.target.value)])} onBlur={onCommit} />
      </span>
    </label>
  );
}

// ---- color stops list (sorted by at; add / edit at / edit color / remove) ----
function StopsList({ scale, domain, onChange, onCommit }: {
  scale: FlowScale; domain: [number, number];
  onChange: (colors: FlowColorStop[], capture?: 'later' | 'immediately') => void; onCommit: () => void;
}): ReactElement {
  const [min, max] = domain;
  const stops = [...(scale.colors ?? [])].sort((a, b) => a.at - b.at);
  const editAt = (i: number, at: number): void => {
    const next = stops.map((s, j) => (j === i ? { ...s, at: clamp(at, min, max) } : s));
    onChange(next, 'later');
  };
  const editColor = (i: number, color: string): void => {
    onChange(stops.map((s, j) => (j === i ? { ...s, color } : s)), 'later');
  };
  const remove = (i: number): void => { onChange(stops.filter((_, j) => j !== i), 'immediately'); };
  const add = (): void => {
    const at = +(((min + max) / 2)).toFixed(2);
    onChange([...stops, { at, color: '#2dd4bf' }], 'immediately');
  };
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ ...flowMicro, marginBottom: 4 }}>Color stops</div>
      {stops.map((s, i) => (
        <div key={i} data-testid={`flow-stop-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ color: FLOW }}>●</span>
          <input data-testid={`flow-stop-at-${i}`} type="number" style={numField} value={s.at}
            onChange={(e) => editAt(i, Number(e.target.value))} onBlur={onCommit} />
          <input data-testid={`flow-stop-color-${i}`} type="color" style={swatch} value={isHex6(s.color) ? s.color : '#2dd4bf'}
            onChange={(e) => editColor(i, e.target.value)} onBlur={onCommit} />
          <button data-testid={`flow-stop-remove-${i}`} style={ghostBtn} title="Remove stop" onClick={() => remove(i)}>✕</button>
        </div>
      ))}
      <button data-testid="flow-stop-add" style={{ ...ghostBtn, width: '100%', marginTop: 2 }} onClick={add}>+ Add stop</button>
    </div>
  );
}

// ---- live metric scrubber: drives the REAL edge via ephemeral setFlowMetric ----
function MetricScrubber({ editor, edgeIds, firstEdge, domain }: {
  editor: Editor; edgeIds: Id[]; firstEdge: Id; domain: [number, number];
}): ReactElement {
  const [min, max] = domain;
  const [value, setValue] = useState<number>(() => editor.flowMetric(firstEdge) ?? (min + max) / 2);
  // resync when the selected edge changes
  useEffect(() => { setValue(editor.flowMetric(firstEdge) ?? (min + max) / 2); }, [firstEdge]); // eslint-disable-line react-hooks/exhaustive-deps
  const onInput = (v: number): void => {
    setValue(v);
    for (const id of edgeIds) editor.setFlowMetric(id, v); // ephemeral — no undo, no mark
  };
  return (
    <label style={{ ...flowRowCss, marginTop: 6 }}>
      <span style={{ color: ROW_LABEL }}>Metric</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input data-testid="flow-metric" type="range" min={min} max={max} step={(max - min) / 100 || 1}
          value={clamp(value, min, max)} onChange={(e) => onInput(Number(e.target.value))} />
        <span style={{ color: FLOW, fontSize: 11, minWidth: 28, textAlign: 'right' }}>{Math.round(value)}</span>
      </span>
    </label>
  );
}
```

Note: `colorForValue` is imported to keep the module honest about the core semantics but is only needed if you add a resolved-swatch. If lint flags it unused, drop it from the import — do NOT invent a use.

- [ ] **Step 4: Run the test to verify it passes.**

Run: `cd /home/ali/workspaces/InfraCanvas && pnpm exec vitest run packages/react/src/__tests__/flow-controls.test.ts`
Expected: PASS — all `buildRampCss` + defaults assertions green. (This requires the barrel export in Step 6; if it fails only on the import, do Step 6 first, then re-run.)

- [ ] **Step 5: Wire `FlowScaleEditor` + ramp swap into `FlowControls`.** In `packages/react/src/flow-controls.tsx`:

Add the import at the top (after the `@nodus-dev/core` import):
```tsx
import { buildRampCss, FlowScaleEditor } from './flow-scale-editor.js';
```
Replace the disclosure placeholder body `{null}` with:
```tsx
              <FlowScaleEditor editor={editor} edgeIds={edgeIds} firstEdge={first} />
```
Swap the preview strip so data-driven mode shows the ramp. Replace the `<FlowPreview .../>` render line with:
```tsx
      {flow?.scale
        ? <div data-testid="flow-preview-ramp" style={{ width: '100%', height: 24, marginBottom: 8, borderRadius: 6, border: `1px solid ${BORDER}`, background: buildRampCss(flow.scale.colors ?? [], flow.scale.domain, flow.scale.gradient) }} />
        : <FlowPreview editor={editor} edgeId={first} flow={flow} />}
```

- [ ] **Step 6: Export the new symbols from the barrel.** In `packages/react/src/index.tsx`, add after the `FlowControls` export line:
```tsx
export { buildRampCss, FlowScaleEditor, type FlowScaleEditorProps } from './flow-scale-editor.js';
```

- [ ] **Step 7: Full unit suite + typecheck + build.**
```bash
cd /home/ali/workspaces/InfraCanvas
pnpm exec vitest run packages/react   # buildRampCss + defaults
pnpm typecheck
pnpm --filter @nodus-dev/react build
```
Expected: all PASS.

- [ ] **Step 8: Commit.**
```bash
git add packages/react/src/flow-scale-editor.tsx packages/react/src/flow-controls.tsx packages/react/src/index.tsx packages/react/src/__tests__/flow-controls.test.ts
git commit -m "feat(react): data-driven flow scale editor — ramp, ranges, stops, live metric

Adds buildRampCss (pure, unit-tested) and FlowScaleEditor behind the Advanced
disclosure: color-stop ramp with draggable handles, Domain, speed/count/size
ranges, gradient toggle, a sorted stops list, and a metric scrubber that drives
the real edge live via ephemeral setFlowMetric.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Acceptance:** `buildRampCss` unit tests pass. Expanding Advanced and toggling Data-driven sets/clears `flow.scale`. Editing Domain, toggling a range, editing gradient, adding/editing/removing a color stop all update `flow.scale`. The strip becomes a ramp reflecting the stops/gradient; dragging a handle updates that stop's `at` (one undo entry per drag). Dragging Metric updates `editor.flowMetric(id)` for every selected edge, and the live canvas responds.

---

### Task 3: Context-menu flow quick-toggles

**Files:**
- Modify: `packages/react/src/context-menu.tsx` (imports + the `edge` branch)

**Interfaces:**
- Consumes: `DEFAULT_FLOW` from `./flow-controls.js`; `EdgeRecord`, `FlowSpec` types from `@nodus-dev/core`.

- [ ] **Step 1: Add imports.** In `packages/react/src/context-menu.tsx`, change line 3 and add a sibling import:
```tsx
import type { Editor, EdgeRecord, FlowSpec, Id, RenderItem } from '@nodus-dev/core';
import { DEFAULT_FLOW } from './flow-controls.js';
```

- [ ] **Step 2: Add the flow group to the edge branch.** Replace the `edge` branch (lines 30–39) with:
```tsx
  if (target.kind === 'edge') {
    const flow = (editor.store.peek(id) as EdgeRecord | undefined)?.flow;
    const flowItems: MenuItem[] = [
      { label: flow ? 'Flow: off' : 'Flow: on', run: () => editor.setFlow([id], flow ? null : DEFAULT_FLOW) },
    ];
    if (flow) {
      const base: FlowSpec = flow;
      flowItems.push(
        { label: base.style === 'dash' ? 'Flow: dots' : 'Flow: dash', run: () => editor.setFlow([id], { ...base, style: base.style === 'dash' ? 'dots' : 'dash' }) },
        { label: 'Flow: reverse', run: () => editor.setFlow([id], { ...base, reverse: !base.reverse }) },
      );
    }
    return [
      { label: 'Edit label', run: () => editor.beginEdit(id) },
      { label: 'Router → orthogonal', run: () => editor.setEdgeRouter(id, 'orthogonal') },
      { label: 'Router → straight', run: () => editor.setEdgeRouter(id, 'straight') },
      { label: 'Router → bezier', run: () => editor.setEdgeRouter(id, 'bezier') },
      ...flowItems,
      ...styleItems(editor, [id]),
      { label: 'Delete edge', danger: true, run: () => editor.deleteRecords([id]) },
    ];
  }
```

- [ ] **Step 3: Typecheck + build.**
```bash
cd /home/ali/workspaces/InfraCanvas && pnpm typecheck && pnpm --filter @nodus-dev/react build
```
Expected: PASS. (Confirm no import cycle: `flow-controls.tsx` must not import from `context-menu.tsx`.)

- [ ] **Step 4: Commit.**
```bash
git add packages/react/src/context-menu.tsx
git commit -m "feat(react): edge context-menu flow quick-toggles (on/off, dots/dash, reverse)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Acceptance:** Right-clicking an edge shows `Flow: on` (or `Flow: off`, `Flow: dots/dash`, `Flow: reverse` when on). Each toggles the edge record; dots/dash and reverse preserve the rest of the spec. Each action is one undo step.

---

### Task 4: Browser E2E verification + final checks

**Files:**
- Modify: `scripts/browser-verify.mjs` (add a flow authoring section)

**Interfaces:** consumes `window.__editor`, the existing `findChromium`, `snap`, `assert` scaffold, and the DOM testids added in Tasks 1–3.

- [ ] **Step 1: Add flow E2E checks to `scripts/browser-verify.mjs`.** After the existing checks (before the final `await browser.close()` / exit), add a block that: selects the first edge deterministically, drives the Properties Flow controls, and asserts `window.__editor` state. Use `page.evaluate` for selection to avoid canvas-hit flakiness.

```js
// ---- Flow authoring (sub-project 2) ----
console.log('\n▸ flow authoring');
const edgeId = await page.evaluate(() => {
  const ed = window.__editor;
  const e = ed.store.edges()[0];
  ed.select([e.id]);
  return e.id;
});
await page.waitForSelector('[data-testid="flow-animate"]');

// Animate on → edge gains flow
await page.getByTestId('flow-animate').check();
let flow = await page.evaluate((id) => window.__editor.store.peek(id).flow, edgeId);
assert(!!flow && flow.style === 'dots', 'Animate on adds a dots flow spec');

// Style → dash
await page.getByTestId('flow-style').selectOption('dash');
flow = await page.evaluate((id) => window.__editor.store.peek(id).flow, edgeId);
assert(flow.style === 'dash', 'Style select sets flow.style=dash');

// Reverse toggle
await page.getByTestId('flow-reverse').check();
flow = await page.evaluate((id) => window.__editor.store.peek(id).flow, edgeId);
assert(flow.reverse === true, 'Reverse sets flow.reverse=true');

// Undo reverts the reverse in one step
await page.evaluate(() => window.__editor.undo());
flow = await page.evaluate((id) => window.__editor.store.peek(id).flow, edgeId);
assert(!flow.reverse, 'Undo reverts reverse in one step');

// Advanced → data-driven → scale set
await page.getByTestId('flow-advanced-toggle').click();
await page.getByTestId('flow-datadriven').check();
flow = await page.evaluate((id) => window.__editor.store.peek(id).flow, edgeId);
assert(!!flow.scale && Array.isArray(flow.scale.colors) && flow.scale.colors.length === 3, 'Data-driven sets a 3-stop scale');

// Gradient toggle
await page.getByTestId('flow-gradient').check();
flow = await page.evaluate((id) => window.__editor.store.peek(id).flow, edgeId);
assert(flow.scale.gradient === true, 'Gradient toggles flow.scale.gradient');

// Add a color stop
await page.getByTestId('flow-stop-add').click();
flow = await page.evaluate((id) => window.__editor.store.peek(id).flow, edgeId);
assert(flow.scale.colors.length === 4, 'Add stop appends a color stop');

// Metric scrubber → ephemeral flowMetric reflects it
await page.evaluate((id) => window.__editor.setFlowMetric(id, 0), edgeId); // reset
await page.getByTestId('flow-metric').fill('42'); // range input: set value
await page.getByTestId('flow-metric').dispatchEvent('input');
const metric = await page.evaluate((id) => window.__editor.flowMetric(id), edgeId);
assert(typeof metric === 'number' && metric > 0, 'Metric scrubber sets an ephemeral flowMetric');

// Context menu: reset flow via panel then test quick-toggle by direct call path
await page.evaluate((id) => { const ed = window.__editor; ed.setFlow([id], null); }, edgeId);
flow = await page.evaluate((id) => window.__editor.store.peek(id).flow, edgeId);
assert(!flow, 'setFlow(null) clears flow (context-menu Flow: off path)');
```

If `getByTestId('flow-metric').fill('42')` does not fire React's `onChange` for a range input under this Chromium build, fall back to setting the value and dispatching `input` (as shown) or drive it through `page.evaluate` on the element. Keep the assertion on `flowMetric > 0`.

- [ ] **Step 2: Run the full verification.** In terminal A: `cd /home/ali/workspaces/InfraCanvas && pnpm dev` (Vite on port 5188). In terminal B: `cd /home/ali/workspaces/InfraCanvas && node scripts/browser-verify.mjs`.
Expected: all existing checks still pass, all new flow checks print `✓`, zero console/page errors, exit 0.

Also run the full unit suite and typecheck once more:
```bash
cd /home/ali/workspaces/InfraCanvas && pnpm test && pnpm typecheck
```
Expected: PASS.

- [ ] **Step 3: Reduced-motion spot check (manual/emulated).** Confirm under `prefers-reduced-motion: reduce` the preview strip renders a static frame (no animation) and the disclosure toggles without height/chevron transition. This is enforced by the `@media (prefers-reduced-motion: reduce)` block in `FLOW_STYLE`; verify by emulation in the browser-verify harness if convenient (`page.emulateMedia({ reducedMotion: 'reduce' })`) — assert no console errors after toggling Animate/Advanced.

- [ ] **Step 4: Commit.**
```bash
git add scripts/browser-verify.mjs
git commit -m "test(react): browser E2E for flow authoring UI (panel + scale + metric)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Acceptance:** The browser-verify run is green end-to-end with the new flow checks, no console errors; the full unit suite and typecheck pass.

---

## Self-Review

**1. Spec coverage.**
- Both surfaces (panel + context menu): Tasks 1/2 (panel), Task 3 (menu). ✓
- Full FlowSpec authoring (animate/style/speed/size/count/reverse/color+reset): Task 1. ✓
- Full FlowScale authoring (domain, three ranges, gradient, stops, sorted/clamped): Task 2. ✓
- Advanced disclosure holding the scale editor; basic controls always visible: Task 1 (disclosure) + Task 2 (body). ✓
- Signature — basic preview strip (dots/dash, speed/reverse/color/size, reduced-motion static): Task 1 `FlowPreview` + `FLOW_STYLE`. ✓
- Signature — data-driven ramp (gradient/stepped, draggable handles, numeric `at`/color fallbacks) + metric scrubber calling `setFlowMetric` live: Task 2 `RampStrip`/`StopsList`/`MetricScrubber`. ✓
- `buildRampCss` pure + unit-tested: Task 2. ✓
- Design tokens / one teal accent / ui-monospace / uppercase micro-labels: Global Constraints + Task 1/2 styles. ✓
- Undo batching mirrors the style panel; ephemeral metric excluded from history: Global Constraints + helpers. ✓
- Multi-select (first-edge display, apply-to-all): `patch`/`writeScale`/`MetricScrubber` loop over `edgeIds`. ✓
- Count hidden for dash; color reset falls back to stroke; stops sorted/clamped: Task 1/2. ✓
- No core changes; barrel exports FlowControls + DEFAULT_FLOW (+DEFAULT_SCALE, buildRampCss): Tasks 1/2. ✓
- Tests: `buildRampCss`/defaults unit + full browser E2E list: Tasks 2/4. ✓
- Out-of-scope items (source-binding UI, global FlowRuntimeConfig toolbar, disclosure persistence): not implemented. ✓

**2. Placeholder scan.** No "TBD"/"add error handling"/"similar to Task N" — every code step shows complete code. The Task-1 disclosure body is an explicit `{null}` placeholder documented as wired in Task 2 (not a plan gap). ✓

**3. Type consistency.** `DEFAULT_FLOW`/`DEFAULT_SCALE`, `FlowControlsProps { editor, ids }`, `FlowScaleEditorProps { editor, edgeIds, firstEdge }`, `buildRampCss(stops, domain, gradient?)` are named identically across producer/consumer tasks and the barrel. `patch`/`writeScale`/`patchScale` all read the first edge fresh and write to `edgeIds`. Testids referenced in Task 4 (`flow-animate`, `flow-style`, `flow-reverse`, `flow-advanced-toggle`, `flow-datadriven`, `flow-gradient`, `flow-stop-add`, `flow-metric`) all exist in Tasks 1/2. ✓

## Execution notes

- Branch is already `flow-authoring-ui` (not `mainline`) — work directly here; no worktree needed.
- Task order: 1 → 2 (same file, sequential) ; 3 depends only on Task 1's `DEFAULT_FLOW` (may run in parallel with Task 2 — disjoint files); 4 depends on 1–3. Review between tasks.
