/** A ⌘K command palette. Ships a default command set; accepts custom commands too. */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { AlignEdge, Editor } from '@nodus/core';
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
    { id: 'edit.undo', title: 'Undo', hint: '⌘Z', group: 'Edit', run: () => editor.undo() },
    { id: 'edit.redo', title: 'Redo', hint: '⇧⌘Z', group: 'Edit', run: () => editor.redo() },
    { id: 'edit.duplicate', title: 'Duplicate selection', hint: '⌘D', group: 'Edit', when: hasSel, run: () => editor.duplicate() },
    { id: 'edit.delete', title: 'Delete selection', hint: '⌫', group: 'Edit', when: hasSel, run: () => editor.deleteRecords(editor.selectedIdsArray()) },
    { id: 'edit.group', title: 'Group selection', hint: '⌘G', group: 'Edit', when: hasSel, run: () => editor.group(editor.selectedIdsArray()) },
    { id: 'edit.front', title: 'Bring to front', group: 'Arrange', when: hasSel, run: () => editor.bringToFront(editor.selectedIdsArray()) },
    { id: 'edit.back', title: 'Send to back', group: 'Arrange', when: hasSel, run: () => editor.sendToBack(editor.selectedIdsArray()) },
    ...alignOptions.map((o): Command => ({ id: o.id, title: o.title, group: 'Arrange', when: () => selectedNodeIds().length >= 2, run: () => editor.align(selectedNodeIds(), o.edge) })),
    { id: 'arrange.distributeH', title: 'Distribute horizontally', group: 'Arrange', when: () => selectedNodeIds().length >= 3, run: () => editor.distribute(selectedNodeIds(), 'h') },
    { id: 'arrange.distributeV', title: 'Distribute vertically', group: 'Arrange', when: () => selectedNodeIds().length >= 3, run: () => editor.distribute(selectedNodeIds(), 'v') },
    { id: 'arrange.lock', title: 'Lock selection', group: 'Arrange', when: () => { const n = selectedNodeIds(); return n.length > 0 && n.some((id) => !editor.isLocked(id)); }, run: () => editor.lock(selectedNodeIds()) },
    { id: 'arrange.unlock', title: 'Unlock selection', group: 'Arrange', when: () => { const n = selectedNodeIds(); return n.length > 0 && n.some((id) => editor.isLocked(id)); }, run: () => editor.unlock(selectedNodeIds()) },
    { id: 'edit.selectAll', title: 'Select all', hint: '⌘A', group: 'Edit', run: () => editor.selectAll() },
    { id: 'export.copyImage', title: 'Copy as image', group: 'Export', run: () => void copyOrDownloadImage(editor, { selection: hasSel() }) },
    { id: 'export.downloadPng', title: 'Download PNG', group: 'Export', run: () => void downloadImage(editor, 'diagram.png', { selection: hasSel() }) },
    { id: 'view.fit', title: 'Zoom to fit', group: 'View', run: () => editor.zoomToFit(60) },
    { id: 'view.zoomIn', title: 'Zoom in', group: 'View', run: () => editor.zoomBy(1.25) },
    { id: 'view.zoomOut', title: 'Zoom out', group: 'View', run: () => editor.zoomBy(0.8) },
    ...editor.layouts.size
      ? [...editor.layouts.keys()].map((id): Command => ({ id: `layout.${id}`, title: `Layout: ${id}`, group: 'Layout', run: () => void editor.layout(id, { direction: 'LR' }) }))
      : [],
  ];
}

export interface CommandPaletteProps {
  editor: Editor;
  commands?: Command[];
  /** Hotkey to toggle (default true = ⌘K / Ctrl+K). */
  hotkey?: boolean;
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

function loadRecents(): string[] {
  const store = safeStorage();
  if (!store) return [];
  try {
    const raw = store.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, RECENTS_CAP);
  } catch {
    return []; // corrupt/blocked storage → start empty, never throw into render
  }
}

function saveRecents(ids: string[]): void {
  const store = safeStorage();
  if (!store) return;
  try {
    store.setItem(RECENTS_KEY, JSON.stringify(ids));
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

export function CommandPalette({ editor, commands, hotkey = true }: CommandPaletteProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const [recents, setRecents] = useState<string[]>(() => loadRecents());
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const t = useUiTokens(editor);

  useEffect(() => { injectGlobalStyles(); }, []);

  useEffect(() => {
    if (!hotkey) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkey]);

  // External open trigger: any chrome (e.g. the top-bar "Search ⌘K" button, Lane E) can open the
  // palette by dispatching a `nodus:open-command-palette` window event — no prop wiring needed.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('nodus:open-command-palette', onOpen);
    return () => window.removeEventListener('nodus:open-command-palette', onOpen);
  }, []);

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
    saveRecents(next);
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
        onPointerDown={() => setOpen(false)}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '14vh', zIndex: 1000 }}
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
