/**
 * Describe-a-diagram (AI) — a ⌘K / Insert-tab prompt that turns a natural-language description into a
 * Nodus diagram using @nodus-dev/text-to-diagram's `diagramTool` + `recordsFromToolUse`. The model call is
 * a plain browser fetch to the Anthropic Messages API with a BRING-YOUR-OWN key stored only in
 * localStorage and sent only to Anthropic (never to a server of ours) — preserving the local-first /
 * no-login-wall posture. No SDK dependency; forces the render_diagram tool for a single structured call.
 *
 * Testable without a live model: set `window.__nodusDescribeModel = async (prompt) => ({name, input})`
 * to inject a canned tool_use; the real fetch is bypassed. This is how scripts/verify-describe.mjs
 * exercises the full generate → records → add flow with no network or key.
 */
import { useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Editor, NodusRecord } from '@nodus-dev/core';
import { useUiTokens } from '@nodus-dev/react';
import { diagramTool, diagramSystemPrompt, recordsFromToolUse } from '@nodus-dev/text-to-diagram';

const KEY_STORAGE = 'nodus.anthropic.key';
const MODEL = 'claude-opus-4-8';

type ToolUse = { name: string; input: unknown };
type ModelOverride = (prompt: string) => Promise<ToolUse>;
const modelOverride = (): ModelOverride | undefined =>
  (window as unknown as { __nodusDescribeModel?: ModelOverride }).__nodusDescribeModel;

/** Call Claude with the render_diagram tool forced; return the tool_use block. Never mutates anything. */
async function callModel(prompt: string, apiKey: string): Promise<ToolUse> {
  const override = modelOverride();
  if (typeof override === 'function') return override(prompt);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Opt into direct browser access — the key goes only to Anthropic, nothing server-side of ours.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: diagramSystemPrompt,
      tools: [diagramTool],
      tool_choice: { type: 'tool', name: diagramTool.name },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('Invalid API key.');
    throw new Error(`Request failed (${res.status}). ${body.slice(0, 160)}`);
  }
  const data = (await res.json()) as {
    stop_reason?: string;
    content?: Array<{ type: string; name?: string; input?: unknown }>;
  };
  if (data.stop_reason === 'refusal') throw new Error('The model declined this request.');
  const tu = (data.content ?? []).find((b) => b.type === 'tool_use' && b.name === diagramTool.name);
  if (!tu || !tu.name) throw new Error('The model did not return a diagram — try rephrasing.');
  return { name: tu.name, input: tu.input };
}

export interface DescribeDiagramProps {
  editor: Editor;
  open: boolean;
  onClose: () => void;
  /** Called with the generated records; the host adds them (one undoable step) + lays out + fits. */
  onGenerated: (records: NodusRecord[]) => void;
}

export function DescribeDiagram({ editor, open, onClose, onGenerated }: DescribeDiagramProps): JSX.Element | null {
  const t = useUiTokens(editor);
  const [prompt, setPrompt] = useState('');
  const [apiKey, setApiKey] = useState<string>(() => {
    try {
      return localStorage.getItem(KEY_STORAGE) ?? '';
    } catch {
      return '';
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const submit = async (): Promise<void> => {
    setError(null);
    const p = prompt.trim();
    if (!p) {
      setError('Describe the system you want to diagram.');
      return;
    }
    const key = apiKey.trim();
    if (!key && !modelOverride()) {
      setError('Add your Anthropic API key — it is stored locally and sent only to Anthropic.');
      return;
    }
    if (key) {
      try {
        localStorage.setItem(KEY_STORAGE, key);
      } catch {
        /* best-effort persistence */
      }
    }
    setBusy(true);
    try {
      const records = recordsFromToolUse(await callModel(p, key));
      setBusy(false);
      onGenerated(records);
      onClose();
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const label: CSSProperties = {
    fontFamily: t.font.mono,
    fontSize: '10.5px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: t.color.textFaint,
    marginBottom: 5,
    display: 'block',
  };
  const field: CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    background: t.color.canvas,
    color: t.color.text,
    border: `1px solid ${t.color.borderStrong}`,
    borderRadius: t.radius.md,
    fontFamily: t.font.family,
    fontSize: '13px',
    padding: '9px 11px',
    outline: 'none',
  };

  return createPortal(
    <div
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(4,6,9,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        data-testid="describe-modal"
        role="dialog"
        aria-label="Describe a diagram"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) onClose();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
        }}
        style={{
          width: 'min(560px, 92vw)',
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
          <div style={{ fontSize: t.font.size.lg, fontWeight: 600, color: t.color.text }}>Describe a diagram</div>
          <div style={{ fontSize: t.font.size.xs, color: t.color.textFaint, marginTop: 3 }}>
            Natural language → nodes &amp; edges, via Claude. Your key stays in this browser.
          </div>
        </div>

        <div>
          <label htmlFor="nodus-describe-input" style={label}>
            Prompt
          </label>
          <textarea
            id="nodus-describe-input"
            data-testid="describe-input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            autoFocus
            rows={4}
            placeholder="e.g. A web app: users hit a load balancer → two API services → a Postgres database and a Redis cache. A queue feeds a worker."
            style={{ ...field, resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>

        <div>
          <label htmlFor="nodus-describe-key" style={label}>
            Anthropic API key
          </label>
          <input
            id="nodus-describe-key"
            data-testid="describe-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-…  (stored locally, sent only to Anthropic)"
            style={field}
          />
        </div>

        {error && (
          <div
            data-testid="describe-error"
            style={{
              fontSize: '12px',
              color: t.color.danger,
              background: `${t.color.danger}1a`,
              border: `1px solid ${t.color.danger}55`,
              borderRadius: t.radius.md,
              padding: '8px 10px',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
          <span data-testid="describe-status" style={{ fontSize: '12px', color: t.color.textFaint }}>
            {busy ? 'Generating…' : ''}
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              marginLeft: 'auto',
              height: 34,
              padding: '0 14px',
              borderRadius: t.radius.md,
              border: `1px solid ${t.color.borderStrong}`,
              background: 'transparent',
              color: t.color.textMuted,
              fontFamily: t.font.family,
              fontSize: '13px',
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            Close
          </button>
          <button
            type="button"
            data-testid="describe-generate"
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
            Generate
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
