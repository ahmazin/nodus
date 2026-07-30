/** A ⌘K command palette. Ships a default command set; accepts custom commands too. */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import type { AlignEdge, Editor } from '@ahmazin/core';
import { copyOrDownloadImage, downloadImage } from './clipboard.js';
import { fuzzyRank } from './fuzzy.js';
import { useUiTokens } from './ui/tokens.js';
import { UiTokensProvider, Panel } from './ui/primitives.js';
import { injectGlobalStyles } from './ui/global-styles.js';

export interface Command {
  id: string;
  title: string;
  hint?: string;
  group?: string;
  run: () => void;
  when?: (editor: Editor) => boolean;
}

/** Core command ids the curated palette already surfaces (as `edit.*` / `view.*` entries), so the
 *  registry-extras pass below doesn't list them twice. */
const CURATED_COMMAND_IDS = new Set(['undo', 'redo', 'zoomIn', 'zoomOut', 'zoomToFit', 'selectAll', 'delete', 'duplicate']);

/** Match a KeyboardEvent against a hotkey spec like `'mod+k'` (`mod` = ⌘ on macOS / Ctrl elsewhere;
 *  also accepts `shift`/`alt`). The final token is the key. */
function matchesHotkey(e: KeyboardEvent, spec: string): boolean {
  const parts = spec.toLowerCase().split('+').map((p) => p.trim()).filter(Boolean);
  const key = parts.at(-1) ?? '';
  const mods = new Set(parts.slice(0, -1));
  if ((mods.has('mod') || mods.has('meta') || mods.has('cmd') || mods.has('ctrl')) !== (e.metaKey || e.ctrlKey)) return false;
  if (mods.has('shift') !== e.shiftKey) return false;
  if (mods.has('alt') !== e.altKey) return false;
  return e.key.toLowerCase() === key;
}

