/**
 * Searchable stencil palette — the CloudIconPicker UX applied to reusable element-group *fragments*
 * instead of single glyphs. A toolbar button toggles a popover with a search box and a grid of
 * stencil previews grouped by library (plus a session "recent" strip). Dragging a tile onto the
 * canvas drops the fragment at the world point (via `editor.placeStencil`); a click (no drag) drops
 * it at the viewport center. A "Save selection as stencil" control captures the current selection
 * (`editor.captureStencil`) and hands the resulting `Stencil` to the host for persistence.
 *
 * Decoupled from `@nodus/stencils`: the libraries arrive as a prop and persistence is the host's job.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { Editor, isNode, makeId, renderSVG, type NodusRecord } from '@nodus/core';
import type { Stencil, StencilLibrary as StencilLibraryData } from '@nodus/stencils';
import { getCanvas } from './canvas-registry.js';
import { useUiTokens, type UiMode, type UiTokens } from './ui/tokens.js';
import { injectGlobalStyles } from './ui/global-styles.js';
import { useValue } from './use-value.js';

export interface StencilLibraryProps {
  editor: Editor;
  /** Libraries to browse. Type re-exported from `@nodus/stencils`. */
  libraries: StencilLibraryData[];
  /** Called after the current selection is captured into a new stencil (the host owns persistence). */
  onSaveSelection?: (stencil: Stencil) => void;
  className?: string;
  style?: CSSProperties;
  /**
   * How the expanded palette is laid out.
   * - `'popover'` (default): a fixed-width popover floating over the page from the trigger button.
   * - `'inline'`: the panel expands *in flow* at full container width (no absolute positioning, no
   *   outside-click close, responsive thumbnails) so it fits inside a narrow docked side panel.
   */
  variant?: 'popover' | 'inline';
}

const TILE_W = 104; // preview box width in css px
const TILE_H = 66; // preview box height in css px
const DRAG_THRESHOLD = 4;
const GRID_COLS = 3; // must match the grid template's column count (keyboard row nav depends on it)
const RECENT_MAX = 6;

// ── Thumbnails ────────────────────────────────────────────────────────────────────────────────
// Each fragment is rendered once to an inline SVG data-URI via the core vector exporter, using a
// throwaway editor seeded with the *real* editor's registered types + theme so a stencil built from
// custom node types renders faithfully. Cached by (stencil, mode) so a light/dark flip re-renders.
const thumbCache = new WeakMap<Stencil, Map<UiMode, string>>();

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function renderFragmentThumb(editor: Editor, records: NodusRecord[]): string {
  const preview = new Editor({
    builtins: false, // the real editor's list() already carries rect/line — don't double-register
    nodeTypes: editor.nodes.list(),
    edgeTypes: editor.edges.list(),
    theme: editor.themeAtom.peek(),
  });
  preview.placeStencil(records, { x: 0, y: 0 });
  return svgToDataUri(renderSVG(preview, { padding: 8, background: false }));
}

function stencilThumb(editor: Editor, stencil: Stencil, mode: UiMode): string {
  if (stencil.preview) return stencil.preview; // host-supplied thumbnail wins
  let byMode = thumbCache.get(stencil);
  if (!byMode) {
    byMode = new Map();
    thumbCache.set(stencil, byMode);
  }
  let uri = byMode.get(mode);
  if (uri === undefined) {
    uri = renderFragmentThumb(editor, stencil.records);
    byMode.set(mode, uri);
  }
  return uri;
}

/** Bounding size of a normalized (origin `0,0`) fragment, used to drop it centered under the cursor. */
function fragmentSize(records: NodusRecord[]): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const r of records) {
    if (isNode(r)) {
      w = Math.max(w, r.x + r.w);
      h = Math.max(h, r.y + r.h);
    }
  }
  return { w, h };
}

// ── Styles ──────────────────────────────────────────────────────────────────────────────────────
interface Styles {
  panel: CSSProperties;
  input: CSSProperties;
  clearBtn: CSSProperties;
  empty: CSSProperties;
  groupLabel: CSSProperties;
  recentLabel: CSSProperties;
  scroll: CSSProperties;
  grid: CSSProperties;
  tileLabel: CSSProperties;
  footer: CSSProperties;
  saveBtn: (enabled: boolean) => CSSProperties;
  toggle: (open: boolean) => CSSProperties;
  tile: (active: boolean) => CSSProperties;
  thumb: CSSProperties;
  scrollCss: string;
}

