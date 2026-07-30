# Cloud Icon Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reusable `<CloudIconPicker>` in `@ahmazin/react` — a "Cloud" toolbar button opening a searchable popover whose scrollable grid of real icon previews can be dragged onto the canvas to place an icon node.

**Architecture:** `@ahmazin/icons-cloud` exports a `cloudIconCatalog` derived from `ALLOWLIST`. `@ahmazin/react` gains a JSX-free `cloud-icon-catalog.ts` (types + pure `filterCatalog`), a `canvas-registry.ts` (`WeakMap<Editor, HTMLCanvasElement>` the `<Nodus>` host fills on mount), and the `cloud-icon-picker.tsx` component. The component is decoupled from cloud icons (catalog is a prop). Drag placement maps a drop point to world coords via the registered canvas + `editor.screenToWorld`.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), React 18, pnpm workspaces (packages resolve `main → src`, no build step), vitest (node environment — no jsdom, so component behavior is verified by the playwright-core browser E2E, not unit tests), `playwright-core` for E2E.

## Global Constraints

- Packages resolve to source (`main: ./src/index.ts`); no build step. `.js` import specifiers in TS.
- vitest runs in the **node** environment — no DOM. Unit tests cover pure functions only; UI is verified via `scripts/browser-verify.mjs`.
- `@ahmazin/react` must NOT import `@ahmazin/icons-cloud` (it declares its own structural `IconCatalogEntry` and takes `catalog` as a prop).
- Core `Editor` stays headless — no DOM references in `@ahmazin/core`.
- Icon draw fns come from core's registry: `getIcon(name): (ctx: Ctx2D, x, y, size, color, fill?) => void`. Cloud icons carry baked colors (the `color` arg is a fallback for monochrome glyphs).
- Node creation mirrors the existing demo: `editor.nodes.get('icon')?.getDefaultSize?.({ icon: name })` for size, then `editor.createNode({ type: 'icon', x, y, props: { icon: name } })`.
- End every commit message with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: `cloudIconCatalog` in `@ahmazin/icons-cloud`

**Files:**
- Create: `packages/icons-cloud/src/catalog.ts`
- Modify: `packages/icons-cloud/src/index.ts` (barrel export)
- Test: `packages/icons-cloud/src/__tests__/integrity.test.ts` (extend)

**Interfaces:**
- Consumes: `ALLOWLIST` from `./allowlist.js`.
- Produces: `interface IconCatalogEntry { name: string; provider: 'aws'|'azure'|'gcp'; service: string; category: string }`, `const cloudIconCatalog: IconCatalogEntry[]`.

- [ ] **Step 1: Write the failing test** (append to `integrity.test.ts`)

```ts
import { cloudIconCatalog } from '../catalog.js';

describe('cloudIconCatalog', () => {
  it('mirrors the allowlist one-to-one (name/provider/service/category)', () => {
    expect(cloudIconCatalog.length).toBe(ALLOWLIST.length);
    const byName = new Map(cloudIconCatalog.map((c) => [c.name, c]));
    for (const e of ALLOWLIST) {
      const c = byName.get(e.name);
      expect(c, `${e.name} present in catalog`).toBeDefined();
      expect(c).toEqual({ name: e.name, provider: e.provider, service: e.service, category: e.category });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/icons-cloud/src/__tests__/integrity.test.ts`
Expected: FAIL — cannot resolve `../catalog.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/icons-cloud/src/catalog.ts
/**
 * Searchable catalog of the curated cloud icons — the data a picker UI browses. Derived from
 * ALLOWLIST (the single source of truth) so it can never drift from what build:icons generates.
 */
import { ALLOWLIST } from './allowlist.js';

export interface IconCatalogEntry {
  name: string; // registry key + node props.icon, e.g. 'aws:lambda'
  provider: 'aws' | 'azure' | 'gcp';
  service: string; // 'lambda'
  category: string; // 'compute' | 'database' | ...
}

export const cloudIconCatalog: IconCatalogEntry[] = ALLOWLIST.map((e) => ({
  name: e.name,
  provider: e.provider,
  service: e.service,
  category: e.category,
}));
```

