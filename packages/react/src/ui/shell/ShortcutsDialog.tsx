/**
 * `ShortcutsDialog` — a keyboard-shortcut help modal, and `ShortcutsButton`, a self-contained `?`
 * trigger that owns the open/close state.
 *
 * The dialog is a proper ARIA modal: `role="dialog"` + `aria-modal` + `aria-labelledby`, rendered
 * through a portal, focus moved in on open and restored on close, Tab/Shift+Tab trapped inside, and
 * Escape / backdrop-click to dismiss. Shortcut rows are data (`ShortcutSection[]`) so an app can
 * document its own bindings; a sensible default set ships as `DEFAULT_SHORTCUTS`.
 */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@ahmazin/core';
import { IconButton } from '../primitives.js';
import { useUiTokens, type UiTokens } from '../tokens.js';
import { CloseIcon, HelpIcon } from './icons.js';

export interface ShortcutRow {
  /** One or more key labels shown as `<kbd>` chips (e.g. `'⌘Z'` or `['G', 'then', 'D']`). */
  keys: string | string[];
  description: string;
}
export interface ShortcutSection {
  title: string;
  items: ShortcutRow[];
}

/** A reasonable default set; apps can pass their own `sections`. */
export const DEFAULT_SHORTCUTS: ShortcutSection[] = [
  {
    title: 'Tools',
    items: [
      { keys: 'V', description: 'Select / move' },
      { keys: 'R', description: 'Rectangle' },
      { keys: 'E', description: 'Ellipse' },
      { keys: 'D', description: 'Diamond' },
      { keys: 'T', description: 'Text' },
      { keys: 'L', description: 'Line' },
      { keys: 'A', description: 'Arrow' },
    ],
  },
  {
    title: 'Edit',
    items: [
      { keys: '⌘Z', description: 'Undo' },
      { keys: '⇧⌘Z', description: 'Redo' },
      { keys: ['⌫'], description: 'Delete selection' },
      { keys: ['←', '→', '↑', '↓'], description: 'Nudge selection' },
    ],
  },
  {
    title: 'View',
    items: [
      { keys: '⌘K', description: 'Command palette' },
      { keys: ['+', '−'], description: 'Zoom in / out' },
      { keys: '⇧1', description: 'Fit to content' },
      { keys: '?', description: 'This help' },
    ],
  },
];

// ---------------------------------------------------------------------------

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export interface ShortcutsDialogProps {
  editor: Editor;
  open: boolean;
  onClose: () => void;
  sections?: ShortcutSection[];
  tokens?: UiTokens;
}

export function ShortcutsDialog(
  { editor, open, onClose, sections = DEFAULT_SHORTCUTS, tokens }: ShortcutsDialogProps,
): ReactElement | null {
  const themed = useUiTokens(editor);
  const t = tokens ?? themed;
  const panelRef = useRef<HTMLDivElement>(null);

  // Move focus in on open (to the first focusable — the close button); restore it to the
  // previously-focused element on close.
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus());
    return () => {
      cancelAnimationFrame(raf);
      prev?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!nodes || nodes.length === 0) {
      e.preventDefault();
      return;
    }
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const overlayStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: t.space(4),
    background: 'rgba(0,0,0,0.45)',
    ['--nodus-focus-ring' as string]: t.focusRing,
    ['--nodus-font' as string]: t.font.family,
  };
  const panelStyle: CSSProperties = {
    width: 'min(460px, 100%)',
    maxHeight: '80vh',
    overflowY: 'auto',
    background: t.color.panel,
    color: t.color.text,
    border: `1px solid ${t.color.border}`,
    borderRadius: t.radius.lg,
    boxShadow: t.shadow.popover,
    fontFamily: t.font.family,
    fontSize: t.font.size.sm,
  };
  const kbdStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 20,
    padding: '2px 6px',
    borderRadius: t.radius.sm,
    background: t.color.surfaceHover,
    border: `1px solid ${t.color.border}`,
    color: t.color.text,
    fontSize: t.font.size.xs,
    lineHeight: 1.4,
  };

  const titleId = 'nodus-shortcuts-title';

  const dialog = (
    <div
      data-nodus-ui=""
      style={overlayStyle}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={panelStyle}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: t.space(2),
            padding: `${t.space(2.5)}px ${t.space(3)}px`,
            borderBottom: `1px solid ${t.color.border}`,
            position: 'sticky',
            top: 0,
            background: t.color.panel,
          }}
        >
          <h2 id={titleId} style={{ margin: 0, fontSize: t.font.size.md, fontWeight: 600 }}>
            Keyboard shortcuts
          </h2>
          <IconButton
            tokens={t}
            size="sm"
            icon={<CloseIcon />}
            aria-label="Close"
            onClick={onClose}
          />
        </div>

        <div style={{ padding: `${t.space(2)}px ${t.space(3)}px ${t.space(3)}px` }}>
          {sections.map((section) => (
            <section key={section.title} style={{ marginTop: t.space(2) }}>
              <div
                style={{
                  fontSize: t.font.size.xs,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: t.color.textMuted,
                  marginBottom: t.space(1),
                }}
              >
                {section.title}
              </div>
              {section.items.map((row) => (
                <div
                  key={row.description}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: t.space(3),
                    padding: `${t.space(1)}px 0`,
                  }}
                >
                  <span style={{ color: t.color.text }}>{row.description}</span>
                  <span style={{ display: 'inline-flex', gap: t.space(1), flex: '0 0 auto' }}>
                    {(Array.isArray(row.keys) ? row.keys : [row.keys]).map((k, i) => (
                      <kbd key={i} style={kbdStyle}>
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}

// ---------------------------------------------------------------------------

export interface ShortcutsButtonProps {
  editor: Editor;
  sections?: ShortcutSection[];
  tokens?: UiTokens;
  size?: 'sm' | 'md';
  style?: CSSProperties;
}

/** A `?` icon button that opens the shortcuts dialog and manages its own open state. */
export function ShortcutsButton(
  { editor, sections, tokens, size = 'md', style }: ShortcutsButtonProps,
): ReactElement {
  const themed = useUiTokens(editor);
  const t = tokens ?? themed;
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton
        tokens={t}
        size={size}
        variant="ghost"
        icon={<HelpIcon />}
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        onClick={() => setOpen(true)}
        style={style}
      />
      <ShortcutsDialog editor={editor} open={open} onClose={() => setOpen(false)} sections={sections} tokens={tokens} />
    </>
  );
}
