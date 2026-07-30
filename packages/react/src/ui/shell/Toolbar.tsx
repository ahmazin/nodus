/**
 * `Toolbar` — the shell's top bar container. A themed surface with a bottom hairline that lays its
 * children out in a horizontal, wrapping row. It carries `role="toolbar"` (an ARIA landmark grouping
 * the controls inside it) and re-skins with the active theme.
 *
 * Purely presentational: the app supplies the controls (brand, tool groups, zoom, theme toggle, …)
 * as children, so the toolbar stays preset-agnostic.
 */

import type { CSSProperties, HTMLAttributes, ReactElement, ReactNode } from 'react';
import type { Editor } from '@ahmazin/core';
import { useUiTokens, type UiTokens } from '../tokens.js';

export interface ToolbarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  editor: Editor;
  /** Override the theme-derived tokens (rarely needed). */
  tokens?: UiTokens;
  /** Accessible name for the toolbar landmark. */
  'aria-label'?: string;
  children: ReactNode;
}

export function Toolbar(
  { editor, tokens, style, children, 'aria-label': ariaLabel, ...rest }: ToolbarProps,
): ReactElement {
  const themed = useUiTokens(editor);
  const t = tokens ?? themed;
  const barStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: t.space(2),
    padding: `${t.space(1.5)}px ${t.space(2.5)}px`,
    background: t.color.surface,
    color: t.color.text,
    borderBottom: `1px solid ${t.color.border}`,
    fontFamily: t.font.family,
    fontSize: t.font.size.sm,
    ['--nodus-focus-ring' as string]: t.focusRing,
    ['--nodus-font' as string]: t.font.family,
    ...style,
  };
  return (
    <div data-nodus-ui="" {...rest} role="toolbar" aria-label={ariaLabel ?? 'Main toolbar'} style={barStyle}>
      {children}
    </div>
  );
}
