/**
 * Searchable cloud-component palette. A toolbar button toggles a popover with a search box, provider
 * chips, and a scrollable grid of real icon previews (drawn via the core registry). Dragging a tile
 * onto the canvas creates an icon node at the drop point; a click (no drag) adds it at the viewport
 * center. Decoupled from @nodus/icons-cloud — the catalog arrives as a prop.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { getIcon, type Ctx2D, type Editor } from '@nodus/core';
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
