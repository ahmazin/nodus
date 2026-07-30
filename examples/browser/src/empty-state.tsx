/**
 * Empty-state onboarding card — a dismissible, frosted overlay shown centered over the canvas when
 * the document has zero nodes. Gives a brand-new visitor an immediate "what do I do here" without
 * blocking the canvas: the wrapper is `pointer-events: none` and only the card itself is interactive,
 * so clicks/drags elsewhere on the canvas pass straight through.
 *
 * Dismissal (and re-appearance) is entirely the caller's concern (`main.tsx` gates on
 * `nodeCount === 0 && !onboardDismissed` and persists the dismissal to `localStorage`); this
 * component only renders the card and reports the two actions a user can take.
 */
import type { Editor } from '@ahmazin/core';
import { CloseIcon, useUiTokens } from '@ahmazin/react';
import type { ReactElement } from 'react';

export interface EmptyStateProps {
  editor: Editor;
  onDismiss: () => void;
  onCommandPalette?: () => void;
}

/** Drop a single default rectangle node centered in the current viewport (undoable, one entry). */
function addSampleShape(editor: Editor): void {
  const vp = editor.worldViewport();
  const w = 120;
  const h = 56;
  editor.createNode({
    type: 'rect',
    x: vp.x + vp.w / 2 - w / 2,
    y: vp.y + vp.h / 2 - h / 2,
    w,
    h,
    label: 'Node',
  });
}

export function EmptyState({ editor, onDismiss, onCommandPalette }: EmptyStateProps): ReactElement {
  const t = useUiTokens(editor);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 15,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        data-testid="empty-state"
        data-nodus-ui=""
        className="nd-pop"
        role="region"
        aria-label="Get started"
        style={{
          pointerEvents: 'auto',
          position: 'relative',
          maxWidth: 340,
          padding: '20px 24px',
          textAlign: 'center',
          background: t.color.glass,
          backdropFilter: `blur(${t.blur}) saturate(1.4)`,
          WebkitBackdropFilter: `blur(${t.blur}) saturate(1.4)`,
          border: `1px solid ${t.color.border}`,
          borderRadius: t.radius.lg,
          boxShadow: t.shadow.popover,
          fontFamily: t.font.family,
          color: t.color.text,
        }}
      >
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            width: 26,
            height: 26,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            background: 'transparent',
            color: t.color.textFaint,
            borderRadius: t.radius.md,
            cursor: 'pointer',
          }}
        >
          <CloseIcon size={14} />
        </button>

        <div style={{ fontSize: t.font.size.lg, fontWeight: 600, marginTop: 2 }}>Start your diagram</div>
        <p style={{ fontSize: t.font.size.sm, color: t.color.textMuted, lineHeight: 1.5, margin: '8px 0 16px' }}>
          Pick a shape tool and click the canvas, drop in a template, or search for anything with the
          command palette.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            type="button"
            onClick={() => addSampleShape(editor)}
            style={{
              height: 34,
              borderRadius: t.radius.md,
              border: `1px solid ${t.color.accent}`,
              background: 'transparent',
              color: t.color.accent,
              fontFamily: t.font.family,
              fontSize: t.font.size.sm,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Add a shape
          </button>
          {onCommandPalette && (
            <button
              type="button"
              onClick={onCommandPalette}
              style={{
                height: 34,
                borderRadius: t.radius.md,
                border: `1px solid ${t.color.borderStrong}`,
                background: 'transparent',
                color: t.color.textMuted,
                fontFamily: t.font.family,
                fontSize: t.font.size.sm,
                cursor: 'pointer',
              }}
            >
              ⌘K Commands
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
