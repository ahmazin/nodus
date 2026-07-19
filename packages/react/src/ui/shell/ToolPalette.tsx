/**
 * `ToolPalette` — the shell's tool switcher. A vertical (or horizontal) strip of icon buttons that
 * activate editor tools. It is **config-driven**: the app passes a `tools` list, so the palette is
 * preset-agnostic (infra, draw, diagrams, or a mix). The active tool is highlighted and stays in
 * sync no matter who switched it — click, keyboard shortcut, or command palette.
 */

import { useMemo, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import type { Editor } from '@nodus/core';
import { IconButton } from '../primitives.js';
import { Divider } from '../primitives.js';
import { useUiTokens, type UiTokens } from '../tokens.js';
import { useCurrentTool } from './use-current-tool.js';

export interface ToolItem {
  /** Stable key for active-state matching (unique within the list). */
  id: string;
  /** Accessible label + tooltip. */
  label: string;
  icon: ReactNode;
  /** Editor tool this entry activates (e.g. `'select'`, `'create'`, `'line'`). */
  toolId: string;
  /** Config passed to `editor.setTool` (e.g. `{ type: 'draw.rect' }`). */
  config?: Record<string, unknown>;
  /** Optional shortcut hint, appended to the tooltip/label. */
  shortcut?: string;
  /** Optional `data-testid` on this entry's button, for E2E targeting. */
  testId?: string;
}

/** A palette entry — a tool, or the string `'divider'` to group tools visually. */
export type ToolPaletteEntry = ToolItem | 'divider';

export interface ToolPaletteProps {
  editor: Editor;
  tools: ToolPaletteEntry[];
  tokens?: UiTokens;
  orientation?: 'vertical' | 'horizontal';
  'aria-label'?: string;
  style?: CSSProperties;
}

export function ToolPalette(
  { editor, tools, tokens, orientation = 'vertical', 'aria-label': ariaLabel, style }: ToolPaletteProps,
): ReactElement {
  const themed = useUiTokens(editor);
  const t = tokens ?? themed;
  const currentToolId = useCurrentTool(editor);
  const [pickedId, setPickedId] = useState<string | null>(null);

  // The active entry: the last one the user picked while its tool is still current, else the first
  // entry mapped to the live tool (covers shortcut/palette-driven switches).
  const activeId = useMemo<string | null>(() => {
    const matches = tools.filter((x): x is ToolItem => x !== 'divider' && x.toolId === currentToolId);
    if (matches.length === 0) return null;
    if (pickedId && matches.some((m) => m.id === pickedId)) return pickedId;
    return matches[0]!.id;
  }, [tools, currentToolId, pickedId]);

  const pick = (item: ToolItem): void => {
    editor.setTool(item.toolId, item.config);
    setPickedId(item.id);
  };

  const vertical = orientation === 'vertical';
  // Default (standalone) chrome. When docked flush by the app shell, the incoming `style` prop
  // clears background/border/shadow/radius — it is spread LAST, so it always wins over these.
  const containerStyle: CSSProperties = {
    display: 'inline-flex',
    flexDirection: vertical ? 'column' : 'row',
    alignItems: 'center',
    gap: t.space(1),
    padding: vertical ? `${t.space(2)}px 0` : `0 ${t.space(2)}px`,
    ...(vertical ? { width: 50 } : {}),
    background: t.color.panel,
    border: `1px solid ${t.color.border}`,
    borderRadius: t.radius.lg,
    boxShadow: t.shadow.panel,
    ['--nodus-focus-ring' as string]: t.focusRing,
    ['--nodus-font' as string]: t.font.family,
    ...style,
  };

  // A tool is a 34px square. Active = translucent-accent glow wash behind an accent-colored glyph;
  // idle = transparent with a muted glyph. Layered over `IconButton`'s ghost variant via `style`.
  const toolButtonStyle = (isActive: boolean): CSSProperties => ({
    width: 34,
    height: 34,
    ...(isActive
      ? { background: t.color.selection, color: t.color.accent }
      : { color: t.color.textMuted }),
  });

  return (
    <div
      data-nodus-ui=""
      role="toolbar"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={ariaLabel ?? 'Tools'}
      style={containerStyle}
    >
      {tools.map((entry, i) =>
        entry === 'divider' ? (
          <Divider
            key={`div-${i}`}
            tokens={t}
            vertical={!vertical}
            style={vertical ? { width: 22, margin: `${t.space(1)}px 0` } : { height: 22, margin: `0 ${t.space(1)}px` }}
          />
        ) : (
          <IconButton
            key={entry.id}
            tokens={t}
            icon={entry.icon}
            variant="ghost"
            active={entry.id === activeId}
            aria-label={entry.shortcut ? `${entry.label} (${entry.shortcut})` : entry.label}
            title={entry.shortcut ? `${entry.label} — ${entry.shortcut}` : entry.label}
            data-testid={entry.testId}
            onClick={() => pick(entry)}
            style={toolButtonStyle(entry.id === activeId)}
          />
        ),
      )}
    </div>
  );
}
