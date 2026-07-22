/**
 * Import editor — an analysis-driven code editor for pasting Mermaid / Terraform / Kubernetes sources.
 * Detects the format from the pasted content (overridable), previews "N nodes · M edges · K skipped"
 * plus the real parser error BEFORE anything is committed, and hands the parsed ImportAnalysis to the
 * host via onImport. Monospace, line-numbered, with a Format/Tidy button.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@nodus/core';
import { useUiTokens } from '@nodus/react';
import type { ImportAnalysis, ImportFormat } from './import-analyze';

const META: Record<ImportFormat, { title: string; hint: string; placeholder: string; json: boolean }> = {
  mermaid: { title: 'Mermaid', hint: 'flowchart · stateDiagram · erDiagram', placeholder: 'flowchart LR\n  A[Web] --> B[(Postgres)]\n  A --> C{Redis}', json: false },
  terraform: { title: 'Terraform', hint: 'terraform show -json (state or plan)', placeholder: '{\n  "values": { "root_module": { "resources": [ … ] } }\n}', json: true },
  kubernetes: { title: 'Kubernetes', hint: 'YAML or JSON — manifests, a List, or one object', placeholder: 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web', json: false },
};
const FORMATS: ImportFormat[] = ['mermaid', 'terraform', 'kubernetes'];

export interface ImportEditorProps {
  editor: Editor;
  open: boolean;
  /** When opened from a format-locked command; omit for auto-detect. */
  initialFormat?: ImportFormat;
  detect: (text: string) => ImportFormat | null;
  analyze: (text: string, format: ImportFormat) => ImportAnalysis;
  onClose: () => void;
  onImport: (analysis: ImportAnalysis) => void;
}

