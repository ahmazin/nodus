/**
 * `ZoomControls` — a compact −/percent/＋ cluster plus a fit-to-content button. The percent read-out
 * doubles as a "reset to 100%" button. Reads the live zoom from `editor.cameraAtom` (via `useValue`,
 * so it re-renders on every camera change) and drives `zoomBy` / `zoomToFit`.
 */

import type { CSSProperties, ReactElement } from 'react';
import type { Editor } from '@nodus/core';
import { Button, Divider, IconButton } from '../primitives.js';
import { useUiTokens, type UiTokens } from '../tokens.js';
import { useValue } from '../../use-value.js';
import { FitIcon, MinusIcon, PlusIcon } from './icons.js';

/** Multiplicative step per −/＋ press. */
const STEP = 1.2;

export interface ZoomControlsProps {
  editor: Editor;
  tokens?: UiTokens;
  /** Padding passed to `zoomToFit` (default 64). */
  fitPadding?: number;
  style?: CSSProperties;
}

export function ZoomControls({ editor, tokens, fitPadding = 64, style }: ZoomControlsProps): ReactElement {
  const themed = useUiTokens(editor);
  const t = tokens ?? themed;
  const zoom = useValue(() => editor.cameraAtom.get().z);
  const pct = Math.round(zoom * 100);

  const resetTo100 = (): void => {
    if (zoom !== 1) editor.zoomBy(1 / zoom); // multiply current z back to exactly 1, about the viewport center
  };

  const containerStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: t.space(0.5),
    padding: t.space(0.5),
    background: t.color.panel,
    border: `1px solid ${t.color.border}`,
    borderRadius: t.radius.lg,
    boxShadow: t.shadow.panel,
    ['--nodus-focus-ring' as string]: t.focusRing,
    ['--nodus-font' as string]: t.font.family,
    ...style,
  };

  return (
    <div data-nodus-ui="" role="group" aria-label="Zoom" style={containerStyle}>
      <IconButton
        tokens={t}
        size="sm"
        icon={<MinusIcon />}
        aria-label="Zoom out"
        title="Zoom out"
        onClick={() => editor.zoomBy(1 / STEP)}
      />
      <Button
        tokens={t}
        variant="ghost"
        size="sm"
        aria-label={`Zoom ${pct}% — reset to 100%`}
        title="Reset zoom to 100%"
        onClick={resetTo100}
        style={{ minWidth: 52, justifyContent: 'center', fontVariantNumeric: 'tabular-nums' }}
      >
        {pct}%
      </Button>
      <IconButton
        tokens={t}
        size="sm"
        icon={<PlusIcon />}
        aria-label="Zoom in"
        title="Zoom in"
        onClick={() => editor.zoomBy(STEP)}
      />
      <Divider tokens={t} vertical style={{ height: 18, margin: `0 ${t.space(0.5)}px` }} />
      <IconButton
        tokens={t}
        size="sm"
        icon={<FitIcon />}
        aria-label="Fit to content"
        title="Fit to content"
        onClick={() => editor.zoomToFit(fitPadding)}
      />
    </div>
  );
}