export function defaultCommands(editor: Editor): Command[] {
  const hasSel = () => editor.selectedIdsArray().length > 0;
  // Align/distribute/lock act on nodes only; count node records so entries gate on the real target set.
  const selectedNodeIds = () => editor.selectedIdsArray().filter((id) => editor.store.peek(id)?.typeName === 'node');
  const alignOptions: { id: string; title: string; edge: AlignEdge }[] = [
    { id: 'arrange.alignLeft', title: 'Align left', edge: 'left' },
    { id: 'arrange.alignHCenter', title: 'Align center (horizontal)', edge: 'hcenter' },
    { id: 'arrange.alignRight', title: 'Align right', edge: 'right' },
    { id: 'arrange.alignTop', title: 'Align top', edge: 'top' },
    { id: 'arrange.alignVCenter', title: 'Align middle (vertical)', edge: 'vcenter' },
    { id: 'arrange.alignBottom', title: 'Align bottom', edge: 'bottom' },
  ];
  return [
    { id: 'tool.select', title: 'Tool: Select', group: 'Tools', run: () => editor.setTool('select') },
    { id: 'tool.connect', title: 'Tool: Connect', group: 'Tools', run: () => editor.setTool('connect') },
    { id: 'tool.create', title: 'Tool: Create node', group: 'Tools', run: () => editor.setTool('create') },
    // Default actions dispatch through the shared command registry (editor.execute) — same code the
    // host keybindings and context menu run — so behavior and `enabled` gating stay consistent.
    { id: 'edit.undo', title: 'Undo', hint: '⌘Z', group: 'Edit', run: () => void editor.execute('undo') },
    { id: 'edit.redo', title: 'Redo', hint: '⇧⌘Z', group: 'Edit', run: () => void editor.execute('redo') },
    { id: 'edit.duplicate', title: 'Duplicate selection', hint: '⌘D', group: 'Edit', when: hasSel, run: () => void editor.execute('duplicate') },
    { id: 'edit.delete', title: 'Delete selection', hint: '⌫', group: 'Edit', when: hasSel, run: () => void editor.execute('delete') },
    { id: 'edit.group', title: 'Group selection', hint: '⌘G', group: 'Edit', when: hasSel, run: () => editor.group(editor.selectedIdsArray()) },
    { id: 'edit.front', title: 'Bring to front', group: 'Arrange', when: hasSel, run: () => editor.bringToFront(editor.selectedIdsArray()) },
    { id: 'edit.back', title: 'Send to back', group: 'Arrange', when: hasSel, run: () => editor.sendToBack(editor.selectedIdsArray()) },
    ...alignOptions.map((o): Command => ({ id: o.id, title: o.title, group: 'Arrange', when: () => selectedNodeIds().length >= 2, run: () => editor.align(selectedNodeIds(), o.edge) })),
    { id: 'arrange.distributeH', title: 'Distribute horizontally', group: 'Arrange', when: () => selectedNodeIds().length >= 3, run: () => editor.distribute(selectedNodeIds(), 'h') },
    { id: 'arrange.distributeV', title: 'Distribute vertically', group: 'Arrange', when: () => selectedNodeIds().length >= 3, run: () => editor.distribute(selectedNodeIds(), 'v') },
    { id: 'arrange.lock', title: 'Lock selection', group: 'Arrange', when: () => { const n = selectedNodeIds(); return n.length > 0 && n.some((id) => !editor.isLocked(id)); }, run: () => editor.lock(selectedNodeIds()) },
    { id: 'arrange.unlock', title: 'Unlock selection', group: 'Arrange', when: () => { const n = selectedNodeIds(); return n.length > 0 && n.some((id) => editor.isLocked(id)); }, run: () => editor.unlock(selectedNodeIds()) },
    { id: 'edit.selectAll', title: 'Select all', hint: '⌘A', group: 'Edit', run: () => void editor.execute('selectAll') },
    { id: 'export.copyImage', title: 'Copy as image', group: 'Export', run: () => void copyOrDownloadImage(editor, { selection: hasSel() }) },
    { id: 'export.downloadPng', title: 'Download PNG', group: 'Export', run: () => void downloadImage(editor, 'diagram.png', { selection: hasSel() }) },
    { id: 'view.fit', title: 'Zoom to fit', group: 'View', run: () => editor.zoomToFit(60) },
    { id: 'view.zoomIn', title: 'Zoom in', group: 'View', run: () => editor.zoomBy(1.25) },
    { id: 'view.zoomOut', title: 'Zoom out', group: 'View', run: () => editor.zoomBy(0.8) },
    ...editor.layouts.size
      ? [...editor.layouts.keys()].map((id): Command => ({ id: `layout.${id}`, title: `Layout: ${id}`, group: 'Layout', run: () => void editor.layout(id, { direction: 'LR' }) }))
      : [],
    // Surface any commands registered on the editor (e.g. by plugins) that the curated set above
    // doesn't already cover, so the registry is the single source of truth for extensibility.
    ...editor.commands
      .list()
      .filter((c) => !CURATED_COMMAND_IDS.has(c.id))
      .map((c): Command => ({
        id: c.id,
        title: c.label,
        group: 'Commands',
        when: (e) => e.commands.isEnabled(c.id, e),
        run: () => void editor.execute(c.id),
      })),
  ];
}

/** The window event name a default-configured palette listens on to open programmatically. */
export const OPEN_COMMAND_PALETTE_EVENT = 'nodus:open-command-palette';

export interface CommandPaletteProps {
  editor: Editor;
  commands?: Command[];
  /** Hotkey spec that toggles the palette, e.g. `'mod+k'` (the default — ⌘K / Ctrl+K), `'mod+shift+p'`.
   *  Pass `false` to disable the built-in hotkey (open it yourself via the open event). */
  hotkey?: string | false;
  /** Window event name that opens THIS palette (default {@link OPEN_COMMAND_PALETTE_EVENT}).
   *  With several palettes on one page, give each its own name — the default is shared, so a
   *  default-name dispatch opens every default-configured palette. */
  openEventName?: string;
  /** localStorage key for the recents (MRU) list (default `'nodus:command-palette:recents'`).
   *  Namespace it per instance/document when two palettes must not share recents. */
  storageKey?: string;
  className?: string;
  style?: CSSProperties;
}