export function ImportEditor({ editor, open, initialFormat, detect, analyze, onClose, onImport }: ImportEditorProps): JSX.Element | null {
  const t = useUiTokens(editor);
  const [text, setText] = useState('');
  const [override, setOverride] = useState<ImportFormat | 'auto'>('auto');
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setText('');
      setAnalysis(null);
      setBusy(false);
      setOverride(initialFormat ?? 'auto');
      const id = setTimeout(() => taRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [open, initialFormat]);

  const resolved: ImportFormat | null = override === 'auto' ? detect(text) : override;

  // Parse-on-type (debounced): analyze when we have text and a resolved format.
  useEffect(() => {
    if (!open) return undefined;
    const id = setTimeout(() => {
      if (text.trim() && resolved) setAnalysis(analyze(text, resolved));
      else setAnalysis(null);
    }, 200);
    return () => clearTimeout(id);
  }, [open, text, resolved, analyze]);

  const meta = resolved ? META[resolved] : null;
  const lineCount = text.length ? text.split('\n').length : 1;
  const canImport = !!analysis && !analysis.error && analysis.nodeCount > 0 && !busy;

  const doFormat = (): void => {
    if (meta?.json) {
      try {
        setText(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        /* leave as-is; the summary already shows the parse error */
      }
    } else {
      setText(text.split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, ''));
    }
  };

  const submit = (): void => {
    if (!canImport || !analysis) return;
    setBusy(true);
    try {
      onImport(analysis);
    } finally {
      setBusy(false);
      onClose();
    }
  };

  if (!open) return null;

  const barBtn: CSSProperties = { height: 28, padding: '0 11px', borderRadius: t.radius.sm, border: `1px solid ${t.color.borderStrong}`, background: 'transparent', color: t.color.textMuted, fontFamily: t.font.family, fontSize: '12px', cursor: 'pointer' };
  const chip: CSSProperties = { fontFamily: t.font.mono, fontSize: '11px', padding: '2px 7px', borderRadius: t.radius.sm, border: `1px solid ${t.color.border}`, color: t.color.textMuted };

  return createPortal(
    <div
      onPointerDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,9,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
    >
      <div
        data-testid="import-modal"
        data-format={resolved ?? 'unknown'}
        role="dialog"
        aria-label="Import diagram"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) onClose();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
        }}
        style={{ width: 'min(680px, 94vw)', maxHeight: '88vh', background: t.color.panel, border: `1px solid ${t.color.borderStrong}`, borderRadius: t.radius.lg, boxShadow: t.shadow.popover, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        {/* header: title + format segmented control (auto badge) + Format button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: t.font.size.lg, fontWeight: 600, color: t.color.text }}>Import</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              data-testid="import-format-auto"
              onClick={() => setOverride('auto')}
              style={{ ...chip, cursor: 'pointer', ...(override === 'auto' ? { border: `1px solid ${t.color.accent}`, color: t.color.text } : {}) }}
            >
              {override === 'auto' && resolved ? `auto · ${META[resolved].title}` : 'auto'}
            </button>
            {FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                data-testid={`import-format-${f}`}
                onClick={() => setOverride(f)}
                style={{ ...chip, cursor: 'pointer', ...(override === f ? { border: `1px solid ${t.color.accent}`, color: t.color.text } : {}) }}
              >
                {META[f].title}
              </button>
            ))}
          </div>
          <span data-testid="import-detected" style={{ fontFamily: t.font.mono, fontSize: '11px', color: t.color.textFaint }}>{meta?.hint ?? 'paste to detect…'}</span>
          <button type="button" data-testid="import-format" onClick={doFormat} disabled={!meta} style={{ ...barBtn, marginLeft: 'auto' }}>
            {meta?.json ? 'Format JSON' : 'Tidy'}
          </button>
        </div>

        {/* line-numbered editor (unchanged structure) */}
        <div style={{ display: 'flex', border: `1px solid ${t.color.borderStrong}`, borderRadius: t.radius.md, overflow: 'hidden', background: t.color.canvas, height: '46vh' }}>
          <div ref={gutterRef} aria-hidden style={{ flex: '0 0 auto', width: 44, padding: '10px 8px 10px 0', textAlign: 'right', fontFamily: t.font.mono, fontSize: '12px', lineHeight: '18px', color: t.color.textFaint, background: t.color.surface, borderRight: `1px solid ${t.color.border}`, overflow: 'hidden', userSelect: 'none', whiteSpace: 'pre' }}>
            {Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}
          </div>
          <textarea
            ref={taRef}
            data-testid="import-input"
            value={text}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            onScroll={(e) => { if (gutterRef.current) gutterRef.current.scrollTop = (e.target as HTMLTextAreaElement).scrollTop; }}
            placeholder={meta?.placeholder ?? 'Paste Mermaid, Terraform (show -json), or Kubernetes manifests…'}
            style={{ flex: 1, minWidth: 0, padding: '10px 12px', border: 'none', background: 'transparent', color: t.color.text, fontFamily: t.font.mono, fontSize: '12px', lineHeight: '18px', whiteSpace: 'pre', overflow: 'auto', outline: 'none', resize: 'none' }}
          />
        </div>

        {/* preview summary / error */}
        {analysis?.error ? (
          <div data-testid="import-error" style={{ fontSize: '12px', color: t.color.danger, background: `${t.color.danger}1a`, border: `1px solid ${t.color.danger}55`, borderRadius: t.radius.md, padding: '8px 10px' }}>
            {analysis.error}
          </div>
        ) : analysis ? (
          <div data-testid="import-summary" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: '12px', color: t.color.textMuted }}>
            <span><b style={{ color: t.color.text }}>{analysis.nodeCount}</b> nodes · <b style={{ color: t.color.text }}>{analysis.edgeCount}</b> edges</span>
            {analysis.skipped.map((s) => (
              <span key={s.label} style={chip}>{s.count} {s.label}{s.count === 1 ? '' : 's'} skipped</span>
            ))}
            {analysis.notes.map((n, i) => (
              <span key={i} style={{ color: t.color.textFaint }}>{n}</span>
            ))}
          </div>
        ) : (
          <div data-testid="import-summary" style={{ fontSize: '12px', color: t.color.textFaint }}>
            {text.trim() && !resolved ? "Couldn't detect a format — pick one above." : 'Paste a diagram source to preview.'}
          </div>
        )}

        {/* Privacy: importers run entirely in-browser (verified zero network egress) — say so, and warn
            against pasting live secrets/state, since Terraform state & K8s manifests routinely carry them. */}
        <div data-testid="import-privacy" style={{ fontSize: '11px', color: t.color.textFaint, lineHeight: 1.4 }}>
          Parsed locally in your browser — nothing is uploaded. Avoid pasting secrets or live state you don't want on screen.
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '11.5px', color: t.color.textFaint }}>{busy ? 'Importing…' : `${lineCount} line${lineCount === 1 ? '' : 's'}`}</span>
          <button type="button" onClick={onClose} disabled={busy} style={{ ...barBtn, marginLeft: 'auto', height: 34, padding: '0 15px', fontSize: '13px' }}>Cancel</button>
          <button
            type="button"
            data-testid="import-run"
            onClick={submit}
            disabled={!canImport}
            style={{ height: 34, padding: '0 16px', borderRadius: t.radius.md, border: 'none', background: t.color.accent, color: '#0b110e', fontFamily: t.font.family, fontSize: '13px', fontWeight: 600, cursor: canImport ? 'pointer' : 'default', opacity: canImport ? 1 : 0.55 }}
          >
            Import
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
