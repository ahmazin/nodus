/**
 * The in-app "PR-review" surface over `.nodus.json`.
 *
 *   - `BranchBar` — a compact top-bar cluster: a `⎇ main` branch chip, a live `+adds −dels` pill that
 *     appears whenever the working document diverges from the in-memory "main" baseline, and a Review
 *     button that opens the modal.
 *   - `ReviewModal` — a GitHub-style unified-diff modal (old/new line-number gutters, red/green rows)
 *     with Discard (two-step confirm), Close, and Approve & merge.
 *
 * "main" is an in-memory `Snapshot` persisted to localStorage via `useBranch` — there is NO real git.
 * Merge adopts the working tree as the new main; Discard resets the working tree to main.
 */

import { useEffect, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@nodus/core';
import { useBranch, type BranchInfo } from './use-branch.js';
import { useUiTokens, type UiTokens } from './ui/tokens.js';
import { UiTokensProvider, Panel, Button, IconButton } from './ui/primitives.js';
import { injectGlobalStyles } from './ui/global-styles.js';

// ---------------------------------------------------------------------------
// Diff palette — green/red tones derived per mode (tokens carry no dedicated add-green)
// ---------------------------------------------------------------------------

interface DiffColors {
  addText: string;
  delText: string;
  addBg: string;
  delBg: string;
}

function diffColors(t: UiTokens): DiffColors {
  return t.mode === 'dark'
    ? {
        addText: '#57d364',
        delText: t.color.danger,
        addBg: 'rgba(87,211,100,0.14)',
        delBg: 'rgba(240,101,92,0.15)',
      }
    : {
        addText: '#1a7f37',
        delText: t.color.danger,
        addBg: 'rgba(26,127,55,0.12)',
        delBg: 'rgba(207,34,46,0.10)',
      };
}

// ---------------------------------------------------------------------------
// BranchBar
// ---------------------------------------------------------------------------

export interface BranchBarProps {
  editor: Editor;
  style?: CSSProperties;
}

/** A branch chip + live change pill + Review button, sized for the top bar (height ~32). */
export function BranchBar({ editor, style }: BranchBarProps): ReactElement {
  useEffect(() => {
    injectGlobalStyles();
  }, []);
  const t = useUiTokens(editor);
  const branch = useBranch(editor);
  const [open, setOpen] = useState(false);
  const dc = diffColors(t);

  const chipBase: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: t.space(1),
    height: 24,
    padding: `0 ${t.space(2)}px`,
    borderRadius: t.radius.md,
    border: `1px solid ${t.color.border}`,
    background: t.color.surface,
    color: t.color.textMuted,
    fontFamily: t.font.family,
    fontSize: t.font.size.xs,
    userSelect: 'none',
    whiteSpace: 'nowrap',
  };

  return (
    <div
      data-nodus-ui=""
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: t.space(1.5),
        height: 32,
        fontFamily: t.font.family,
        ...style,
      }}
    >
      <span data-testid="branch-chip" style={chipBase} title="In-memory main branch">
        <span aria-hidden style={{ color: t.color.textFaint }}>⎇</span>
        <span style={{ color: t.color.text, fontWeight: 600 }}>{branch.branchName}</span>
      </span>

      {branch.dirty && (
        <button
          data-nodus-ui=""
          type="button"
          data-testid="review-pill"
          onClick={() => setOpen(true)}
          title={`${branch.adds} added, ${branch.dels} removed line(s) — open review`}
          style={{
            ...chipBase,
            cursor: 'pointer',
            gap: t.space(1.5),
            fontFamily: t.font.mono,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <span style={{ color: dc.addText, fontWeight: 600 }}>+{branch.adds}</span>
          <span style={{ color: dc.delText, fontWeight: 600 }}>−{branch.dels}</span>
        </button>
      )}

      <Button
        tokens={t}
        size="sm"
        variant={branch.dirty ? 'primary' : 'default'}
        data-testid="review-open"
        onClick={() => setOpen(true)}
        style={branch.dirty ? undefined : { color: t.color.textMuted }}
      >
        Review
      </Button>

      <ReviewModal editor={editor} branch={branch} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReviewModal
// ---------------------------------------------------------------------------

export interface ReviewModalProps {
  editor: Editor;
  branch: BranchInfo;
  open: boolean;
  onClose: () => void;
}

/** A centered, portalled unified-diff review modal. Returns `null` when closed. */
export function ReviewModal({ editor, branch, open, onClose }: ReviewModalProps): ReactElement | null {
  const t = useUiTokens(editor);
  const dc = diffColors(t);
  // Two-step confirm for the destructive Discard — `loadSnapshot` is not undoable.
  const [armed, setArmed] = useState(false);

  // Escape-to-close while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Reset the armed-discard state whenever the modal closes.
  useEffect(() => {
    if (!open) setArmed(false);
  }, [open]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const { semantic, unified, dirty, branchName } = branch;

  const gutterStyle: CSSProperties = {
    flex: '0 0 auto',
    width: 44,
    paddingRight: t.space(2),
    textAlign: 'right',
    color: t.color.textFaint,
    userSelect: 'none',
    fontVariantNumeric: 'tabular-nums',
  };

  const overlay = (
    <UiTokensProvider tokens={t}>
      <div
        data-nodus-ui=""
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: t.space(4),
          background: 'rgba(0,0,0,0.55)',
          fontFamily: t.font.family,
        }}
      >
        <Panel
          elevated
          tokens={t}
          data-testid="review-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`Review changes against ${branchName}`}
          onClick={(e) => e.stopPropagation()}
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: 'min(820px, 100%)',
            maxHeight: '80vh',
            padding: 0,
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: t.space(3),
              padding: `${t.space(3)}px ${t.space(4)}px`,
              borderBottom: `1px solid ${t.color.border}`,
            }}
          >
            <div style={{ flex: '1 1 auto', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: t.space(2) }}>
                <span style={{ fontSize: t.font.size.lg, fontWeight: 600, color: t.color.text }}>
                  Review changes
                </span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: t.space(1),
                    fontSize: t.font.size.xs,
                    color: t.color.textMuted,
                  }}
                >
                  <span aria-hidden style={{ color: t.color.textFaint }}>⎇</span>
                  {branchName}
                </span>
              </div>
              <div
                style={{
                  marginTop: t.space(1),
                  fontSize: t.font.size.sm,
                  color: t.color.textMuted,
                }}
              >
                {semantic.added.length} added · {semantic.removed.length} removed ·{' '}
                {semantic.changed.length} changed
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: t.space(2) }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: t.space(1.5),
                  fontFamily: t.font.mono,
                  fontSize: t.font.size.sm,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                <span style={{ color: dc.addText, fontWeight: 600 }}>+{branch.adds}</span>
                <span style={{ color: dc.delText, fontWeight: 600 }}>−{branch.dels}</span>
              </span>
              <IconButton
                tokens={t}
                size="sm"
                aria-label="Close review"
                onClick={onClose}
                icon={<span aria-hidden>✕</span>}
              />
            </div>
          </div>

          {/* Body */}
          <div
            style={{
              flex: '1 1 auto',
              overflow: 'auto',
              background: t.color.canvas,
              fontFamily: t.font.mono,
              fontSize: t.font.size.sm,
              lineHeight: 1.6,
            }}
          >
            {!dirty ? (
              <div
                style={{
                  padding: `${t.space(8)}px ${t.space(4)}px`,
                  textAlign: 'center',
                  color: t.color.textMuted,
                  fontFamily: t.font.family,
                }}
              >
                No changes — working tree matches {branchName}.
              </div>
            ) : (
              unified.lines.map((line, i) => {
                const bg =
                  line.kind === 'add' ? dc.addBg : line.kind === 'del' ? dc.delBg : 'transparent';
                const sign = line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' ';
                const signColor =
                  line.kind === 'add'
                    ? dc.addText
                    : line.kind === 'del'
                      ? dc.delText
                      : t.color.textFaint;
                return (
                  <div
                    key={i}
                    data-testid="diff-row"
                    data-kind={line.kind}
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      width: 'max-content',
                      minWidth: '100%',
                      padding: `0 ${t.space(3)}px`,
                      background: bg,
                    }}
                  >
                    <span style={gutterStyle}>{line.oldLineNo ?? ''}</span>
                    <span style={gutterStyle}>{line.newLineNo ?? ''}</span>
                    <span
                      aria-hidden
                      style={{
                        flex: '0 0 auto',
                        width: 16,
                        textAlign: 'center',
                        color: signColor,
                        userSelect: 'none',
                      }}
                    >
                      {sign}
                    </span>
                    <span style={{ flex: '1 1 auto', whiteSpace: 'pre', color: t.color.text }}>
                      {line.text}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: t.space(2),
              padding: `${t.space(3)}px ${t.space(4)}px`,
              borderTop: `1px solid ${t.color.border}`,
            }}
          >
            <Button
              tokens={t}
              size="sm"
              data-testid="review-discard"
              disabled={!dirty}
              onClick={() => {
                if (!armed) {
                  setArmed(true);
                  return;
                }
                branch.discard();
                onClose();
              }}
              style={{
                marginRight: 'auto',
                color: t.color.danger,
                borderColor: armed ? t.color.danger : t.color.border,
                background: armed ? t.color.selection : t.color.surface,
              }}
            >
              {armed ? 'Confirm discard' : 'Discard'}
            </Button>
            <Button tokens={t} size="sm" variant="default" data-testid="review-close" onClick={onClose}>
              Close
            </Button>
            <Button
              tokens={t}
              size="sm"
              variant="primary"
              data-testid="review-merge"
              disabled={!dirty}
              onClick={() => {
                branch.merge();
                onClose();
              }}
            >
              Approve &amp; merge
            </Button>
          </div>
        </Panel>
      </div>
    </UiTokensProvider>
  );

  return createPortal(overlay as ReactNode, document.body);
}
