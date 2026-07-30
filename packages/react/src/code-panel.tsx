/**
 * CodePanel — the lossless text <-> canvas Source editor.
 *
 * An editable, canonical `.nodus.json` view of the live document that stays in two-way sync:
 *   - Canvas -> text: any external document mutation (a create/move/style change on the canvas)
 *     re-serializes the editor into the textarea, so the JSON always mirrors what you see.
 *   - Text -> canvas: editing the JSON, once it parses, rebuilds the canvas from it (camera kept).
 *
 * The subtle part is not fighting itself: our own `applySource` bumps the same document-mutation
 * signal we listen to, so we tag self-applies (`selfApplyRef`) and ignore that echo, and we never
 * clobber the textarea while the user is actively typing (`typingRef`). A parse error surfaces as a
 * red status pill + a highlighted gutter line rather than touching the canvas.
 *
 * Pure logic lives in `round-trip.ts` (unit-tested); this file is the React shell + sync machine,
 * verified by driving the live app.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type UIEvent,
} from 'react';
import type { Editor } from '@ahmazin/core';
import { useValue } from './use-value.js';
import { useUiTokens } from './ui/tokens.js';
import {
  applySource,
  editorToSource,
  parseSource,
  sourceMatchesEditor,
} from './round-trip.js';

/** Idle window after the last keystroke before we attempt a parse + canvas rebuild. */
const PARSE_DEBOUNCE_MS = 300;

type SyncStatus = 'synced' | 'editing' | 'error';

export interface CodePanelProps {
  editor: Editor;
  style?: CSSProperties;
}