function buildStyles(t: UiTokens, variant: 'popover' | 'inline' = 'popover'): Styles {
  const c = t.color;
  const inline = variant === 'inline';
  const tileBase: CSSProperties = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: 4,
    background: c.surface, borderWidth: 1, borderStyle: 'solid', borderColor: c.border, borderRadius: t.radius.md,
    cursor: 'grab', touchAction: 'none', userSelect: 'none',
  };
  return {
    // Inline: flow at full container width so it fits a narrow docked panel (no float, no shadow).
    panel: inline
      ? {
          position: 'static', width: '100%', marginTop: 6,
          background: c.panel, border: `1px solid ${c.border}`, borderRadius: t.radius.lg, padding: 10,
          color: c.text, fontFamily: t.font.family,
        }
      : {
          position: 'absolute', top: '100%', left: 0, marginTop: 6, width: 372, zIndex: 20,
          background: c.panel, border: `1px solid ${c.border}`, borderRadius: t.radius.lg, padding: 10,
          boxShadow: t.shadow.popover, color: c.text, fontFamily: t.font.family,
        },
    input: {
      width: '100%', boxSizing: 'border-box', background: c.surface, color: c.text,
      border: `1px solid ${c.border}`, borderRadius: t.radius.md, padding: '6px 26px 6px 8px', fontSize: 12, outline: 'none',
    },
    clearBtn: {
      position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
      width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: 'none', borderRadius: 999, background: c.surfaceHover, color: c.text,
      fontSize: 13, lineHeight: 1, cursor: 'pointer', padding: 0,
    },
    empty: { marginTop: 8, padding: '30px 12px', textAlign: 'center', color: c.textMuted, fontSize: 12 },
    groupLabel: { fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, color: c.textFaint, margin: '10px 0 4px' },
    recentLabel: { fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, color: c.textFaint, margin: '10px 0 4px' },
    scroll: { maxHeight: 320, overflowY: 'auto', marginTop: 4 },
    grid: { display: 'grid', gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`, gap: 6 },
    tileLabel: { fontSize: 9, color: c.textMuted, maxWidth: TILE_W, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    footer: { marginTop: 8, fontSize: 10, color: c.textFaint },
    saveBtn: (enabled) => ({
      width: '100%', boxSizing: 'border-box', marginTop: 8,
      background: enabled ? c.accent : c.surface, color: enabled ? c.accentText : c.textFaint,
      border: `1px solid ${enabled ? c.accent : c.border}`, borderRadius: t.radius.md,
      padding: '6px 10px', fontSize: 12, fontFamily: t.font.family,
      cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.6,
    }),
    toggle: (open) => ({
      background: c.surface, color: open ? c.accent : c.text, borderWidth: 1, borderStyle: 'solid',
      borderColor: open ? c.accent : c.border, borderRadius: t.radius.md, padding: '6px 10px', fontSize: 12, cursor: 'pointer',
    }),
    tile: (active) => (active ? { ...tileBase, borderColor: c.accent, background: c.selection } : tileBase),
    // Inline docks into a ~266px panel: let the thumbnail shrink to the column width (aspect kept by
    // `contain`) instead of overflowing at its fixed 104px.
    thumb: inline
      ? { width: '100%', maxWidth: TILE_W, height: TILE_H, objectFit: 'contain', display: 'block', pointerEvents: 'none' }
      : { width: TILE_W, height: TILE_H, objectFit: 'contain', display: 'block', pointerEvents: 'none' },
    scrollCss:
      `[data-stencil-scroll]{scrollbar-width:thin;scrollbar-color:${c.borderStrong} transparent}` +
      '[data-stencil-scroll]::-webkit-scrollbar{width:8px}' +
      `[data-stencil-scroll]::-webkit-scrollbar-thumb{background:${c.border};border-radius:8px}` +
      `[data-stencil-scroll]::-webkit-scrollbar-thumb:hover{background:${c.borderStrong}}` +
      '[data-stencil-scroll]::-webkit-scrollbar-track{background:transparent}',
  };
}

/** A stencil preview thumbnail (host-supplied `preview`, else rendered on demand and cached). */
function Thumb({ editor, stencil, mode, variant }: { editor: Editor; stencil: Stencil; mode: UiMode; variant: 'popover' | 'inline' }): ReactElement {
  const S = buildStyles(useUiTokens(editor), variant);
  const uri = useMemo(() => stencilThumb(editor, stencil, mode), [editor, stencil, mode]);
  return <img src={uri} alt="" aria-hidden="true" style={S.thumb} draggable={false} />;
}

export function StencilLibrary({ editor, libraries, onSaveSelection, className, style, variant = 'popover' }: StencilLibraryProps): ReactElement | null {
  const t = useUiTokens(editor);
  const S = buildStyles(t, variant);
  const inline = variant === 'inline';
  useEffect(() => { injectGlobalStyles(); }, []);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0); // keyboard cursor into the flat result list
  const [recents, setRecents] = useState<Stencil[]>([]); // session-recent placements, newest first
  const [ghost, setGhost] = useState<{ stencil: Stencil; x: number; y: number } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ stencil: Stencil; x: number; y: number; sx: number; sy: number; moved: boolean } | null>(null);

  // enabled/disabled state of the save control reacts to selection (selectedAtom, not sceneIndex.version)
  const selCount = useValue(() => editor.selectedAtom.get().size);

  // Filter each library by name/tags, drop empty groups; `flat` is the keyboard-navigable order.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return libraries
      .map((lib) => ({
        name: lib.name,
        stencils: q === ''
          ? lib.stencils
          : lib.stencils.filter(
              (s) => s.name.toLowerCase().includes(q) || (s.tags ?? []).some((tag) => tag.toLowerCase().includes(q)),
            ),
      }))
      .filter((g) => g.stencils.length > 0);
  }, [libraries, query]);

  const flat = useMemo(() => groups.flatMap((g) => g.stencils), [groups]);
  const flatIndex = useMemo(() => {
    const m = new Map<Stencil, number>();
    flat.forEach((s, i) => m.set(s, i));
    return m;
  }, [flat]);
  const total = useMemo(() => libraries.reduce((n, lib) => n + lib.stencils.length, 0), [libraries]);

  const placeAt = (stencil: Stencil, worldX: number, worldY: number): void => {
    const { w, h } = fragmentSize(stencil.records);
    editor.placeStencil(stencil.records, { x: worldX - w / 2, y: worldY - h / 2 }); // drop centered
    setRecents((prev) => [stencil, ...prev.filter((s) => s.id !== stencil.id)].slice(0, RECENT_MAX));
  };
  const placeAtClient = (stencil: Stencil, clientX: number, clientY: number): void => {
    const canvas = getCanvas(editor);
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return;
    const world = editor.screenToWorld({ x: clientX - r.left, y: clientY - r.top });
    placeAt(stencil, world.x, world.y);
  };
  const placeAtCenter = (stencil: Stencil): void => {
    const vp = editor.worldViewport();
    placeAt(stencil, vp.x + vp.w / 2, vp.y + vp.h / 2);
  };

  const onSave = (): void => {
    const records = editor.captureStencil(editor.selectedIdsArray());
    if (records.length === 0) return;
    const name = window.prompt('Name this stencil', 'My stencil')?.trim();
    if (!name) return;
    onSaveSelection?.({ id: makeId('stencil'), name, records });
  };

  // pointer-drag session (window listeners live only while a drag is in flight) — mirrors CloudIconPicker
  useEffect(() => {
    if (!ghost) return;
    const onMove = (e: PointerEvent): void => {
      const d = dragRef.current;
      if (!d) return;
      d.x = e.clientX;
      d.y = e.clientY;
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > DRAG_THRESHOLD) d.moved = true;
      setGhost({ stencil: d.stencil, x: e.clientX, y: e.clientY });
    };
    const onUp = (): void => {
      const d = dragRef.current;
      dragRef.current = null;
      setGhost(null);
      if (!d) return;
      if (d.moved) placeAtClient(d.stencil, d.x, d.y);
      else placeAtCenter(d.stencil);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  // Same invariant as CloudIconPicker: attach once per drag session (keyed on ghost !== null).
  // onMove/onUp read live drag state from dragRef and the placement helpers close over only the
  // stable `editor` prop and stable setters (setGhost/setRecents), so there is no stale closure.
  }, [ghost !== null]); // eslint-disable-line react-hooks/exhaustive-deps -- add/remove once per drag

  // close on Escape or outside pointerdown (never while dragging). Inline (docked in a panel) skips
  // the outside-pointerdown close so a canvas click/drag doesn't collapse the palette; Escape still closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    if (inline) return () => window.removeEventListener('keydown', onKey);
    const onDown = (e: PointerEvent): void => {
      if (dragRef.current) return;
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open, inline]);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => { if (!open) setQuery(''); }, [open]);
  useEffect(() => { setActiveIndex(0); }, [query, open]); // reset cursor when results change / reopen

  // keep the keyboard-cursor tile scrolled into view as it moves
  useEffect(() => {
    if (!open) return;
    scrollRef.current?.querySelector(`[data-idx="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const onTilePointerDown = (stencil: Stencil, e: React.PointerEvent): void => {
    e.preventDefault();
    dragRef.current = { stencil, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
    setGhost({ stencil, x: e.clientX, y: e.clientY });
  };

  const renderTile = (stencil: Stencil, i: number): ReactElement => (
    <div
      key={stencil.id}
      id={`stencil-opt-${i}`}
      data-testid={`stencil-tile-${stencil.id}`}
      data-idx={i}
      role="option"
      aria-selected={i === activeIndex}
      title={stencil.name}
      style={S.tile(i === activeIndex)}
      onPointerDown={(e) => onTilePointerDown(stencil, e)}
      onMouseEnter={() => setActiveIndex(i)}
    >
      <Thumb editor={editor} stencil={stencil} mode={t.mode} variant={variant} />
      <span style={S.tileLabel}>{stencil.name}</span>
    </div>
  );

  return (
    <div
      ref={rootRef}
      data-nodus-ui=""
      className={className}
      style={{ position: 'relative', display: inline ? 'block' : 'inline-block', width: inline ? '100%' : undefined, fontFamily: t.font.family, ...style }}
    >
      <button
        data-testid="stencil-library-button"
        aria-expanded={open}
        aria-haspopup="dialog"
        style={inline ? { ...S.toggle(open), width: '100%', textAlign: 'left' } : S.toggle(open)}
        onClick={() => setOpen((o) => !o)}
      >
        Stencils ▾
      </button>
      {open && (
        <div data-testid="stencil-library-panel" style={S.panel} onPointerDown={(e) => e.stopPropagation()}>
          <style>{S.scrollCss}</style>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              ref={inputRef}
              data-testid="stencil-search"
              style={S.input}
              placeholder="Search stencils… (box, note, flowchart)"
              value={query}
              role="combobox"
              aria-expanded
              aria-controls="stencil-results"
              aria-activedescendant={flat.length ? `stencil-opt-${activeIndex}` : undefined}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (flat.length) { e.preventDefault(); placeAtCenter(flat[activeIndex] ?? flat[0]!); }
                  return;
                }
                if (!flat.length) return;
                const last = flat.length - 1;
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
                data-testid="stencil-search-clear"
                style={S.clearBtn}
                onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                title="Clear search"
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>

          <button
            data-testid="stencil-save-selection"
            style={S.saveBtn(selCount > 0)}
            disabled={selCount === 0}
            onClick={onSave}
            title={selCount === 0 ? 'Select something on the canvas first' : `Save ${selCount} selected as a stencil`}
          >
            + Save selection as stencil{selCount > 0 ? ` (${selCount})` : ''}
          </button>

          {flat.length === 0 ? (
            <div data-testid="stencil-empty" style={S.empty}>
              {query.trim() ? <>No stencils match “{query.trim()}”</> : 'No stencils available'}
            </div>
          ) : (
            <div ref={scrollRef} id="stencil-results" data-stencil-scroll="" style={S.scroll}>
              {query.trim() === '' && recents.length > 0 && (
                <div>
                  <div style={S.recentLabel}>Recent</div>
                  <div style={S.grid} role="listbox" aria-label="Recent stencils">
                    {recents.map((stencil) => (
                      <div
                        key={`recent-${stencil.id}`}
                        data-testid={`stencil-recent-${stencil.id}`}
                        title={stencil.name}
                        style={S.tile(false)}
                        onPointerDown={(e) => onTilePointerDown(stencil, e)}
                      >
                        <Thumb editor={editor} stencil={stencil} mode={t.mode} variant={variant} />
                        <span style={S.tileLabel}>{stencil.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {groups.map((g) => (
                <div key={g.name}>
                  <div style={S.groupLabel}>{g.name}</div>
                  <div style={S.grid} role="listbox" aria-label={g.name}>
                    {g.stencils.map((s) => renderTile(s, flatIndex.get(s) ?? 0))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={S.footer}>
            {flat.length} of {total} · ↑↓←→ to move · Enter to add · drag to place
          </div>
        </div>
      )}
      {ghost && (
        <div style={{ position: 'fixed', width: TILE_W, left: ghost.x - TILE_W / 2, top: ghost.y - TILE_H / 2, pointerEvents: 'none', opacity: 0.9, zIndex: 100 }}>
          <Thumb editor={editor} stencil={ghost.stencil} mode={t.mode} variant="popover" />
        </div>
      )}
    </div>
  );
}
