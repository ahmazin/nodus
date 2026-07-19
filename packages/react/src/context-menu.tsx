/** A right-click context menu with actions contextual to what was clicked (node / edge / canvas). */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from 'react';
import type { AlignEdge, Editor, EdgeRecord, FlowSpec, Id, RenderItem } from '@nodus/core';
import { DEFAULT_FLOW } from './flow-shared.js';
import { useUiTokens } from './ui/tokens.js';
import { UiTokensProvider, Menu, MenuItem as UiMenuItem } from './ui/primitives.js';
import { injectGlobalStyles } from './ui/global-styles.js';

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

const ALIGN_OPTIONS: { label: string; edge: AlignEdge }[] = [
  { label: 'Align left', edge: 'left' },
  { label: 'Align center (horizontal)', edge: 'hcenter' },
  { label: 'Align right', edge: 'right' },
  { label: 'Align top', edge: 'top' },
  { label: 'Align middle (vertical)', edge: 'vcenter' },
  { label: 'Align bottom', edge: 'bottom' },
];

/**
 * Align / distribute / lock actions for the given ids, filtered to node records. Returns [] when the
 * selection can't support an action: align needs ≥2 nodes, distribute ≥3; lock/unlock show whichever
 * applies to the current lock state (both, if the selection is mixed).
 */
function arrangeItems(editor: Editor, ids: Id[]): MenuItem[] {
  const nodeIds = ids.filter((id) => editor.store.peek(id)?.typeName === 'node');
  const items: MenuItem[] = [];
  if (nodeIds.length >= 2) {
    for (const o of ALIGN_OPTIONS) items.push({ label: o.label, run: () => editor.align(nodeIds, o.edge) });
  }
  if (nodeIds.length >= 3) {
    items.push({ label: 'Distribute horizontally', run: () => editor.distribute(nodeIds, 'h') });
    items.push({ label: 'Distribute vertically', run: () => editor.distribute(nodeIds, 'v') });
  }
  if (nodeIds.length > 0) {
    if (nodeIds.some((id) => !editor.isLocked(id))) items.push({ label: 'Lock', run: () => editor.lock(nodeIds) });
    if (nodeIds.some((id) => editor.isLocked(id))) items.push({ label: 'Unlock', run: () => editor.unlock(nodeIds) });
  }
  return items;
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
  items.push(...arrangeItems(editor, editor.isSelected(id) ? sel : [id]));
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

const MENU_ID = 'nodus-context-menu';

/** Pure keyboard cursor movement for a `role=menu`: wrap on arrows, jump on Home/End, else hold. */
export function nextMenuIndex(current: number, count: number, key: string): number {
  if (count <= 0) return -1;
  switch (key) {
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowUp':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return current;
  }
}

export function NodusContextMenu({ editor, x, y, target, onClose }: NodusContextMenuProps): ReactElement {
  const items = contextMenuItems(editor, target);
  const t = useUiTokens(editor);
  const [active, setActive] = useState(0);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => { injectGlobalStyles(); }, []);
  // Focus management: move focus onto the menu on open (so keys are captured and aria-activedescendant
  // is announced against the role=menu element), and restore focus to the opener on close.
  useEffect(() => {
    restoreRef.current = (document.activeElement as HTMLElement | null) ?? null;
    document.getElementById(MENU_ID)?.focus();
    return () => { restoreRef.current?.focus?.(); };
  }, []);

  const activate = (i: number): void => {
    const it = items[i];
    if (it) { it.run(); onClose(); }
  };
  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(active); return; }
    if (e.key === 'Tab') { e.preventDefault(); return; } // trap focus within the open menu
    const ni = nextMenuIndex(active, items.length, e.key);
    if (ni !== active) { e.preventDefault(); setActive(ni); }
  };

  return (
    <UiTokensProvider tokens={t}>
      <div
        data-nodus-ui=""
        onPointerDown={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
        style={{ position: 'absolute', inset: 0, zIndex: 900 }}
      >
        <Menu
          id={MENU_ID}
          tabIndex={-1}
          aria-label="Actions"
          aria-activedescendant={items.length ? `${MENU_ID}-item-${active}` : undefined}
          onKeyDown={onKeyDown}
          onPointerDown={(e) => e.stopPropagation()}
          style={{ position: 'absolute', left: x, top: y, minWidth: 172, outline: 'none' }}
        >
          {items.map((it, i) => (
            <UiMenuItem
              key={i}
              id={`${MENU_ID}-item-${i}`}
              tabIndex={-1}
              danger={it.danger}
              selected={i === active}
              onMouseEnter={() => setActive(i)}
              onPointerDown={(e) => { e.preventDefault(); activate(i); }}
            >
              {it.label}
            </UiMenuItem>
          ))}
        </Menu>
      </div>
    </UiTokensProvider>
  );
}