export function CodePanel({ editor, style }: CodePanelProps): JSX.Element {
  const t = useUiTokens(editor);

  const [draft, setDraft] = useState<string>(() => editorToSource(editor));
  const [status, setStatus] = useState<SyncStatus>('synced');
  const [errorLine, setErrorLine] = useState<number | null>(null);

  // `typingRef` guards the canvas->text sync from clobbering the textarea mid-edit; `selfApplyRef`
  // marks the document-mutation echo produced by our OWN applySource so we don't re-format on it.
  const typingRef = useRef(false);
  const selfApplyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  // Latest `status` for handlers that must read it without being re-created every render.
  const statusRef = useRef<SyncStatus>(status);
  statusRef.current = status;

  // Subscribe to the engine's "document changed" counter — every applied mutation bumps it.
  const nonce = useValue(() => editor.store.sceneNonce.get());

  // Canvas -> text. Runs whenever the document mutates (and once on mount).
  useEffect(() => {
    if (selfApplyRef.current) {
      // Our own applySource echo — swallow it, the textarea already holds the normalized form.
      selfApplyRef.current = false;
      return;
    }
    if (typingRef.current) return; // don't yank text out from under the user's cursor
    setDraft(editorToSource(editor));
    setStatus('synced');
    setErrorLine(null);
  }, [nonce, editor]);

  // Re-seed the textarea if the editor instance itself changes (e.g. a fresh document is mounted).
  useEffect(() => {
    setDraft(editorToSource(editor));
    setStatus('synced');
    setErrorLine(null);
    typingRef.current = false;
  }, [editor]);

  // Clear any pending debounce on unmount.
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // Debounced text -> canvas reconciliation.
  const runParse = (text: string): void => {
    const r = parseSource(text);
    if (!r.ok) {
      setStatus('error');
      setErrorLine(r.line);
      return;
    }
    if (!sourceMatchesEditor(text, editor)) {
      // Real change in the JSON — push it onto the canvas. Tag the echo so canvas->text ignores it.
      selfApplyRef.current = true;
      applySource(editor, r.snapshot);
    }
    // Normalize the textarea to the canvas's actual serialized form. This is the loop-breaker:
    // after this the draft equals `editorToSource(editor)`, so re-parsing is a fixed point.
    setDraft(editorToSource(editor));
    setStatus('synced');
    setErrorLine(null);
    typingRef.current = false;
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    const next = e.target.value;
    setDraft(next);
    typingRef.current = true;
    setStatus('editing');
    setErrorLine(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => runParse(next), PARSE_DEBOUNCE_MS);
  };

  const handleBlur = (): void => {
    typingRef.current = false;
    // If we're already in sync, snap the text to the clean canonical view on blur.
    if (statusRef.current === 'synced') setDraft(editorToSource(editor));
  };

  // Keep the gutter scrolled in lockstep with the textarea.
  const handleScroll = (e: UIEvent<HTMLTextAreaElement>): void => {
    if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
  };

  const lineCount = useMemo(() => Math.max(1, draft.split('\n').length), [draft]);
  const mono = t.font.mono;

  // ---- styling (rebuilt per render so the panel re-skins with the theme) ----
  const pill = statusPill(status, errorLine, t);

  const root: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    minWidth: 0,
    background: t.color.panel,
    color: t.color.text,
    border: `1px solid ${t.color.border}`,
    borderRadius: t.radius.lg,
    overflow: 'hidden',
    fontSize: t.font.size.sm,
    ...style,
  };

  const header: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '9px 12px',
    borderBottom: `1px solid ${t.color.border}`,
    flex: '0 0 auto',
  };

  const codeArea: CSSProperties = {
    position: 'relative',
    display: 'flex',
    flex: '1 1 auto',
    minHeight: 0,
    overflow: 'hidden',
  };

  const gutter: CSSProperties = {
    flex: '0 0 auto',
    boxSizing: 'border-box',
    padding: '12px 8px 12px 0',
    textAlign: 'right',
    background: t.color.canvas,
    borderRight: `1px solid ${t.color.border}`,
    color: t.color.textFaint,
    fontFamily: mono,
    fontSize: '12px',
    lineHeight: '18px',
    userSelect: 'none',
    overflow: 'hidden',
    minWidth: 44,
  };

  const gutterNum = (n: number): CSSProperties => ({
    padding: '0 8px 0 12px',
    color: errorLine === n ? t.color.accentText : t.color.textFaint,
    background: errorLine === n ? t.color.danger : 'transparent',
  });

  const textarea: CSSProperties = {
    flex: '1 1 auto',
    minWidth: 0,
    boxSizing: 'border-box',
    padding: '12px 14px',
    margin: 0,
    border: 0,
    outline: 'none',
    resize: 'none',
    background: 'transparent',
    color: t.color.text,
    fontFamily: mono,
    fontSize: '12px',
    lineHeight: '18px',
    tabSize: 2,
    whiteSpace: 'pre',
    overflow: 'auto',
    // Red glow when the current draft doesn't parse.
    boxShadow: status === 'error' ? `inset 3px 0 0 ${t.color.danger}` : 'none',
  };

  return (
    <div data-testid="code-panel" role="region" aria-label="Document source (JSON)" style={root}>
      <div style={header}>
        <span style={{ fontFamily: mono, fontSize: '11px', letterSpacing: '.06em', textTransform: 'uppercase', color: t.color.textFaint }}>
          Source
        </span>
        <span style={{ marginLeft: 'auto' }} />
        <span
          data-testid="code-status"
          role="status"
          aria-live="polite"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: mono,
            fontSize: '11px',
            padding: '3px 9px',
            borderRadius: 999,
            color: pill.fg,
            background: pill.bg,
            border: `1px solid ${pill.border}`,
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: 999, background: pill.dot }} aria-hidden />
          {pill.label}
        </span>
      </div>

      <div style={codeArea}>
        <div ref={gutterRef} aria-hidden style={gutter}>
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} style={gutterNum(i + 1)}>{i + 1}</div>
          ))}
        </div>
        <textarea
          data-testid="code-textarea"
          data-nodus-ui=""
          value={draft}
          onChange={handleChange}
          onBlur={handleBlur}
          onScroll={handleScroll}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="Editable document JSON"
          aria-invalid={status === 'error'}
          style={textarea}
        />
      </div>
    </div>
  );
}

interface Pill {
  label: string;
  fg: string;
  bg: string;
  border: string;
  dot: string;
}

/** Map the sync status to the status-pill's label + colors (green / amber / red). */
function statusPill(status: SyncStatus, errorLine: number | null, t: ReturnType<typeof useUiTokens>): Pill {
  if (status === 'error') {
    return {
      label: errorLine != null ? `Parse error · line ${errorLine}` : 'Parse error',
      fg: t.color.danger,
      bg: 'transparent',
      border: t.color.danger,
      dot: t.color.danger,
    };
  }
  if (status === 'editing') {
    const amber = '#f0a53e';
    return { label: 'Editing…', fg: amber, bg: 'transparent', border: amber, dot: amber };
  }
  return {
    label: 'Synced',
    fg: t.color.accent,
    bg: t.color.selection,
    border: t.color.accent,
    dot: t.color.accent,
  };
}