const LIST_ID = 'nodus-command-list';

// --- Recents (MRU) -----------------------------------------------------------------------------
// The ids of recently-run commands, newest first, persisted so they survive reloads. When the query
// is empty they surface first (in MRU order); otherwise each recent gets a sub-1 score boost, so it
// only ever breaks ties toward what you just used — never overriding a stronger fuzzy match.
const RECENTS_KEY = 'nodus:command-palette:recents';
const RECENTS_CAP = 8;
const RECENT_BOOST_UNIT = 0.1; // max boost = RECENTS_CAP * unit = 0.8 (< 1) → tie-break only

/** A usable `Storage`, or `null` under SSR / disabled / private-mode-throwing storage. */
function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function loadRecents(key: string = RECENTS_KEY): string[] {
  const store = safeStorage();
  if (!store) return [];
  try {
    const raw = store.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, RECENTS_CAP);
  } catch {
    return []; // corrupt/blocked storage → start empty, never throw into render
  }
}

function saveRecents(ids: string[], key: string = RECENTS_KEY): void {
  const store = safeStorage();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(ids));
  } catch {
    // quota exceeded / disabled — recents are best-effort, never fatal
  }
}

/** Move `id` to the front of the MRU list, de-duplicated and capped. */
function pushRecent(recents: string[], id: string): string[] {
  return [id, ...recents.filter((x) => x !== id)].slice(0, RECENTS_CAP);
}

/**
 * Curated 2-char (or symbolic) badge labels keyed by command group, shown in the chip at the left
 * of each row. Unknown groups fall back to their first two letters uppercased; commands with no
 * group get a neutral dot. Presentation only — never affects filtering or execution.
 */
const GROUP_BADGES: Record<string, string> = {
  Layout: 'LO',
  Arrange: 'AL',
  Create: '+',
  View: 'VW',
  Export: 'EX',
  Import: 'IM',
};

function commandBadge(group: string | undefined): string {
  if (!group) return '•';
  return GROUP_BADGES[group] ?? group.slice(0, 2).toUpperCase();
}

