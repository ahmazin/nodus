/**
 * `UndoRedo` — on-canvas history buttons. Enabled state tracks `editor.history` reactively: reading
 * `history.version` inside `useValue` re-renders the pair whenever the undo stack changes, so the
 * buttons disable exactly when there is nothing to undo/redo.
 */

import type { CSSProperties, ReactElement } from 'react';
import type { Editor } from '@nodus/core';
import { IconButton } from '../primitives.js';
import { useUiTokens, type UiTokens } from '../tokens.js';
import { useValue } from '../../use-value.js';
import { RedoIcon, UndoIcon } from './icons.js';

export interface UndoRedoProps {
  editor: Editor;
  tokens?: UiTokens;
  size?: 'sm' | 'md';
  style?: CSSProperties;
}

export function UndoRedo({ editor, tokens, size = 'md', style }: UndoRedoProps): ReactElement {
  const themed = useUiTokens(editor);
  const t = tokens ?? themed;
  // Touch history.version so this re-evaluates on every history mutation, not just count changes.
  const canUndo = useValue(() => (editor.history.version.get(), editor.history.canUndo()));
  const canRedo = useValue(() => (editor.history.version.get(), editor.history.canRedo()));

  const groupStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: t.space(0.5),
    ['--nodus-focus-ring' as string]: t.focusRing,
    ['--nodus-font' as string]: t.font.family,
    ...style,
  };

  return (
    <div data-nodus-ui="" role="group" aria-label="History" style={groupStyle}>
      <IconButton
        tokens={t}
        size={size}
        icon={<UndoIcon />}
        aria-label="Undo"
        title="Undo (⌘Z)"
        disabled={!canUndo}
        onClick={() => editor.undo()}
      />
      <IconButton
        tokens={t}
        size={size}
        icon={<RedoIcon />}
        aria-label="Redo"
        title="Redo (⇧⌘Z)"
        disabled={!canRedo}
        onClick={() => editor.redo()}
      />
    </div>
  );
}
