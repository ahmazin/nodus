/**
 * Import editor — a real pop-up code editor for pasting Mermaid / Terraform / Kubernetes sources,
 * replacing the old window.prompt() one-liners. Monospace, line-numbered, with a Format button
 * (JSON prettify for Terraform/K8s, whitespace tidy for Mermaid) and inline parse errors. The actual
 * import (parse + build records + layout) is delegated to the host via `onImport`, which returns an
 * error message or null on success.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@nodus/core';
import { useUiTokens } from '@nodus/react';

export type ImportFormat = 'mermaid' | 'terraform' | 'kubernetes';

const META: Record<ImportFormat, { title: string; hint: string; placeholder: string; json: boolean }> = {
  mermaid: {
    title: 'Import Mermaid',
    hint: 'flowchart · stateDiagram · erDiagram',
    placeholder: 'flowchart LR\n  A[Web] --> B[(Postgres)]\n  A --> C{Redis}',
    json: false,
  },
  terraform: {
    title: 'Import Terraform',
    hint: 'terraform show -json',
    placeholder: '{\n  "values": { "root_module": { "resources": [ … ] } }\n}',
    json: true,
  },
  kubernetes: {
    title: 'Import Kubernetes',
    hint: 'kubectl get -o json — an array, a List, or one object',
    placeholder: '[\n  { "kind": "Deployment", "metadata": { "name": "web" } }\n]',
    json: true,
  },
};

export interface ImportEditorProps {
  editor: Editor;
  format: ImportFormat | null;
  onClose: () => void;
  /** Perform the import; return an error message to display, or null on success (modal then closes). */
  onImport: (text: string) => Promise<string | null>;
}

export function ImportEditor({ editor, format, onClose, onImport }: ImportEditorProps): JSX.Element | null {
  const t = useUiTokens(editor);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (format) {
      setText('');
      setError(null);
      setBusy(false);
      const id = setTimeout(() => taRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [format]);

  if (!format) return null;
  const meta = META[format];
  const lineCount = text.length ? text.split('\n').length : 1;

  const doFormat = (): void => {
    setError(null);
    if (meta.json) {
      try {
        setText(JSON.stringify(JSON.parse(text), null, 2));
      } catch (e) {
        setError(`Can't format — invalid JSON${e instanceof Error ? ` (${e.message})` : ''}`);
      }
    } else {
      // Mermaid: trim trailing whitespace per line, collapse blank runs.
      setText(text.split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, ''));
    }
  };

  const submit = async (): Promise<void> => {
    setError(null);
    if (!text.trim()) {
      setError('Paste a diagram source to import.');
      return;
    }
    setBusy(true);
    const err = await onImport(text);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };

  const barBtn: CSSProperties = {
    height: 28,
    padding: '0 11px',
    borderRadius: t.radius.sm,
    border: `1px solid ${t.color.borderStrong}`,
    background: 'transparent',
    color: t.color.textMuted,
    fontFamily: t.font.family,
    fontSize: '12px',
    cursor: 'pointer',
  };

  return createPortal(
    <div
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,9,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
    >
      <div
        data-testid="import-modal"
        data-format={format}
        role="dialog"
        aria-label={meta.title}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) onClose();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
        }}
        style={{
          width: 'min(680px, 94vw)',
          maxHeight: '88vh',
          background: t.color.panel,
          border: `1px solid ${t.color.borderStrong}`,
          borderRadius: t.radius.lg,
          boxShadow: t.shadow.popover,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: t.font.size.lg, fontWeight: 600, color: t.color.text }}>{meta.title}</span>
          <span style={{ fontFamily: t.font.mono, fontSize: '11px', color: t.color.textFaint }}>{meta.hint}</span>
          <button type="button" data-testid="import-format" onClick={doFormat} style={{ ...barBtn, marginLeft: 'auto' }}>
            {meta.json ? 'Format JSON' : 'Tidy'}
          </button>
        </div>

        {/* line-numbered code editor */}
        <div
          style={{
            display: 'flex',
            border: `1px solid ${t.color.borderStrong}`,
            borderRadius: t.radius.md,
            overflow: 'hidden',
            background: t.color.canvas,
            height: '48vh',
          }}
        >
          <div
            ref={gutterRef}
            aria-hidden
            style={{
              flex: '0 0 auto',
              width: 44,
              padding: '10px 8px 10px 0',
              textAlign: 'right',
              fontFamily: t.font.mono,
              fontSize: '12px',
              lineHeight: '18px',
              color: t.color.textFaint,
              background: t.color.surface,
              borderRight: `1px solid ${t.color.border}`,
              overflow: 'hidden',
              userSelect: 'none',
              whiteSpace: 'pre',
            }}
          >
            {Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}
          </div>
          <textarea
            ref={taRef}
            data-testid="import-input"
            value={text}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            onScroll={(e) => {
              if (gutterRef.current) gutterRef.current.scrollTop = (e.target as HTMLTextAreaElement).scrollTop;
            }}
            placeholder={meta.placeholder}
            style={{
              flex: 1,
              minWidth: 0,
              padding: '10px 12px',
              border: 'none',
              background: 'transparent',
              color: t.color.text,
              fontFamily: t.font.mono,
              fontSize: '12px',
              lineHeight: '18px',
              whiteSpace: 'pre',
              overflow: 'auto',
              outline: 'none',
              resize: 'none',
            }}
          />
        </div>

        {error && (
          <div data-testid="import-error" style={{ fontSize: '12px', color: t.color.danger, background: `${t.color.danger}1a`, border: `1px solid ${t.color.danger}55`, borderRadius: t.radius.md, padding: '8px 10px' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '11.5px', color: t.color.textFaint }}>{busy ? 'Importing…' : `${lineCount} line${lineCount === 1 ? '' : 's'}`}</span>
          <button type="button" onClick={onClose} disabled={busy} style={{ ...barBtn, marginLeft: 'auto', height: 34, padding: '0 15px', fontSize: '13px' }}>
            Cancel
          </button>
          <button
            type="button"
            data-testid="import-run"
            onClick={() => void submit()}
            disabled={busy}
            style={{
              height: 34,
              padding: '0 16px',
              borderRadius: t.radius.md,
              border: 'none',
              background: t.color.accent,
              color: '#0b110e',
              fontFamily: t.font.family,
              fontSize: '13px',
              fontWeight: 600,
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.7 : 1,
            }}
          >
            Import
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
