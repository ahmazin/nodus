/**
 * Bottom-center page switcher for the playground. A tab per page (click = switch, double-click =
 * rename, × = delete) plus a ＋ to add. While the document is still single-page (no PageRecords) it
 * shows a synthetic "Page 1" tab for the implicit page; ＋ then materializes real pages via
 * `editor.createPage()` (which stamps existing content onto Page 1 and switches to the new page).
 *
 * Reactive: the pages list re-derives on any document change (`store.apply` bumps
 * `sceneIndex.version`), and the active highlight tracks `editor.activePageAtom`.
 */
import { useState, type CSSProperties, type ReactElement } from 'react';
import type { Editor, Id } from '@nodus-dev/core';
import { useUiTokens, useValue } from '@nodus-dev/react';

type PageId = Id<'page'>;

export function PageBar({ editor }: { editor: Editor }): ReactElement {
  const t = useUiTokens(editor);
  // Subscribe to document changes (store.apply bumps sceneIndex.version) and the active page — both
  // return PRIMITIVES so useValue's getSnapshot stays stable. Read the pages array in render, NOT
  // through useValue: editor.pages() builds a fresh array each call, which would infinite-loop
  // useSyncExternalStore (whose snapshot must be referentially stable).
  useValue(() => editor.sceneIndex.version.get());
  const activeId = useValue(() => editor.activePageAtom.get());
  const pages = editor.pages();
  const [renaming, setRenaming] = useState<PageId | null>(null);

  // Real pages, or one synthetic "Page 1" for the implicit single page (id === null).
  const implicit = pages.length === 0;
  const tabs: { id: PageId | null; name: string }[] = implicit
    ? [{ id: null, name: 'Page 1' }]
    : pages.map((p) => ({ id: p.id, name: p.name }));
  const active: PageId | null = implicit ? null : activeId;

  const commitRename = (id: PageId, value: string): void => {
    const name = value.trim();
    if (name) editor.renamePage(id, name);
    setRenaming(null);
  };

  const glass: CSSProperties = {
    background: t.color.glass,
    backdropFilter: `blur(${t.blur}) saturate(1.4)`,
    WebkitBackdropFilter: `blur(${t.blur}) saturate(1.4)`,
  };
  const tab = (isActive: boolean): CSSProperties => ({
    font: `500 13px ${t.font.family}`,
    color: isActive ? t.color.text : t.color.textMuted,
    background: isActive ? t.color.selection : 'transparent',
    border: 'none',
    borderRadius: t.radius.md,
    padding: '6px 11px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    maxWidth: 160,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  });

  return (
    <div
      data-testid="page-bar"
      style={{
        ...glass,
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        padding: 4,
        border: `1px solid ${t.color.border}`,
        borderRadius: t.radius.lg,
        boxShadow: t.shadow.panel,
        maxWidth: 'min(60vw, 620px)',
        overflowX: 'auto',
      }}
    >
      {tabs.map((it) =>
        it.id !== null && renaming === it.id ? (
          <input
            key={it.id}
            autoFocus
            defaultValue={it.name}
            onBlur={(e) => commitRename(it.id as PageId, e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              else if (e.key === 'Escape') setRenaming(null);
            }}
            style={{
              font: `500 13px ${t.font.family}`,
              color: t.color.text,
              background: t.color.panel,
              border: `1px solid ${t.color.accent}`,
              borderRadius: t.radius.md,
              padding: '5px 9px',
              width: 104,
              outline: 'none',
            }}
          />
        ) : (
          <span key={it.id ?? '__implicit'} style={{ display: 'inline-flex', alignItems: 'center' }}>
            <button
              data-testid={it.id === active ? 'page-tab-active' : 'page-tab'}
              onClick={() => editor.setActivePage(it.id)}
              onDoubleClick={() => it.id !== null && setRenaming(it.id)}
              title={it.id !== null ? 'Double-click to rename' : 'The only page'}
              style={tab(it.id === active)}
            >
              {it.name}
            </button>
            {it.id !== null && pages.length > 1 && (
              <button
                aria-label={`Delete ${it.name}`}
                onClick={() => {
                  if (window.confirm(`Delete "${it.name}" and everything on it?`)) editor.deletePage(it.id as PageId);
                }}
                style={{ font: `500 14px ${t.font.family}`, color: t.color.textFaint, background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 5px', lineHeight: 1 }}
              >
                ×
              </button>
            )}
          </span>
        ),
      )}
      <button
        data-testid="page-add"
        aria-label="Add page"
        title="Add page"
        onClick={() => editor.createPage()}
        style={{
          font: `600 16px ${t.font.family}`,
          color: t.color.textMuted,
          background: 'transparent',
          border: `1px dashed ${t.color.border}`,
          borderRadius: t.radius.md,
          width: 30,
          height: 30,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginLeft: 2,
          flexShrink: 0,
        }}
      >
        +
      </button>
    </div>
  );
}