Add to `packages/icons-cloud/src/index.ts` (after the `installPack` export line):

```ts
export { cloudIconCatalog, type IconCatalogEntry } from './catalog.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/icons-cloud/src/__tests__/integrity.test.ts`
Expected: PASS (all integrity tests, incl. the new one).

- [ ] **Step 5: Commit**

```bash
git add packages/icons-cloud/src/catalog.ts packages/icons-cloud/src/index.ts packages/icons-cloud/src/__tests__/integrity.test.ts
git commit -m "feat(icons-cloud): export cloudIconCatalog derived from the allowlist

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Editor→canvas registry in `@ahmazin/react`

**Files:**
- Create: `packages/react/src/canvas-registry.ts`
- Modify: `packages/react/src/index.tsx` (register on mount, unregister on cleanup)
- Test: `packages/react/src/__tests__/canvas-registry.test.ts`

**Interfaces:**
- Consumes: `Editor` type from `@ahmazin/core`.
- Produces: `registerCanvas(editor: Editor, canvas: HTMLCanvasElement): void`, `unregisterCanvas(editor: Editor): void`, `getCanvas(editor: Editor): HTMLCanvasElement | undefined`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/react/src/__tests__/canvas-registry.test.ts
import { describe, expect, it } from 'vitest';
import { Editor } from '@ahmazin/core';
import { getCanvas, registerCanvas, unregisterCanvas } from '../canvas-registry.js';

describe('canvas registry', () => {
  it('stores, returns, and clears the canvas for an editor', () => {
    const editor = new Editor();
    const canvas = {} as HTMLCanvasElement; // WeakMap only needs object identity
    expect(getCanvas(editor)).toBeUndefined();
    registerCanvas(editor, canvas);
    expect(getCanvas(editor)).toBe(canvas);
    unregisterCanvas(editor);
    expect(getCanvas(editor)).toBeUndefined();
  });

  it('keeps registrations independent per editor', () => {
    const a = new Editor();
    const b = new Editor();
    const ca = {} as HTMLCanvasElement;
    registerCanvas(a, ca);
    expect(getCanvas(a)).toBe(ca);
    expect(getCanvas(b)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/react/src/__tests__/canvas-registry.test.ts`
Expected: FAIL — cannot resolve `../canvas-registry.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/react/src/canvas-registry.ts
/**
 * Internal DOM link between an Editor and its mounted <canvas>. The core Editor is headless, but a
 * drop target (e.g. the cloud icon picker) needs the canvas's screen rect to map a pointer to world
 * coordinates. The <Nodus> host registers its canvas on mount; consumers read it here.
 */
import type { Editor } from '@ahmazin/core';

const registry = new WeakMap<Editor, HTMLCanvasElement>();

export function registerCanvas(editor: Editor, canvas: HTMLCanvasElement): void {
  registry.set(editor, canvas);
}
export function unregisterCanvas(editor: Editor): void {
  registry.delete(editor);
}
export function getCanvas(editor: Editor): HTMLCanvasElement | undefined {
  return registry.get(editor);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/react/src/__tests__/canvas-registry.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the registry into the `<Nodus>` host**

In `packages/react/src/index.tsx`, add the import near the other local imports (below the `use-value.js` import):

```ts
import { registerCanvas, unregisterCanvas } from './canvas-registry.js';
```

In the main `useLayoutEffect`, register right after the null guard. Change:

```ts
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const ctx = canvas.getContext('2d') as unknown as Ctx2D;
```

to:

```ts
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const ctx = canvas.getContext('2d') as unknown as Ctx2D;
    registerCanvas(editor, canvas);
