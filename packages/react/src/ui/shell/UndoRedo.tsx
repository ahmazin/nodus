/**
 * `UndoRedo` — on-canvas history buttons. Enabled state tracks `editor.history` reactively: reading
 * `history.version` inside `useValue` re-renders the pair whenever the undo stack changes, so the
 * buttons disable exactly when there is nothing to undo/redo.
 */

import type { CSSProperties, ReactElement } from 'react';
import type { DeepPartial, Editor } from '@nodus-dev/core';
import { IconButton } from '../primitives.js';
import { useUiTokens, type UiTokens } from '../tokens.js';
import { useValue } from '../../use-value.js';
import { useMessages, type ReactMessages } from '../../messages.js';
import { RedoIcon, UndoIcon } from './icons.js';

export interface UndoRedoProps {
  editor: Editor;
  tokens?: UiTokens;
  size?: 'sm' | 'md';
  /** Localized string overrides for these controls (deep-merged over the English defaults). */
  messages?: DeepPartial<ReactMessages>;
  style?: CSSProperties;
}

export function UndoRedo({ editor, tokens, size = 'md', messages, style }: UndoRedoProps): ReactElement {
  const themed = useUiTokens(editor);
  const t = tokens ?? themed;
  const m = useMessages(editor, messages).history;
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
    <div data-nodus-ui="" role="group" aria-label={m.groupLabel} style={groupStyle}>
      <IconButton
        tokens={t}
        size={size}
        icon={<UndoIcon />}
        aria-label={m.undo}
        title={m.undoTitle}
        disabled={!canUndo}
        onClick={() => editor.undo()}
      />
      <IconButton
        tokens={t}
        size={size}
        icon={<RedoIcon />}
        aria-label={m.redo}
        title={m.redoTitle}
        disabled={!canRedo}
        onClick={() => editor.redo()}
      />
    </div>
  );
}
