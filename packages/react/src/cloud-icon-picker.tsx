/**
 * Searchable cloud-component palette. A toolbar button toggles a popover with a search box, provider
 * chips, and a scrollable grid of real icon previews (drawn via the core registry). Dragging a tile
 * onto the canvas creates an icon node at the drop point; a click (no drag) adds it at the viewport
 * center. Decoupled from @nodus/icons-cloud — the catalog arrives as a prop.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { getIcon, type Ctx2D, type Editor } from '@nodus/core';
import { getCanvas } from './canvas-registry.js';
import { catalogCounts, filterCatalog, type IconCatalogEntry, type ProviderFilter } from './cloud-icon-catalog.js';

export interface CloudIconPickerProps {
  editor: Editor;
  catalog: IconCatalogEntry[];
  /** Fallback tint for monochrome glyphs; cloud icons carry baked colors. Default '#e5e7eb'. */
  glyphColor?: string;
}

const TILE = 46; // preview size in css px
const DRAG_THRESHOLD = 4;
const GRID_COLS = 4; // must match the GRID template's column count (keyboard row nav depends on it)
const RECENT_MAX = 6;
const PROVIDERS: ProviderFilter[] = ['all', 'aws', 'azure', 'gcp'];

// Provider brand accents — the active chip fills/borders with these; the ProviderMark badge carries
// the identity even when inactive. `all` uses the app's accent green.
const BRAND: Record<ProviderFilter, string> = {
  all: '#10b981',
  aws: '#ff9900',
  azure: '#0078d4',
  gcp: '#4285f4',
};

const PANEL: CSSProperties = {
  position: 'absolute', top: '100%', left: 0, marginTop: 6, width: 404, zIndex: 20,
  background: '#0b0e13', border: '1px solid #2a323a', borderRadius: 8, padding: 10,
  boxShadow: '0 12px 32px -12px rgba(0,0,0,0.8)',
};
const SEARCH_WRAP: CSSProperties = { position: 'relative', display: 'flex', alignItems: 'center' };
const INPUT: CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: '#12161c', color: '#e5e7eb',
  border: '1px solid #2a323a', borderRadius: 6, padding: '6px 26px 6px 8px', fontSize: 12, outline: 'none',
};
const CLEAR_BTN: CSSProperties = {
  position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
  width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
  border: 'none', borderRadius: 999, background: '#2a323a', color: '#cbd5e1',
  fontSize: 13, lineHeight: 1, cursor: 'pointer', padding: 0,
};
const EMPTY: CSSProperties = {
  marginTop: 8, padding: '30px 12px', textAlign: 'center', color: '#6b7280', fontSize: 12,
};
const chipStyle = (brand: string, active: boolean, empty: boolean, hovered: boolean): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 5,
  background: active ? `${brand}22` : hovered ? '#171c24' : '#12161c',
  color: active ? brand : hovered ? '#e5e7eb' : '#9ca3af',
  border: `1px solid ${active ? brand : hovered ? `${brand}88` : '#2a323a'}`,
  borderRadius: 999, padding: '3px 8px', fontSize: 11, lineHeight: 1.4,
  cursor: 'pointer', textTransform: 'uppercase',
  opacity: empty && !active ? 0.4 : 1,
  transition: 'background 120ms, border-color 120ms, color 120ms',
});
const chipCountStyle = (active: boolean, brand: string): CSSProperties => ({
  fontVariantNumeric: 'tabular-nums', fontSize: 10, padding: '1px 5px', borderRadius: 999,
  minWidth: 12, textAlign: 'center', background: '#00000033', color: active ? brand : '#9ca3af',
});
const RECENT_LABEL: CSSProperties = {
  fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b7280', margin: '10px 0 4px',
};
const RECENT_ROW: CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap' };
const RECENT_TILE: CSSProperties = {
  display: 'flex', padding: 4, background: '#12161c', borderWidth: 1, borderStyle: 'solid',
  borderColor: '#1c2320', borderRadius: 6, cursor: 'grab', touchAction: 'none', userSelect: 'none',
};
// Tile hover via a stylesheet (avoids re-rendering all 92 tiles on pointer move); !important beats
// the inline base styles. Injected once inside the panel.
// Tile highlight is unified through activeIndex (set by hover AND arrow keys), so no :hover rule
// here — just the scrollbar theming, which can't be expressed with inline styles.
const GRID_CSS =
  '[data-cloud-grid]{scrollbar-width:thin;scrollbar-color:#2a323a transparent}' +
  '[data-cloud-grid]::-webkit-scrollbar{width:8px}' +
  '[data-cloud-grid]::-webkit-scrollbar-thumb{background:#2a323a;border-radius:8px}' +
  '[data-cloud-grid]::-webkit-scrollbar-thumb:hover{background:#3a4654}' +
  '[data-cloud-grid]::-webkit-scrollbar-track{background:transparent}';