```

In the same effect's cleanup (the `return () => { ... }` block starting at the `ro.disconnect();` line), add `unregisterCanvas(editor);` as the first line:

```ts
    return () => {
      unregisterCanvas(editor);
      ro.disconnect();
      stopReaction();
```

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/canvas-registry.ts packages/react/src/index.tsx packages/react/src/__tests__/canvas-registry.test.ts
git commit -m "feat(react): Editor->canvas WeakMap registry for drop coordinate mapping

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `IconCatalogEntry` + pure `filterCatalog` in `@ahmazin/react`

**Files:**
- Create: `packages/react/src/cloud-icon-catalog.ts`
- Test: `packages/react/src/__tests__/cloud-icon-picker.test.ts`

**Interfaces:**
- Produces: `interface IconCatalogEntry { name: string; provider: 'aws'|'azure'|'gcp'; service: string; category: string }`, `type ProviderFilter = 'all'|'aws'|'azure'|'gcp'`, `filterCatalog(catalog: IconCatalogEntry[], query: string, provider: ProviderFilter): IconCatalogEntry[]`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/react/src/__tests__/cloud-icon-picker.test.ts
import { describe, expect, it } from 'vitest';
import { filterCatalog, type IconCatalogEntry } from '../cloud-icon-catalog.js';

const CAT: IconCatalogEntry[] = [
  { name: 'aws:lambda', provider: 'aws', service: 'lambda', category: 'compute' },
  { name: 'aws:rds', provider: 'aws', service: 'rds', category: 'database' },
  { name: 'azure:functions', provider: 'azure', service: 'functions', category: 'compute' },
  { name: 'gcp:bigquery', provider: 'gcp', service: 'bigquery', category: 'analytics' },
];

describe('filterCatalog', () => {
  it('returns everything for an empty query and all providers', () => {
    expect(filterCatalog(CAT, '', 'all')).toHaveLength(4);
    expect(filterCatalog(CAT, '   ', 'all')).toHaveLength(4);
  });

  it('matches the query as a substring over name/service/category/provider', () => {
    expect(filterCatalog(CAT, 'lambda', 'all').map((e) => e.name)).toEqual(['aws:lambda']);
    expect(filterCatalog(CAT, 'database', 'all').map((e) => e.name)).toEqual(['aws:rds']);
    expect(filterCatalog(CAT, 'GCP', 'all').map((e) => e.name)).toEqual(['gcp:bigquery']);
    expect(filterCatalog(CAT, 'compute', 'all').map((e) => e.name)).toEqual(['aws:lambda', 'azure:functions']);
  });

  it('restricts to a provider and combines it with the query', () => {
    expect(filterCatalog(CAT, '', 'aws')).toHaveLength(2);
    expect(filterCatalog(CAT, 'compute', 'azure').map((e) => e.name)).toEqual(['azure:functions']);
    expect(filterCatalog(CAT, 'lambda', 'azure')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/react/src/__tests__/cloud-icon-picker.test.ts`
Expected: FAIL — cannot resolve `../cloud-icon-catalog.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/react/src/cloud-icon-catalog.ts
/**
 * Types + pure search logic for the cloud icon picker, kept JSX-free so it unit-tests under the
 * node vitest environment (mirrors flow-shared.ts). The .tsx component imports these; tests import
 * filterCatalog directly. @ahmazin/react declares its OWN IconCatalogEntry so it never depends on
 * @ahmazin/icons-cloud — the cloudIconCatalog value is structurally assignable to it.
 */
export interface IconCatalogEntry {
  name: string;
  provider: 'aws' | 'azure' | 'gcp';
  service: string;
  category: string;
}

export type ProviderFilter = 'all' | 'aws' | 'azure' | 'gcp';

/** Filter by a free-text query (substring over name/service/category/provider) and provider. */
export function filterCatalog(
  catalog: IconCatalogEntry[],
  query: string,
  provider: ProviderFilter,
): IconCatalogEntry[] {
  const q = query.trim().toLowerCase();
  return catalog.filter((e) => {
    if (provider !== 'all' && e.provider !== provider) return false;
    if (!q) return true;
    return `${e.name} ${e.service} ${e.category} ${e.provider}`.toLowerCase().includes(q);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/react/src/__tests__/cloud-icon-picker.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/cloud-icon-catalog.ts packages/react/src/__tests__/cloud-icon-picker.test.ts
git commit -m "feat(react): IconCatalogEntry + pure filterCatalog search helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `CloudIconPicker` component

**Files:**
- Create: `packages/react/src/cloud-icon-picker.tsx`
- Modify: `packages/react/src/index.tsx` (barrel export)

**Interfaces:**
- Consumes: `getIcon`, `type Ctx2D`, `type Editor` from `@ahmazin/core`; `getCanvas` from `./canvas-registry.js`; `filterCatalog`, `IconCatalogEntry`, `ProviderFilter` from `./cloud-icon-catalog.js`.
- Produces: `interface CloudIconPickerProps { editor: Editor; catalog: IconCatalogEntry[]; glyphColor?: string }`, `function CloudIconPicker(props): ReactElement`.

**Note:** vitest is node-only, so this component has no unit test; its behavior is gated by the browser E2E in Task 5. This step ends at "typecheck passes + exported".

- [ ] **Step 1: Write the component**

```tsx
// packages/react/src/cloud-icon-picker.tsx
/**
 * Searchable cloud-component palette. A toolbar button toggles a popover with a search box, provider
 * chips, and a scrollable grid of real icon previews (drawn via the core registry). Dragging a tile
 * onto the canvas creates an icon node at the drop point; a click (no drag) adds it at the viewport
 * center. Decoupled from @ahmazin/icons-cloud — the catalog arrives as a prop.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { getIcon, type Ctx2D, type Editor } from '@ahmazin/core';
import { getCanvas } from './canvas-registry.js';
import { filterCatalog, type IconCatalogEntry, type ProviderFilter } from './cloud-icon-catalog.js';

export interface CloudIconPickerProps {
  editor: Editor;
  catalog: IconCatalogEntry[];
  /** Fallback tint for monochrome glyphs; cloud icons carry baked colors. Default '#e5e7eb'. */
  glyphColor?: string;
}

