/** A properties panel over the per-element style bag — appears when something is selected. */
import { useEffect, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import type { Editor, Id, NodeRecord, StateTokens } from '@nodus-dev/core';
import { useValue } from './use-value.js';
import { FlowControls } from './flow-controls.js';
import { useUiTokens, type UiTokens } from './ui/tokens.js';
import { UiTokensProvider, Panel, Button } from './ui/primitives.js';
import { injectGlobalStyles } from './ui/global-styles.js';

const NODE_STATES = ['accent', 'solid', 'ghost', 'locked'];

// Stroke style as a 3-way choice over the `dash` style token (a Canvas-2D line-dash pattern in world
// units). Solid clears the dash; dotted is a short/tight pattern; dashed keeps the previous `[5, 4]`
// so existing diagrams round-trip byte-for-byte (canonical-serialization diff CI stays quiet).
const STROKE_STYLES = ['solid', 'dashed', 'dotted'] as const;
type StrokeStyle = (typeof STROKE_STYLES)[number];
const DASH_BY_STYLE: Record<StrokeStyle, number[]> = { solid: [], dotted: [1, 3], dashed: [5, 4] };
/** Map a stored `dash` array back to a named stroke style. A short first segment reads as dotted; any
 *  longer pattern (including the legacy `[5, 4]` and `[4, 4]`) reads as dashed; empty/absent is solid. */
function strokeStyleOf(dash: unknown): StrokeStyle {
  if (!Array.isArray(dash) || dash.length === 0) return 'solid';
  return (typeof dash[0] === 'number' ? dash[0] : 0) <= 2 ? 'dotted' : 'dashed';
}

// Pickable *content* colors for the Fill/Stroke swatch grid. Unlike the chrome (which reads every
// color from `t`), these are diagram-content colors the user assigns to shapes — inherently a fixed
// palette, analogous to a color-picker's presets. Arbitrary colors stay reachable via the trailing
// native `<input type="color">` swatch, so nothing the old color inputs could do is lost.
const SWATCH_COLORS = ['#e5675e', '#f0a53e', '#4ac26b', '#c4f24e', '#35d0e0', '#7aa2ff', '#c99bff', '#e9e9ee'] as const;

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const isHex6 = (v: unknown): v is string => typeof v === 'string' && HEX6.test(v);
const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export interface PropertiesProps {
  editor: Editor;
  className?: string;
  style?: CSSProperties;
}

export function Properties({ editor, className, style }: PropertiesProps): ReactElement | null {
  // Ensure the chrome's focus-visible ring + reduced-motion rules are installed even if the host
  // never called injectGlobalStyles (idempotent, SSR-safe).
  useEffect(() => { injectGlobalStyles(); }, []);
  const t = useUiTokens(editor);

  // Re-render on selection change (selectedAtom.get registers the dep — selectedIdsArray uses peek(),
  // which does NOT) AND on any document mutation. The version MUST be folded into the returned snapshot,
  // not merely read: `useValue` is useSyncExternalStore, which re-renders only when the snapshot VALUE
  // changes (Object.is). A style-only edit bumps the version and fires the subscription, but if the
  // snapshot were just the id list it would be byte-identical → React bails and the panel's own controls
  // (sliders, swatches, opacity readout) freeze at stale values until the selection changes.
  const sig = useValue(() => `${editor.sceneIndex.version.get()}|${[...editor.selectedAtom.get()].join(',')}`);
  const ids = sig.slice(sig.indexOf('|') + 1).split(',').filter(Boolean) as Id[];
  if (ids.length === 0) return null;
  const first = editor.store.peek(ids[0]!);
  if (!first) return null;

  const st = (first.style ?? {}) as Partial<StateTokens>;
  const isNode = first.typeName === 'node';
  const node = isNode ? (first as NodeRecord) : null;
  const hasNode = ids.some((id) => editor.store.peek(id)?.typeName === 'node');
  const firstNodeId = ids.find((id) => editor.store.peek(id)?.typeName === 'node');
  const locked = firstNodeId ? editor.isLocked(firstNodeId) : false;

  // Continuous controls (slider, color scrub, number stepper) fire onChange repeatedly; batch each
  // gesture into ONE undo entry with capture:'later', then commit() (mark) on release/blur — matching
  // the drag tools. Discrete controls (swatch click, segment, action button) apply then commit at once.
  const set = (o: Partial<StateTokens>) => editor.setStyle(ids, o, { capture: 'later' });
  const commit = () => editor.mark();
  const setGeom = (patch: Partial<NodeRecord>) => { if (node) editor.updateNode(node.id, patch, { capture: 'later' }); };
  const dashStyle = strokeStyleOf(st.dash);

  const mono = t.font.mono;

  // ---- token-derived control styles (built per-render so the panel re-skins with the theme) ----
  const secLabel: CSSProperties = { fontFamily: mono, fontSize: '10.5px', letterSpacing: '.08em', textTransform: 'uppercase', color: t.color.textFaint, margin: '18px 0 9px' };
  const fieldWrap: CSSProperties = { flex: 1, display: 'flex', alignItems: 'center', gap: 6, background: t.color.canvas, border: `1px solid ${t.color.border}`, borderRadius: t.radius.md, padding: '0 9px', height: 32, minWidth: 0 };
  const fieldTag: CSSProperties = { fontFamily: mono, fontSize: t.font.size.xs, color: t.color.textFaint };
  const numInput: CSSProperties = { width: '100%', minWidth: 0, background: 'transparent', border: 0, outline: 'none', color: t.color.text, fontSize: t.font.size.md, fontFamily: mono };
  const rangeStyle: CSSProperties = { width: '100%', accentColor: t.color.accent, cursor: 'pointer' };
  const selectStyle: CSSProperties = { flex: 1, minWidth: 0, background: t.color.canvas, color: t.color.text, border: `1px solid ${t.color.border}`, borderRadius: t.radius.md, fontSize: t.font.size.sm, padding: '6px 8px', height: 32 };

  const swatchStyle = (active: boolean, bg: string): CSSProperties => ({
    width: 26, height: 26, padding: 0, borderRadius: t.radius.md, cursor: 'pointer', background: bg,
    border: `1.5px solid ${active ? t.color.accent : t.color.border}`,
    boxShadow: active ? `0 0 0 2px ${t.color.selection}` : 'none',
  });
  const segStyle = (active: boolean): CSSProperties => ({
    flex: 1, height: 30, borderRadius: t.radius.md, cursor: 'pointer', fontSize: t.font.size.sm, fontFamily: mono,
    border: `1px solid ${active ? t.color.accent : t.color.border}`,
    background: active ? t.color.selection : 'transparent',
    color: active ? t.color.accent : t.color.textMuted,
  });
  const actStyle = (opts: { active?: boolean; danger?: boolean }): CSSProperties => ({
    flex: 1, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: t.radius.md, cursor: 'pointer',
    border: `1px solid ${opts.active ? t.color.accent : t.color.border}`,
    background: opts.active ? t.color.selection : 'transparent',
    color: opts.danger ? t.color.danger : opts.active ? t.color.accent : t.color.textMuted,
  });

  const icon = (paths: ReactNode): ReactElement => (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paths}
    </svg>
  );

  // ---- action row: each button is a real editor command over the whole selection ----
  interface Action { key: string; label: string; run: () => void; icon: ReactElement; active?: boolean; danger?: boolean; show?: boolean }
  const actions: Action[] = [
    { key: 'dup', label: 'Duplicate', run: () => editor.duplicate(ids), icon: icon(<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>) },
    { key: 'front', label: 'Bring to front', run: () => editor.bringToFront(ids), icon: icon(<><rect x="4" y="4" width="11" height="11" rx="2" /><path d="M9 20h11V9" /></>) },
    { key: 'back', label: 'Send to back', run: () => editor.sendToBack(ids), icon: icon(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 4H4v11" /></>) },
    { key: 'lock', label: locked ? 'Unlock' : 'Lock', run: () => (locked ? editor.unlock(ids) : editor.lock(ids)), active: locked, show: hasNode, icon: icon(<><rect x="5" y="11" width="14" height="9" rx="2" /><path d={locked ? 'M8 11V8a4 4 0 0 1 8 0v3' : 'M8 11V8a4 4 0 0 1 7.5-2'} /></>) },
    { key: 'del', label: 'Delete', run: () => editor.deleteRecords(ids), danger: true, icon: icon(<path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M6 7l1 13h10l1-13" />) },
  ];

  // A fill/stroke swatch grid: presets from the content palette + a trailing native color input for
  // arbitrary colors. Swatch picks are discrete (set → commit); the native input scrubs (commit on blur).
  const swatchGrid = (name: 'fill' | 'stroke', current: unknown, apply: (v: string) => void): ReactElement => {
    const cur = typeof current === 'string' ? current.toLowerCase() : '';
    const presetMatch = SWATCH_COLORS.some((c) => c.toLowerCase() === cur);
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {SWATCH_COLORS.map((c) => {
          const active = c.toLowerCase() === cur;
          return (
            <button
              key={c}
              data-nodus-ui=""
              type="button"
              title={c}
              aria-label={`${cap(name)} ${c}`}
              aria-pressed={active}
              onClick={() => { apply(c); commit(); }}
              style={swatchStyle(active, c)}
            />
          );
        })}
        <input
          data-nodus-ui=""
          type="color"
          aria-label={`Custom ${name} color`}
          value={isHex6(current) ? current : name === 'fill' ? '#101319' : '#9fa2ad'}
          onChange={(e) => apply(e.target.value)}
          onBlur={commit}
          style={swatchStyle(isHex6(current) && !presetMatch, isHex6(current) ? current : 'transparent')}
        />
      </div>
    );
  };

  const geomField = (tag: 'X' | 'Y' | 'W' | 'H', value: number, apply: (v: number) => void, min?: number): ReactElement => (
    <label style={fieldWrap}>
      <span style={fieldTag}>{tag}</span>
      <input
        data-nodus-ui=""
        type="number"
        aria-label={{ X: 'X position', Y: 'Y position', W: 'Width', H: 'Height' }[tag]}
        value={Math.round(value)}
        onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) apply(min != null ? Math.max(min, v) : v); }}
        onBlur={commit}
        style={numInput}
      />
    </label>
  );

  const opacityPct = Math.round((st.opacity ?? 1) * 100);

  return (
    <UiTokensProvider tokens={t}>
      <Panel
        elevated
        className={className}
        role="region"
        aria-label="Element style properties"
        // Defaults first, incoming `style` LAST so the app can dock/flatten this into a full-height
        // rail (override width/height/border/radius/shadow). padding:0 — the inner column owns padding.
        style={{ width: 240, padding: 0, display: 'flex', flexDirection: 'column', fontSize: t.font.size.sm, ...style }}
      >
        <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '16px 15px' }}>
          {/* header: shape type + record id (mono, faint) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: t.font.size.lg, fontWeight: 600, color: t.color.text }}>
              {cap(node ? node.type : first.typeName)}
            </span>
            <span style={{ marginLeft: 'auto', fontFamily: mono, fontSize: '10.5px', color: t.color.textFaint, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ids.length > 1 ? `${ids.length} selected` : first.id}
            </span>
          </div>

          {/* action row */}
          <div style={{ display: 'flex', gap: 6, margin: '14px 0 4px' }}>
            {actions.filter((a) => a.show !== false).map((a) => (
              <button
                key={a.key}
                data-nodus-ui=""
                type="button"
                title={a.label}
                aria-label={a.label}
                aria-pressed={a.key === 'lock' ? !!a.active : undefined}
                onClick={a.run}
                style={actStyle({ active: a.active, danger: a.danger })}
              >
                {a.icon}
              </button>
            ))}
          </div>

          {/* position — node-only geometry, live from the record */}
          {node && (
            <>
              <div style={secLabel}>Position</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {geomField('X', node.x, (v) => setGeom({ x: v }))}
                {geomField('Y', node.y, (v) => setGeom({ y: v }))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                {geomField('W', node.w, (v) => setGeom({ w: v }), 1)}
                {geomField('H', node.h, (v) => setGeom({ h: v }), 1)}
              </div>
            </>
          )}

          {/* fill / stroke swatch grids */}
          <div style={secLabel}>Fill</div>
          {swatchGrid('fill', st.fill, (v) => set({ fill: v }))}
          <div style={secLabel}>Stroke</div>
          {swatchGrid('stroke', st.stroke, (v) => set({ stroke: v }))}

          {/* stroke width */}
          <div style={secLabel}>Stroke width</div>
          <input
            data-nodus-ui=""
            type="range"
            min={0.5}
            max={8}
            step={0.5}
            value={st.strokeWidth ?? 1.2}
            onChange={(e) => set({ strokeWidth: Number(e.target.value) })}
            onPointerUp={commit}
            onBlur={commit}
            style={rangeStyle}
            aria-label="Stroke width"
          />

          {/* opacity — current % shown in the label in mono */}
          <div style={secLabel}>Opacity — <span style={{ fontFamily: mono, color: t.color.textMuted }}>{opacityPct}%</span></div>
          <input
            data-nodus-ui=""
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={st.opacity ?? 1}
            onChange={(e) => set({ opacity: Number(e.target.value) })}
            onPointerUp={commit}
            onBlur={commit}
            style={rangeStyle}
            aria-label="Opacity"
          />

          {/* stroke style — 3 segmented buttons over the dash token */}
          <div style={secLabel}>Stroke style</div>
          <div style={{ display: 'flex', gap: 6 }} role="group" aria-label="Stroke style">
            {STROKE_STYLES.map((s) => (
              <button
                key={s}
                data-nodus-ui=""
                type="button"
                aria-pressed={dashStyle === s}
                onClick={() => { set({ dash: [...DASH_BY_STYLE[s]] }); commit(); }}
                style={segStyle(dashStyle === s)}
              >
                {cap(s)}
              </button>
            ))}
          </div>

          {/* roughness — 0 = clean vector, higher = seeded hand-drawn "sketchy" outline */}
          <div style={secLabel}>Roughness</div>
          <input
            data-nodus-ui=""
            type="range"
            min={0}
            max={6}
            step={0.5}
            value={st.roughness ?? 0}
            onChange={(e) => set({ roughness: Number(e.target.value) })}
            onPointerUp={commit}
            onBlur={commit}
            style={rangeStyle}
            aria-label="Roughness (hand-drawn style)"
          />

          {/* text color — a single custom-color swatch (kept: real `text` style mutation) */}
          <div style={secLabel}>Text</div>
          <input
            data-nodus-ui=""
            type="color"
            aria-label="Text color"
            value={isHex6(st.text) ? st.text : '#e5e5e5'}
            onChange={(e) => set({ text: e.target.value })}
            onBlur={commit}
            style={swatchStyle(false, isHex6(st.text) ? st.text : '#e5e5e5')}
          />

          {/* node visual state — theme skin (kept: real `visual.state` mutation, node-only) */}
          {node && (
            <>
              <div style={secLabel}>State</div>
              <select
                data-nodus-ui=""
                aria-label="Node visual state"
                value={node.visual.state}
                onChange={(e) => {
                  const state = e.target.value;
                  for (const id of ids) {
                    const r = editor.store.peek(id);
                    if (r && r.typeName === 'node') editor.updateNode(id, { visual: { ...r.visual, state } }, { capture: 'later' });
                  }
                  commit(); // collapse a multi-select state change into one undo entry
                }}
                style={selectStyle}
              >
                {NODE_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </>
          )}

          <Button
            variant="default"
            size="sm"
            style={{ marginTop: 16, width: '100%' }}
            onClick={() => { editor.clearStyle(ids, { capture: 'later' }); commit(); }}
          >
            Clear style
          </Button>

          <FlowControls editor={editor} ids={ids} />
        </div>
      </Panel>
    </UiTokensProvider>
  );
}
