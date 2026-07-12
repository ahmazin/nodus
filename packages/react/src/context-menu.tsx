/** A right-click context menu with actions contextual to what was clicked (node / edge / canvas). */
import type { ReactElement } from 'react';
import type { Editor, Id, RenderItem } from '@nodus/core';

export interface MenuItem {
  label: string;
  run: () => void;
  danger?: boolean;
}

function styleItems(editor: Editor, ids: Id[]): MenuItem[] {
  return [
    { label: 'Style → red', run: () => editor.setStyle(ids, { stroke: '#ef4444', text: '#ef4444', glow: '#ef4444' }) },
    { label: 'Style → amber', run: () => editor.setStyle(ids, { stroke: '#f59e0b', text: '#f59e0b', glow: '#f59e0b' }) },
    { label: 'Style → dashed', run: () => editor.setStyle(ids, { dash: [5, 4] }) },
    { label: 'Clear style', run: () => editor.clearStyle(ids) },
  ];
}

export function contextMenuItems(editor: Editor, target: RenderItem | null): MenuItem[] {
  const sel = editor.selectedIdsArray();
  if (!target) {
    const items: MenuItem[] = [];
    if (editor.hasClipboard()) items.push({ label: 'Paste', run: () => editor.paste() });
    items.push({ label: 'Select all', run: () => editor.selectAll() });
    items.push({ label: 'Zoom to fit', run: () => editor.zoomToFit(60) });
    return items;
  }
  const id = target.id as Id;
  if (target.kind === 'edge') {
    return [
      { label: 'Edit label', run: () => editor.beginEdit(id) },
      { label: 'Router → orthogonal', run: () => editor.setEdgeRouter(id, 'orthogonal') },
      { label: 'Router → straight', run: () => editor.setEdgeRouter(id, 'straight') },
      { label: 'Router → bezier', run: () => editor.setEdgeRouter(id, 'bezier') },
      ...styleItems(editor, [id]),
      { label: 'Delete edge', danger: true, run: () => editor.deleteRecords([id]) },
    ];
  }
  const rec = editor.store.peek(id);
  const isGroup = rec?.typeName === 'node' && rec.type === 'group';
  const items: MenuItem[] = [
    { label: 'Edit label', run: () => editor.beginEdit(id) },
    { label: 'Duplicate', run: () => { if (!editor.isSelected(id)) editor.select([id]); editor.duplicate(); } },
  ];
  if (isGroup) items.push({ label: 'Ungroup', run: () => editor.ungroup(id) });
  else if (sel.length > 1 && editor.isSelected(id)) items.push({ label: 'Group selection', run: () => editor.group(sel) });
  items.push({ label: 'Bring to front', run: () => editor.bringToFront(editor.isSelected(id) ? sel : [id]) });
  items.push({ label: 'Send to back', run: () => editor.sendToBack(editor.isSelected(id) ? sel : [id]) });
  items.push(...styleItems(editor, editor.isSelected(id) ? sel : [id]));
  items.push({ label: 'Delete', danger: true, run: () => editor.deleteRecords(editor.isSelected(id) ? sel : [id]) });
  return items;
}

export interface NodusContextMenuProps {
  editor: Editor;
  x: number;
  y: number;
  target: RenderItem | null;
  onClose: () => void;
}

export function NodusContextMenu({ editor, x, y, target, onClose }: NodusContextMenuProps): ReactElement {
  const items = contextMenuItems(editor, target);
  return (
    <div onPointerDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} style={{ position: 'absolute', inset: 0, zIndex: 900 }}>
      <div
        onPointerDown={(e) => e.stopPropagation()}
        style={{ position: 'absolute', left: x, top: y, minWidth: 172, background: '#0d1310', border: '1px solid #28322c', borderRadius: 9, padding: 5, boxShadow: '0 14px 40px -16px rgba(0,0,0,0.8)', fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}
      >
        {items.map((it, i) => (
          <div
            key={i}
            onPointerDown={(e) => { e.preventDefault(); it.run(); onClose(); }}
            style={{ padding: '7px 10px', borderRadius: 6, cursor: 'pointer', color: it.danger ? '#f87171' : '#cdd5d0' }}
            onPointerEnter={(e) => (e.currentTarget.style.background = it.danger ? 'rgba(248,113,113,0.12)' : 'rgba(16,185,129,0.12)')}
            onPointerLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            {it.label}
          </div>
        ))}
      </div>
    </div>
  );
}