const TILE = 46; // preview size in css px
const DRAG_THRESHOLD = 4;
const PROVIDERS: ProviderFilter[] = ['all', 'aws', 'azure', 'gcp'];

const PANEL: CSSProperties = {
  position: 'absolute', top: '100%', left: 0, marginTop: 6, width: 320, zIndex: 20,
  background: '#0b0e13', border: '1px solid #2a323a', borderRadius: 8, padding: 10,
  boxShadow: '0 12px 32px -12px rgba(0,0,0,0.8)',
};
const INPUT: CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: '#12161c', color: '#e5e7eb',
  border: '1px solid #2a323a', borderRadius: 6, padding: '6px 8px', fontSize: 12, outline: 'none',
};
const CHIP = (active: boolean): CSSProperties => ({
  background: active ? '#10b98122' : '#12161c', color: active ? '#10b981' : '#9ca3af',
  border: `1px solid ${active ? '#10b981' : '#2a323a'}`, borderRadius: 999, padding: '3px 10px',
  fontSize: 11, cursor: 'pointer', textTransform: 'uppercase',
});
const GRID: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 8,
  maxHeight: 300, overflowY: 'auto',
};
const TILE_BTN: CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: 4,
  background: '#12161c', border: '1px solid #1c2320', borderRadius: 6, cursor: 'grab',
  touchAction: 'none', userSelect: 'none',
};
const TILE_LABEL: CSSProperties = {
  fontSize: 9, color: '#9ca3af', maxWidth: TILE + 14, overflow: 'hidden',
  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const BTN: CSSProperties = {
  background: '#12161c', color: '#e5e5e5', border: '1px solid #2a322f', borderRadius: 6,
  padding: '6px 10px', fontSize: 12, cursor: 'pointer',
};

/** A canvas preview that redraws the registered glyph when the icon or dpr changes. */
function Preview({ name, color }: { name: string; color: string }): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.max(1, Math.min(3, Math.floor(window.devicePixelRatio || 1)));
    canvas.width = TILE * dpr;
    canvas.height = TILE * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    const pad = 5;
    getIcon(name)?.(ctx as unknown as Ctx2D, pad, pad, TILE - 2 * pad, color);
    ctx.restore();
  }, [name, color]);
  return <canvas ref={ref} style={{ width: TILE, height: TILE, display: 'block' }} />;
}

