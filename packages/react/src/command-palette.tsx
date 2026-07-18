/** A ⌘K command palette. Ships a default command set; accepts custom commands too. */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { Editor } from '@nodus/core';
import { copyOrDownloadImage, downloadImage } from './clipboard.js';
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

export function CommandPalette({ editor, commands, hotkey = true }: CommandPaletteProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
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

  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const all = useMemo(() => (commands ?? defaultCommands(editor)).filter((c) => !c.when || c.when(editor)), [commands, editor, open]);
  const filtered = useMemo(() => {
    const s = q.toLowerCase().trim();
    return s ? all.filter((c) => c.title.toLowerCase().includes(s)) : all;
  }, [all, q]);

  // keep the keyboard-cursor row scrolled into view as it moves
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-idx="${idx}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [idx, open]);

  if (!open) return null;

  const run = (c: Command) => { c.run(); setOpen(false); };
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
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '14vh', zIndex: 1000 }}
      >
        <Panel
          elevated
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          onPointerDown={(e) => e.stopPropagation()}
          style={{ width: 'min(560px, 92vw)', padding: 0, overflow: 'hidden' }}
        >
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
            style={{ width: '100%', boxSizing: 'border-box', padding: '14px 16px', background: 'transparent', border: 'none', borderBottom: `1px solid ${t.color.border}`, color: t.color.text, fontSize: 14, outline: 'none', fontFamily: t.font.family }}
          />
          <div ref={listRef} id={LIST_ID} role="listbox" aria-label="Commands" style={{ maxHeight: 360, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: t.color.textMuted, fontSize: t.font.size.md }}>
                <div aria-hidden="true" style={{ fontSize: 22, marginBottom: 6, opacity: 0.7 }}>⌘</div>
                No commands match{q.trim() ? ` “${q.trim()}”` : ''}
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
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                      padding: '10px 16px', cursor: 'pointer', fontSize: t.font.size.md, color: t.color.text,
                      background: activeRow ? t.color.selection : 'transparent',
                      boxShadow: activeRow ? `inset 2px 0 0 ${t.color.accent}` : 'none',
                    }}
                  >
                    <span>
                      {c.group && <span style={{ color: t.color.textFaint, marginRight: 8 }}>{c.group}</span>}
                      {c.title}
                    </span>
                    {c.hint && <kbd style={{ color: t.color.textFaint, fontSize: t.font.size.xs }}>{c.hint}</kbd>}
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