const GRID: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 8,
  maxHeight: 300, overflowY: 'auto',
};
const TILE_BTN: CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: 4,
  background: '#12161c', borderWidth: 1, borderStyle: 'solid', borderColor: '#1c2320', borderRadius: 6,
  cursor: 'grab', touchAction: 'none', userSelect: 'none',
};
// The keyboard-cursor tile: an accent ring so arrow navigation is visible.
const tileStyle = (active: boolean): CSSProperties =>
  active ? { ...TILE_BTN, borderColor: '#10b981', background: '#10b98114' } : TILE_BTN;
const TILE_LABEL: CSSProperties = {
  fontSize: 9, color: '#9ca3af', maxWidth: TILE + 14, overflow: 'hidden',
  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const BTN: CSSProperties = {
  background: '#12161c', color: '#e5e5e5', borderWidth: 1, borderStyle: 'solid', borderColor: '#2a322f',
  borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer',
};

/**
 * Small brand badge for a provider chip — a recognizable, trademark-safe mark (not the official
 * logo): AWS orange smile, Azure blue "A", Google's four brand colors, and app-green for All.
 */
function ProviderMark({ p }: { p: ProviderFilter }): ReactElement {
  const svg: CSSProperties = { flex: '0 0 auto', display: 'block' };
  if (p === 'aws') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" style={svg} aria-hidden="true">
        <rect width="16" height="16" rx="4" fill="#ff9900" />
        <path d="M3.6 9c2.4 1.9 6.4 1.9 8.8 0" fill="none" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M11.1 8.5l1.9.4-.6 1.8z" fill="#fff" />
      </svg>
    );
  }
  if (p === 'azure') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" style={svg} aria-hidden="true">
        <rect width="16" height="16" rx="4" fill="#0078d4" />
        <path d="M8 3.6 12 12.4 4 12.4Z" fill="none" stroke="#fff" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M6.3 9.9h3.4" fill="none" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }
  if (p === 'gcp') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" style={svg} aria-hidden="true">
        <clipPath id="nodusGcpMark"><rect width="16" height="16" rx="4" /></clipPath>
        <g clipPath="url(#nodusGcpMark)">
          <rect x="0" y="0" width="8" height="8" fill="#ea4335" />
          <rect x="8" y="0" width="8" height="8" fill="#4285f4" />
          <rect x="0" y="8" width="8" height="8" fill="#fbbc04" />
          <rect x="8" y="8" width="8" height="8" fill="#34a853" />
        </g>
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" style={svg} aria-hidden="true">
      <rect width="16" height="16" rx="4" fill="#10b981" />
      <circle cx="5.6" cy="5.6" r="1.35" fill="#fff" />
      <circle cx="10.4" cy="5.6" r="1.35" fill="#fff" />
      <circle cx="5.6" cy="10.4" r="1.35" fill="#fff" />
      <circle cx="10.4" cy="10.4" r="1.35" fill="#fff" />
    </svg>
  );
}