export function CommandPalette({ editor, commands, hotkey = 'mod+k', openEventName = OPEN_COMMAND_PALETTE_EVENT, storageKey = RECENTS_KEY, className, style }: CommandPaletteProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const [recents, setRecents] = useState<string[]>(() => loadRecents(storageKey));
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const t = useUiTokens(editor);

  useEffect(() => { injectGlobalStyles(); }, []);

  useEffect(() => {
    if (hotkey === false) return;
    const spec = hotkey;
    const onKey = (e: KeyboardEvent) => {
      if (matchesHotkey(e, spec)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkey]);

  // External open trigger: any chrome (e.g. a top-bar "Search ⌘K" button) can open the palette by
  // dispatching the configured window event — no prop wiring needed. Multi-palette pages give each
  // instance its own `openEventName` so a dispatch targets exactly one.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(openEventName, onOpen);
    return () => window.removeEventListener(openEventName, onOpen);
  }, [openEventName]);

  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const all = useMemo(() => (commands ?? defaultCommands(editor)).filter((c) => !c.when || c.when(editor)), [commands, editor, open]);
  const filtered = useMemo(() => {
    // Fuzzy subsequence match/rank over title (+ group, so "arrange"/"view" also surface a group).
    const ranked = fuzzyRank(q, all, (c) => (c.group ? `${c.title} ${c.group}` : c.title));
    // Nudge recently-run commands up. The boost is < 1, so with an empty query (all scores 0) it
    // orders recents first in MRU order; with a real query it only breaks otherwise-equal scores.
    const boosted = ranked.map((r) => {
      const rank = recents.indexOf(r.item.id);
      const boost = rank === -1 ? 0 : (RECENTS_CAP - rank) * RECENT_BOOST_UNIT;
      return { cmd: r.item, score: r.score + boost };
    });
    // `ranked` is already (score desc, input order); a stable sort keeps that order for ties.
    boosted.sort((a, b) => b.score - a.score);
    return boosted.map((b) => b.cmd);
  }, [all, q, recents]);

  // keep the keyboard-cursor row scrolled into view as it moves
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-idx="${idx}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [idx, open]);

  if (!open) return null;

  const run = (c: Command) => {
    const next = pushRecent(recents, c.id);
    setRecents(next);
    saveRecents(next, storageKey);
    c.run();
    setOpen(false);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Home') { e.preventDefault(); setIdx(0); }
    else if (e.key === 'End') { e.preventDefault(); setIdx(Math.max(0, filtered.length - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const c = filtered[idx]; if (c) run(c); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  };

  return (
    <UiTokensProvider tokens={t}>
      <div
        data-nodus-ui=""
        className={className}
        onPointerDown={() => setOpen(false)}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '14vh', zIndex: 1000, ...style }}
      >
        <Panel
          elevated
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          onPointerDown={(e) => e.stopPropagation()}
          style={{ width: 'min(560px, 92vw)', padding: 0, overflow: 'hidden', border: `1px solid ${t.color.borderStrong}`, borderRadius: 14, boxShadow: t.shadow.popover }}
        >
          {/* Header: search glyph + query input + an ESC affordance chip */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: `1px solid ${t.color.border}` }}>
            <svg aria-hidden="true" width={16} height={16} viewBox="0 0 24 24" fill="none" strokeWidth={2} style={{ stroke: t.color.textFaint, flexShrink: 0 }}>
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.2-3.2" strokeLinecap="round" />
            </svg>
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => { setQ(e.target.value); setIdx(0); }}
              onKeyDown={onKeyDown}
              placeholder="Type a command…"
              aria-label="Search commands"
              role="combobox"
              aria-expanded
              aria-controls={LIST_ID}
              aria-activedescendant={filtered.length ? `nodus-cmd-${idx}` : undefined}
              style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', background: 'transparent', border: 'none', color: t.color.text, fontSize: t.font.size.lg, outline: 'none', fontFamily: t.font.family }}
            />
            <span aria-hidden="true" style={{ fontFamily: t.font.mono, fontSize: '10.5px', color: t.color.textFaint, border: `1px solid ${t.color.borderStrong}`, borderRadius: 4, padding: '2px 6px' }}>ESC</span>
          </div>
          <div ref={listRef} id={LIST_ID} role="listbox" aria-label="Commands" style={{ maxHeight: 'min(52vh, 380px)', overflowY: 'auto', padding: 6 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 26, textAlign: 'center', color: t.color.textFaint, fontSize: t.font.size.md }}>
                No matching commands
              </div>
            ) : (
              filtered.map((c, i) => {
                const activeRow = i === idx;
                return (
                  <div
                    key={c.id}
                    id={`nodus-cmd-${i}`}
                    data-idx={i}
                    role="option"
                    aria-selected={activeRow}
                    onPointerEnter={() => setIdx(i)}
                    onPointerDown={(e) => { e.preventDefault(); run(c); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '9px 10px', borderRadius: 9, cursor: 'pointer',
                      background: activeRow ? t.color.canvas : 'transparent',
                    }}
                  >
                    <span aria-hidden="true" style={{ width: 26, height: 26, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, background: t.color.canvas, color: t.color.accent, fontFamily: t.font.mono, fontSize: 11, fontWeight: 700 }}>
                      {commandBadge(c.group)}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, textAlign: 'left', fontSize: 14, color: t.color.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.title}
                    </span>
                    {c.hint && <kbd style={{ fontFamily: t.font.mono, fontSize: '11px', color: t.color.textFaint, flexShrink: 0 }}>{c.hint}</kbd>}
                    {c.group && <span style={{ fontFamily: t.font.mono, fontSize: 11, color: t.color.textFaint, flexShrink: 0 }}>{c.group}</span>}
                  </div>
                );
              })
            )}
          </div>
          {/* visually-hidden live region: announces the result count as the query changes */}
          <div
            aria-live="polite"
            style={{ position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', whiteSpace: 'nowrap', border: 0 }}
          >
            {filtered.length} command{filtered.length === 1 ? '' : 's'}
          </div>
        </Panel>
      </div>
    </UiTokensProvider>
  );
}
