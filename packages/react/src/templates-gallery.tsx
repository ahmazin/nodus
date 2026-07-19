/**
 * A gallery of starting-diagram **templates**. Each card shows a rendered preview of the template's
 * whole-document snapshot; clicking a card opens it as a fresh document (`editor.loadSnapshot`, fit to
 * view). An optional `onBeforeOpen` guard lets the host interpose (e.g. a discard-unsaved-changes
 * prompt) — returning `false` cancels the open.
 *
 * Unlike the stencil palette this is an always-rendered panel (mount it in a modal / start screen),
 * not a popover. Decoupled from `@nodus/stencils`: templates arrive as a prop.
 */
import { useMemo, useRef, type CSSProperties, type ReactElement } from 'react';
import { Editor, renderSVG } from '@nodus/core';
import type { Template } from '@nodus/stencils';
import { useUiTokens, type UiMode, type UiTokens } from './ui/tokens.js';

export interface TemplatesGalleryProps {
  editor: Editor;
  templates: Template[];
  /** Return `false` (or a promise resolving to `false`) to cancel the open — e.g. an unsaved guard. */
  onBeforeOpen?: () => boolean | Promise<boolean>;
  className?: string;
  style?: CSSProperties;
}

const CARD_H = 118; // preview box height in css px

// ── Thumbnails ────────────────────────────────────────────────────────────────────────────────
// Each template's snapshot is rendered once to an inline SVG data-URI via the core vector exporter,
// using a throwaway editor seeded with the *real* editor's registered types + theme. Cached by
// (template, mode) so a light/dark flip re-renders.
const thumbCache = new WeakMap<Template, Map<UiMode, string>>();

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function renderTemplateThumb(editor: Editor, snapshot: Template['snapshot']): string {
  const preview = new Editor({
    builtins: false, // the real editor's list() already carries rect/line — don't double-register
    nodeTypes: editor.nodes.list(),
    edgeTypes: editor.edges.list(),
    theme: editor.themeAtom.peek(),
  });
  preview.loadSnapshot(snapshot);
  return svgToDataUri(renderSVG(preview, { padding: 12, background: true }));
}

function templateThumb(editor: Editor, template: Template, mode: UiMode): string | null {
  if (template.preview) return template.preview; // host-supplied thumbnail wins
  if (template.snapshot.document.records.length === 0) return null; // blank → placeholder, don't render
  let byMode = thumbCache.get(template);
  if (!byMode) {
    byMode = new Map();
    thumbCache.set(template, byMode);
  }
  let uri = byMode.get(mode);
  if (uri === undefined) {
    uri = renderTemplateThumb(editor, template.snapshot);
    byMode.set(mode, uri);
  }
  return uri;
}

// ── Styles ──────────────────────────────────────────────────────────────────────────────────────
interface Styles {
  panel: CSSProperties;
  grid: CSSProperties;
  card: CSSProperties;
  previewBox: CSSProperties;
  thumb: CSSProperties;
  placeholder: CSSProperties;
  name: CSSProperties;
  desc: CSSProperties;
  empty: CSSProperties;
}

function buildStyles(t: UiTokens): Styles {
  const c = t.color;
  return {
    panel: {
      background: c.panel, border: `1px solid ${c.border}`, borderRadius: t.radius.lg, padding: 12,
      color: c.text, fontFamily: t.font.family, boxShadow: t.shadow.panel,
    },
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 },
    card: {
      display: 'flex', flexDirection: 'column', textAlign: 'left', gap: 6, padding: 8,
      background: c.surface, border: `1px solid ${c.border}`, borderRadius: t.radius.md,
      cursor: 'pointer', color: c.text, fontFamily: t.font.family, width: '100%', boxSizing: 'border-box',
    },
    previewBox: {
      height: CARD_H, borderRadius: t.radius.sm, border: `1px solid ${c.border}`,
      background: c.canvas, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
    thumb: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' },
    placeholder: { fontSize: 11, color: c.textFaint },
    name: { fontSize: 12, fontWeight: 600, color: c.text },
    desc: { fontSize: 11, color: c.textMuted, lineHeight: 1.35 },
    empty: { padding: '30px 12px', textAlign: 'center', color: c.textMuted, fontSize: 12 },
  };
}

/** A single template card: rendered snapshot preview + name + description, opens on click. */
function Card({ editor, template, mode, onOpen }: { editor: Editor; template: Template; mode: UiMode; onOpen: () => void }): ReactElement {
  const S = buildStyles(useUiTokens(editor));
  const uri = useMemo(() => templateThumb(editor, template, mode), [editor, template, mode]);
  return (
    <button
      type="button"
      data-testid={`template-card-${template.id}`}
      style={S.card}
      onClick={onOpen}
      title={template.description ?? template.name}
    >
      <div style={S.previewBox}>
        {uri ? (
          <img src={uri} alt="" aria-hidden="true" style={S.thumb} draggable={false} />
        ) : (
          <span style={S.placeholder}>Blank canvas</span>
        )}
      </div>
      <span style={S.name}>{template.name}</span>
      {template.description && <span style={S.desc}>{template.description}</span>}
    </button>
  );
}

export function TemplatesGallery({ editor, templates, onBeforeOpen, className, style }: TemplatesGalleryProps): ReactElement | null {
  const t = useUiTokens(editor); // subscribes to the theme atom → re-renders (and re-keys thumbnails) on a light/dark flip
  const S = buildStyles(t);
  const openingRef = useRef(false); // guard against a re-entrant open while `onBeforeOpen` is awaited

  const open = (template: Template): void => {
    if (openingRef.current) return;
    openingRef.current = true;
    void (async () => {
      try {
        if ((await onBeforeOpen?.()) === false) return;
        editor.loadSnapshot(template.snapshot, { fit: true });
      } finally {
        openingRef.current = false;
      }
    })();
  };

  return (
    <div data-nodus-ui="" className={className} style={{ ...S.panel, ...style }} data-testid="templates-gallery">
      {templates.length === 0 ? (
        <div style={S.empty}>No templates available</div>
      ) : (
        <div style={S.grid}>
          {templates.map((template) => (
            <Card key={template.id} editor={editor} template={template} mode={t.mode} onOpen={() => open(template)} />
          ))}
        </div>
      )}
    </div>
  );
}