export function CloudIconPicker({ editor, catalog, glyphColor = '#e5e7eb' }: CloudIconPickerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState<ProviderFilter>('all');
  const [ghost, setGhost] = useState<{ entry: IconCatalogEntry; x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ entry: IconCatalogEntry; x: number; y: number; sx: number; sy: number; moved: boolean } | null>(null);

  const results = useMemo(() => filterCatalog(catalog, query, provider), [catalog, query, provider]);

  const createIcon = (entry: IconCatalogEntry, cx: number, cy: number): void => {
    const util = editor.nodes.get('icon');
    const size = util?.getDefaultSize?.({ icon: entry.name }) ?? { w: 74, h: 74 };
    editor.createNode({ type: 'icon', x: cx - size.w / 2, y: cy - size.h / 2, props: { icon: entry.name } });
  };
  const placeAtClient = (entry: IconCatalogEntry, clientX: number, clientY: number): void => {
    const canvas = getCanvas(editor);
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return;
    const world = editor.screenToWorld({ x: clientX - r.left, y: clientY - r.top });
    createIcon(entry, world.x, world.y);
  };
  const placeAtCenter = (entry: IconCatalogEntry): void => {
    const vp = editor.worldViewport();
    createIcon(entry, vp.x + vp.w / 2, vp.y + vp.h / 2);
  };

  // pointer-drag session (window listeners live only while a drag is in flight)
  useEffect(() => {
    if (!ghost) return;
    const onMove = (e: PointerEvent): void => {
      const d = dragRef.current;
      if (!d) return;
      d.x = e.clientX;
      d.y = e.clientY;
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > DRAG_THRESHOLD) d.moved = true;
      setGhost({ entry: d.entry, x: e.clientX, y: e.clientY });
    };
    const onUp = (): void => {
      const d = dragRef.current;
      dragRef.current = null;
      setGhost(null);
      if (!d) return;
      if (d.moved) placeAtClient(d.entry, d.x, d.y);
      else placeAtCenter(d.entry);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [ghost !== null]); // eslint-disable-line react-hooks/exhaustive-deps -- add/remove once per drag

  // close on Escape or outside pointerdown (never while dragging)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: PointerEvent): void => {
      if (dragRef.current) return;
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const onTilePointerDown = (entry: IconCatalogEntry, e: React.PointerEvent): void => {
    e.preventDefault();
    dragRef.current = { entry, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
    setGhost({ entry, x: e.clientX, y: e.clientY });
  };

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        data-testid="cloud-picker-button"
        style={open ? { ...BTN, borderColor: '#10b981', color: '#10b981' } : BTN}
        onClick={() => setOpen((o) => !o)}
      >
        Cloud ▾
      </button>
      {open && (
        <div data-testid="cloud-picker-panel" style={PANEL} onPointerDown={(e) => e.stopPropagation()}>
          <input
            ref={inputRef}
            data-testid="cloud-picker-search"
            style={INPUT}
            placeholder="Search services… (lambda, database, gcp)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {PROVIDERS.map((p) => (
              <button key={p} style={CHIP(provider === p)} onClick={() => setProvider(p)}>
                {p}
              </button>
            ))}
          </div>
          <div data-testid="cloud-picker-grid" style={GRID}>
            {results.map((entry) => (
              <div
                key={entry.name}
                data-testid={`cloud-tile-${entry.name}`}
                title={entry.name}
                style={TILE_BTN}
                onPointerDown={(e) => onTilePointerDown(entry, e)}
              >
                <Preview name={entry.name} color={glyphColor} />
                <span style={TILE_LABEL}>{entry.service}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 6, fontSize: 10, color: '#3a423f' }}>
            {results.length} of {catalog.length} · drag onto the canvas
          </div>
        </div>
      )}
      {ghost && (
        <div style={{ position: 'fixed', left: ghost.x - TILE / 2, top: ghost.y - TILE / 2, pointerEvents: 'none', opacity: 0.9, zIndex: 100 }}>
          <Preview name={ghost.entry.name} color={glyphColor} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Export from the barrel**

Add to `packages/react/src/index.tsx` (with the other component exports around line 310):

```ts
export { CloudIconPicker, type CloudIconPickerProps } from './cloud-icon-picker.js';
export { filterCatalog, type IconCatalogEntry, type ProviderFilter } from './cloud-icon-catalog.js';
```

- [ ] **Step 3: Run typecheck + the react unit tests**

Run: `pnpm typecheck && pnpm vitest run packages/react`
Expected: PASS (typecheck clean; `filterCatalog` + `canvas-registry` tests green). The component itself has no unit test — it is exercised by the E2E in Task 5.

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/cloud-icon-picker.tsx packages/react/src/index.tsx
git commit -m "feat(react): CloudIconPicker — searchable, drag-to-canvas cloud palette

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Wire into the demo + browser E2E

**Files:**
- Modify: `examples/browser/src/main.tsx` (replace the placeholder select/button with `<CloudIconPicker>`)
- Modify: `scripts/browser-verify.mjs` (add an open→search→drag E2E step)

**Interfaces:**
- Consumes: `CloudIconPicker` from `@ahmazin/react`, `cloudIconCatalog` from `@ahmazin/icons-cloud`.

- [ ] **Step 1: Replace the placeholder in the demo**

In `examples/browser/src/main.tsx`:

1. Add imports (next to the existing `@ahmazin/react` and `@ahmazin/icons-cloud` imports):

```ts
import { CommandPalette, CloudIconPicker, Minimap, Nodus, Properties, copyImage, useValue } from '@ahmazin/react';
import { cloudIconCatalog, installCloudIcons } from '@ahmazin/icons-cloud';
```

2. Delete the placeholder constant and state/handler:
   - Remove the `CLOUD_ICON_NAMES` const (line ~11-12).
   - Remove `const [cloudIcon, setCloudIcon] = useState<string>(CLOUD_ICON_NAMES[0]);`.
   - Remove the entire `addCloudIcon` function.

3. Replace the placeholder `<select data-testid="cloud-icon-select">…</select>` and `<button data-testid="add-cloud-icon">Add icon</button>` block with:

```tsx
        <CloudIconPicker editor={editor} catalog={cloudIconCatalog} />
```

(Keep the surrounding `<span>` divider separators.)

- [ ] **Step 2: Add the E2E step to `scripts/browser-verify.mjs`**

Insert before the final summary/`browser.close()` (after the last existing check), following the file's `assert`/`snap` style:

```js
  console.log('7) cloud icon picker: open, search, drag onto canvas ...');
  const beforeCloud = (await snap(page)).nodes;
  await page.click('[data-testid="cloud-picker-button"]');
  await page.fill('[data-testid="cloud-picker-search"]', 'lambda');
  await page.waitForTimeout(120);
  const tile = await page.locator('[data-testid="cloud-tile-aws:lambda"]').boundingBox();
  const cRect = await page.evaluate(() => {
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const dropX = cRect.x + cRect.w * 0.5;
  const dropY = cRect.y + cRect.h * 0.6;
  await page.mouse.move(tile.x + tile.width / 2, tile.y + tile.height / 2);
  await page.mouse.down();
  await page.mouse.move(dropX, dropY, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const afterCloud = await snap(page);
  assert(afterCloud.nodes === beforeCloud + 1, 'dragging a cloud icon adds one node');
  const placed = await page.evaluate(() => {
    const ns = window.__editor.store.nodes();
    return ns[ns.length - 1]?.props?.icon;
  });
  assert(placed === 'aws:lambda', 'placed node carries the dragged icon (aws:lambda)');
  await page.screenshot({ path: join(OUT, 'browser-4-cloud.png') });
```

(If the last existing step is numbered other than 6, renumber this to follow it.)

- [ ] **Step 3: Run the full unit/type gate**

Run: `pnpm typecheck && pnpm test && pnpm verify:render`
Expected: PASS (all suites green, incl. Tasks 1–3 tests).

- [ ] **Step 4: Run the browser E2E**

```bash
pnpm --filter nodus-example-browser exec vite --host 127.0.0.1 --port 5188 &
# wait for the server, then:
node scripts/browser-verify.mjs
kill $(lsof -ti tcp:5188)
```

Expected: all E2E assertions pass, including "dragging a cloud icon adds one node" and "placed node carries the dragged icon (aws:lambda)". Eyeball `examples/output/browser-4-cloud.png`.

- [ ] **Step 5: Commit**

```bash
git add examples/browser/src/main.tsx scripts/browser-verify.mjs examples/output/browser-4-cloud.png
git commit -m "feat(example): wire CloudIconPicker into the demo + drag E2E

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Component `<CloudIconPicker editor catalog>` → Task 4. Toolbar button + popover + search + chips + scrollable grid → Task 4. ✓
- `cloudIconCatalog` from `@ahmazin/icons-cloud` derived from `ALLOWLIST`, taken as a prop → Task 1 (export) + Task 4 (prop). ✓
- Canvas registry `WeakMap<Editor, HTMLCanvasElement>` filled by `<Nodus>` → Task 2. ✓
- Previews via registry draw fns → Task 4 (`Preview`). ✓
- Pure `filterCatalog` (name/service/category/provider substring + provider filter) → Task 3. ✓
- Pointer-drag placement, drop→`screenToWorld`, click(<4px)→center, off-canvas→discard → Task 4. ✓
- Demo wiring replacing the placeholder → Task 5. ✓
- Testing: catalog integrity (Task 1), `filterCatalog` unit (Task 3), canvas-registry unit (Task 2), drag E2E (Task 5). ✓
- Error/edge cases (no canvas, off-canvas drop, missing draw fn, dpr) → handled in Task 4 (`getCanvas` guard, bounds check, optional-chained `getIcon`, dpr-sized preview). ✓

**Placeholder scan:** No TBD/TODO. Every code step shows complete code; every run step shows the command + expected result. ✓

**Type consistency:** `IconCatalogEntry` shape `{ name, provider, service, category }` is identical in Task 1 (icons-cloud) and Task 3 (react, structurally decoupled by design). `filterCatalog(catalog, query, provider)` signature defined in Task 3, used in Task 4. `getCanvas(editor)`/`registerCanvas`/`unregisterCanvas` defined in Task 2, used in Tasks 2 (wiring) and 4. `createNode({ type:'icon', x, y, props:{icon} })` + `editor.nodes.get('icon')?.getDefaultSize?.({ icon })` match the existing demo usage. `ProviderFilter` defined Task 3, used Task 4. ✓

**Note for the implementer:** Playwright `page.mouse.*` generates pointer events in Chromium, so the Task 5 drag drives the component's `pointerdown/move/up` handlers. If `setPointerCapture`-based flakiness ever appears, the component uses window-level listeners (no capture), so this is not a concern. The main canvas is the first `<canvas>` in the DOM (the minimap canvas comes later), matching the existing `worldToClient` helper's `document.querySelector('canvas')`.
