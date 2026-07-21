/**
 * Slim frosted status bar footer: active tool · live cursor world-coords · selection · zoom.
 *
 * Sits below the main row (docked layout is `flexDirection: 'column'`, so this is a `flexShrink: 0`
 * footer at the bottom of the shell). Uses the same glass recipe (`t.color.glass` + backdrop blur)
 * as the rest of the chrome (top bar, left rail, zoom controls, minimap).
 */

import type { ReactElement } from 'react';
import type { Editor } from '@nodus/core';
import { useCurrentTool, useUiTokens, useValue } from '@nodus/react';

/** `'x, y'` rounded to integers, or an em-dash when there's no cursor position (e.g. pointer left the canvas). */
export function formatCoords(p: { x: number; y: number } | null): string {
  return p ? `${Math.round(p.x)}, ${Math.round(p.y)}` : '—';
}

export interface StatusBarProps {
  editor: Editor;
  cursor: { x: number; y: number } | null;
}

export function StatusBar({ editor, cursor }: StatusBarProps): ReactElement {
  const t = useUiTokens(editor);
  const tool = useCurrentTool(editor);
  const z = useValue(() => editor.cameraAtom.get().z);
  const selCount = useValue(() => editor.selectedAtom.get().size);
  const nodeCount = useValue(() => (editor.sceneIndex.version.get(), editor.store.nodes().length));

  return (
    <div
      data-testid="statusbar"
      style={{
        height: 26,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '0 12px',
        background: t.color.glass,
        backdropFilter: `blur(${t.blur}) saturate(1.4)`,
        WebkitBackdropFilter: `blur(${t.blur}) saturate(1.4)`,
        borderTop: `1px solid ${t.color.border}`,
        fontSize: t.font.size.xs,
        color: t.color.textMuted,
      }}
    >
      <span>{tool}</span>
      <span style={{ fontFamily: t.font.mono }}>xy: {formatCoords(cursor)}</span>
      {selCount > 0 && <span>{selCount} selected</span>}
      <span>{nodeCount} nodes</span>
      <span style={{ marginLeft: 'auto' }}>{Math.round(z * 100)}%</span>
    </div>
  );
}