/** A canvas preview that redraws the registered glyph when the icon name or color changes. */
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
  const [hoveredChip, setHoveredChip] = useState<ProviderFilter | null>(null);
  const [activeIndex, setActiveIndex] = useState(0); // keyboard cursor into the results grid
  const [recents, setRecents] = useState<IconCatalogEntry[]>([]); // session-recent placements, newest first
  const [ghost, setGhost] = useState<{ entry: IconCatalogEntry; x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ entry: IconCatalogEntry; x: number; y: number; sx: number; sy: number; moved: boolean } | null>(null);

  const results = useMemo(() => filterCatalog(catalog, query, provider), [catalog, query, provider]);
  const counts = useMemo(() => catalogCounts(catalog, query), [catalog, query]);

  const createIcon = (entry: IconCatalogEntry, cx: number, cy: number): void => {
    const util = editor.nodes.get('icon');
    const size = util?.getDefaultSize?.({ icon: entry.name }) ?? { w: 74, h: 74 };
    // label the node with its service name (matches the picker tile) so the glyph is self-describing
    editor.createNode({ type: 'icon', x: cx - size.w / 2, y: cy - size.h / 2, props: { icon: entry.name }, label: entry.service });
    // functional update → no dependency on `recents`, so the drag-effect closure stays stable
    setRecents((prev) => [entry, ...prev.filter((e) => e.name !== entry.name)].slice(0, RECENT_MAX));
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
  // Invariant that makes this safe: the effect intentionally attaches window listeners once per
  // drag session (keyed on ghost !== null), not on every ghost update. onMove/onUp read live drag
  // state from dragRef (a ref, not a dep) and placeAtClient/placeAtCenter close over only the
  // stable `editor` prop and stable state setters (setGhost/setRecents), so there's no stale
  // closure. If a future edit makes a placement helper depend on `query`, `provider`, or other
  // changing state, this disable must be revisited.
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

  useEffect(() => {
    if (!open) {
      setQuery('');
      setProvider('all');
    }
  }, [open]);

  // reset the keyboard cursor to the top whenever the result set changes (or the popover reopens)
  useEffect(() => { setActiveIndex(0); }, [query, provider, open]);

  // keep the keyboard-cursor tile scrolled into view as it moves
  useEffect(() => {
    if (!open) return;
    gridRef.current?.querySelector(`[data-idx="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

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
          <style>{GRID_CSS}</style>
          <div style={SEARCH_WRAP}>
            <input
              ref={inputRef}
              data-testid="cloud-picker-search"
              style={INPUT}
              placeholder="Search services… (lambda, database, gcp)"
              value={query}
              role="combobox"
              aria-expanded
              aria-controls="cloud-picker-grid"
              aria-activedescendant={results.length ? `cloud-opt-${activeIndex}` : undefined}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (results.length) { e.preventDefault(); placeAtCenter(results[activeIndex] ?? results[0]!); }
                  return;
                }
                if (!results.length) return;
                const last = results.length - 1;
                let next: number | null = null;
                if (e.key === 'ArrowRight') next = Math.min(last, activeIndex + 1);
                else if (e.key === 'ArrowLeft') next = Math.max(0, activeIndex - 1);
                else if (e.key === 'ArrowDown') next = Math.min(last, activeIndex + GRID_COLS);
                else if (e.key === 'ArrowUp') next = Math.max(0, activeIndex - GRID_COLS);
                else if (e.key === 'Home') next = 0;
                else if (e.key === 'End') next = last;
                if (next === null) return;
                e.preventDefault();
                setActiveIndex(next);
              }}
            />
            {query && (
              <button
                data-testid="cloud-picker-clear"
                style={CLEAR_BTN}
                onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                title="Clear search"
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
            {PROVIDERS.map((p) => (
              <button
                key={p}
                data-testid={`cloud-chip-${p}`}
                style={chipStyle(BRAND[p], provider === p, counts[p] === 0, hoveredChip === p)}
                onClick={() => setProvider(p)}
                onMouseEnter={() => setHoveredChip(p)}
                onMouseLeave={() => setHoveredChip((h) => (h === p ? null : h))}
                title={`${counts[p]} ${p === 'all' ? 'services' : p.toUpperCase()}`}
              >
                <ProviderMark p={p} />
                <span>{p}</span>
                <span style={chipCountStyle(provider === p, BRAND[p])}>{counts[p]}</span>
              </button>
            ))}
          </div>
          {query.trim() === '' && recents.length > 0 && (
            <div>
              <div style={RECENT_LABEL}>Recent</div>
              <div style={RECENT_ROW}>
                {recents.map((entry) => (
                  <div
                    key={`recent-${entry.name}`}
                    data-testid={`cloud-recent-${entry.name}`}
                    data-cloud-tile=""
                    title={entry.name}
                    style={RECENT_TILE}
                    onPointerDown={(e) => onTilePointerDown(entry, e)}
                  >
                    <Preview name={entry.name} color={glyphColor} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {results.length === 0 ? (
            <div data-testid="cloud-picker-empty" style={EMPTY}>
              No {provider === 'all' ? '' : `${provider.toUpperCase()} `}services match “{query.trim()}”
            </div>
          ) : (
            <div ref={gridRef} id="cloud-picker-grid" data-testid="cloud-picker-grid" data-cloud-grid="" role="listbox" style={GRID}>
              {results.map((entry, i) => (
                <div
                  key={entry.name}
                  id={`cloud-opt-${i}`}
                  data-testid={`cloud-tile-${entry.name}`}
                  data-cloud-tile=""
                  data-idx={i}
                  role="option"
                  aria-selected={i === activeIndex}
                  title={entry.name}
                  style={tileStyle(i === activeIndex)}
                  onPointerDown={(e) => onTilePointerDown(entry, e)}
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  <Preview name={entry.name} color={glyphColor} />
                  <span style={TILE_LABEL}>{entry.service}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 6, fontSize: 10, color: '#3a423f' }}>
            {results.length} of {catalog.length} · ↑↓←→ to move · Enter to add · drag to place
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
