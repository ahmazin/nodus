/** A ⌘K command palette. Ships a default command set; accepts custom commands too. */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { Editor } from '@nodus/core';
import { copyImage, downloadImage } from './clipboard.js';

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
    { id: 'export.copyImage', title: 'Copy as image', group: 'Export', run: () => void copyImage(editor, { selection: hasSel() }) },
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

export function CommandPalette({ editor, commands, hotkey = true }: CommandPaletteProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

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

  if (!open) return null;

  const run = (c: Command) => { c.run(); setOpen(false); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const c = filtered[idx]; if (c) run(c); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  };

  return (
    <div
      onPointerDown={() => setOpen(false)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '14vh', zIndex: 1000 }}
    >
      <div
        onPointerDown={(e) => e.stopPropagation()}
        style={{ width: 'min(560px, 92vw)', background: '#0d1310', border: '1px solid #28322c', borderRadius: 12, overflow: 'hidden', boxShadow: '0 20px 60px -20px rgba(0,0,0,0.8)', fontFamily: 'ui-monospace, monospace' }}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setIdx(0); }}
          onKeyDown={onKeyDown}
          placeholder="Type a command…"
          style={{ width: '100%', padding: '14px 16px', background: 'transparent', border: 'none', borderBottom: '1px solid #1c2320', color: '#e7ece9', fontSize: 14, outline: 'none' }}
        />
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {filtered.length === 0 && <div style={{ padding: 16, color: '#556058', fontSize: 13 }}>No commands</div>}
          {filtered.map((c, i) => (
            <div
              key={c.id}
              onPointerEnter={() => setIdx(i)}
              onPointerDown={(e) => { e.preventDefault(); run(c); }}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 16px', cursor: 'pointer', background: i === idx ? 'rgba(16,185,129,0.12)' : 'transparent', color: i === idx ? '#10b981' : '#cdd5d0', fontSize: 13 }}
            >
              <span>
                {c.group && <span style={{ color: '#556058', marginRight: 8 }}>{c.group}</span>}
                {c.title}
              </span>
              {c.hint && <kbd style={{ color: '#556058', fontSize: 11 }}>{c.hint}</kbd>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
