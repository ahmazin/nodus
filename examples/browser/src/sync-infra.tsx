/**
 * Sync from infra source (drift detection) — the "never drift from source of truth" moat. Paste an
 * updated Terraform (show -json) or Kubernetes source; it re-imports and diffs the result against the
 * current diagram (by source address, via @nodus-dev/import-infra's computeDrift), and surfaces
 * "N resources changed since last render". Removed resources are ghosted live on the canvas as a
 * preview; Apply reconciles the diagram in one undoable step, preserving your layout for unchanged
 * and changed nodes. Non-source (manually added) records are never touched.
 */
import { useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Editor, NodusRecord } from '@nodus-dev/core';
import { useUiTokens, showToast } from '@nodus-dev/react';
import { fromKubernetes, fromTerraform, computeDrift, driftChanges, type DriftResult } from '@nodus-dev/import-infra';

type Source = 'terraform' | 'kubernetes';

const labelOf = (r: NodusRecord): string => {
  const rec = r as { label?: string; props?: { key?: unknown } };
  return rec.label || (typeof rec.props?.key === 'string' ? rec.props.key : r.id);
};

export interface SyncInfraProps {
  editor: Editor;
  open: boolean;
  onClose: () => void;
}

export function SyncInfra({ editor, open, onClose }: SyncInfraProps): JSX.Element | null {
  const t = useUiTokens(editor);
  const [source, setSource] = useState<Source>('terraform');
  const [text, setText] = useState('');
  const [drift, setDrift] = useState<DriftResult | null>(null);
  const [incoming, setIncoming] = useState<NodusRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // id -> original `visual`, so the ghost preview is fully reversible (mutations use capture:'never').
  const preview = useRef<Map<string, unknown>>(new Map());

  const clearPreview = (): void => {
    for (const [id, visual] of preview.current) {
      try {
        editor.updateRecord(id, { visual }, { capture: 'never' });
      } catch {
        /* record may already be gone (applied) */
      }
    }
    preview.current.clear();
  };

  if (!open) return null;

  const reset = (): void => {
    clearPreview();
    setDrift(null);
    setIncoming(null);
    setError(null);
  };

  const check = (): void => {
    reset();
    let recs: NodusRecord[];
    try {
      const parsed: unknown = JSON.parse(text);
      if (source === 'terraform') {
        recs = fromTerraform(parsed);
      } else {
        const objs = Array.isArray(parsed)
          ? parsed
          : ((parsed as { items?: unknown[] }).items ?? [parsed]);
        recs = fromKubernetes(objs as never);
      }
    } catch (e) {
      setError(e instanceof Error ? `Could not read that ${source} source — ${e.message}` : String(e));
      return;
    }
    const d = computeDrift(editor.store.allRecords(), recs);
    setDrift(d);
    setIncoming(recs);
    // Ghost the removed resources on the canvas (state:'ghost' is theme-honored → renders faded).
    for (const r of d.removed) {
      const rec = editor.store.peek(r.id) as { visual?: unknown } | undefined;
      if (rec && 'visual' in rec) {
        preview.current.set(r.id, rec.visual);
        editor.updateRecord(r.id, { visual: { state: 'ghost' } }, { capture: 'never' });
      }
    }
  };

  const apply = (): void => {
    if (!incoming || !drift) return;
    clearPreview();
    const changes = driftChanges(editor.store.allRecords(), incoming);
    if (changes.length) {
      editor.store.apply(changes, { capture: 'immediately' }); // one undo entry for the whole re-sync
      editor.sceneIndex.rebuild(editor.store.allRecords());
      editor.zoomToFit(48); // no full re-layout — preserve the user's positions
    }
    showToast(
      `Synced ${drift.total} change${drift.total === 1 ? '' : 's'} from ${source}`,
      'ok',
      { mode: t.mode },
    );
    setText('');
    reset();
    onClose();
  };

  const close = (): void => {
    reset();
    onClose();
  };

  // ---- styles ----
  const chip = (active: boolean): CSSProperties => ({
    height: 30,
    padding: '0 12px',
    borderRadius: t.radius.md,
    border: `1px solid ${active ? t.color.accent : t.color.borderStrong}`,
    background: active ? `${t.color.accent}22` : 'transparent',
    color: active ? t.color.accent : t.color.textMuted,
    fontFamily: t.font.family,
    fontSize: '12.5px',
    cursor: 'pointer',
  });
  const btn = (primary?: boolean, disabled?: boolean): CSSProperties => ({
    height: 34,
    padding: '0 15px',
    borderRadius: t.radius.md,
    border: primary ? 'none' : `1px solid ${t.color.borderStrong}`,
    background: primary ? t.color.accent : 'transparent',
    color: primary ? '#0b110e' : t.color.textMuted,
    fontFamily: t.font.family,
    fontSize: '13px',
    fontWeight: primary ? 600 : 400,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  });
  const section = (title: string, color: string, items: string[]): JSX.Element | null =>
    items.length === 0 ? null : (
      <div>
        <div style={{ fontFamily: t.font.mono, fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.08em', color, marginBottom: 4 }}>
          {title} · {items.length}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {items.slice(0, 40).map((label, i) => (
            <span
              key={`${label}-${i}`}
              style={{ fontSize: '11.5px', fontFamily: t.font.mono, color: t.color.textMuted, background: t.color.canvas, border: `1px solid ${t.color.border}`, borderRadius: 5, padding: '2px 7px' }}
            >
              {label}
            </span>
          ))}
          {items.length > 40 && <span style={{ fontSize: '11px', color: t.color.textFaint }}>+{items.length - 40} more</span>}
        </div>
      </div>
    );

  return createPortal(
    <div
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,9,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
    >
      <div
        data-testid="sync-modal"
        role="dialog"
        aria-label="Sync from infra source"
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
        }}
        style={{
          width: 'min(620px, 94vw)',
          maxHeight: '86vh',
          overflowY: 'auto',
          background: t.color.panel,
          border: `1px solid ${t.color.borderStrong}`,
          borderRadius: t.radius.lg,
          boxShadow: t.shadow.popover,
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div>
          <div style={{ fontSize: t.font.size.lg, fontWeight: 600, color: t.color.text }}>Sync from infra source</div>
          <div style={{ fontSize: t.font.size.xs, color: t.color.textFaint, marginTop: 3 }}>
            Paste your current Terraform / Kubernetes source. Nodus re-reads it and shows what changed since this diagram was last rendered.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 7 }}>
          <button type="button" data-testid="sync-src-terraform" onClick={() => setSource('terraform')} style={chip(source === 'terraform')}>
            Terraform (show -json)
          </button>
          <button type="button" data-testid="sync-src-kubernetes" onClick={() => setSource('kubernetes')} style={chip(source === 'kubernetes')}>
            Kubernetes (JSON)
          </button>
        </div>

        <textarea
          data-testid="sync-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          placeholder={source === 'terraform' ? '{ "values": { "root_module": { "resources": [ … ] } } }' : '[ { "kind": "Deployment", "metadata": { "name": "web" }, … } ]'}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: t.color.canvas,
            color: t.color.text,
            border: `1px solid ${t.color.borderStrong}`,
            borderRadius: t.radius.md,
            fontFamily: t.font.mono,
            fontSize: '12px',
            lineHeight: 1.5,
            padding: '10px 11px',
            resize: 'vertical',
            outline: 'none',
          }}
        />

        {error && (
          <div data-testid="sync-error" style={{ fontSize: '12px', color: t.color.danger, background: `${t.color.danger}1a`, border: `1px solid ${t.color.danger}55`, borderRadius: t.radius.md, padding: '8px 10px' }}>
            {error}
          </div>
        )}

        {drift && (
          <div
            data-testid="sync-report"
            style={{ display: 'flex', flexDirection: 'column', gap: 12, border: `1px solid ${t.color.border}`, borderRadius: t.radius.md, padding: 12, background: t.color.canvas }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span data-testid="sync-headline" style={{ fontSize: '13px', fontWeight: 600, color: drift.total ? t.color.text : t.color.textMuted }}>
                {drift.total === 0 ? 'In sync — no changes since last render' : `${drift.total} resource${drift.total === 1 ? '' : 's'} changed since last render`}
              </span>
              {drift.total > 0 && (
                <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, fontFamily: t.font.mono, fontSize: '12px' }}>
                  <span style={{ color: '#4ac26b' }}>+{drift.added.length}</span>
                  <span style={{ color: t.color.danger }}>−{drift.removed.length}</span>
                  <span style={{ color: '#e0b341' }}>~{drift.changed.length}</span>
                </span>
              )}
            </div>
            {section('Added', '#4ac26b', drift.added.map(labelOf))}
            {section('Removed', t.color.danger, drift.removed.map(labelOf))}
            {section('Changed', '#e0b341', drift.changed.map((c) => `${labelOf(c.to)}${c.fields.length ? ` (${c.fields.join(', ')})` : ''}`))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" data-testid="sync-check" onClick={check} disabled={!text.trim()} style={btn(false, !text.trim())}>
            Check drift
          </button>
          <button type="button" onClick={close} style={{ ...btn(false), marginLeft: 'auto' }}>
            Cancel
          </button>
          <button type="button" data-testid="sync-apply" onClick={apply} disabled={!drift || drift.total === 0} style={btn(true, !drift || drift.total === 0)}>
            Apply changes
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
