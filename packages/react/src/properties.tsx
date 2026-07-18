/** A properties panel over the per-element style bag — appears when something is selected. */
import { useEffect, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import type { Editor, Id, NodeRecord, StateTokens } from '@nodus/core';
import { useValue } from './use-value.js';
import { FlowControls } from './flow-controls.js';
import { useUiTokens, type UiTokens } from './ui/tokens.js';
import { UiTokensProvider, Panel, Button } from './ui/primitives.js';
import { injectGlobalStyles } from './ui/global-styles.js';

const NODE_STATES = ['accent', 'solid', 'ghost', 'locked'];

const rowCss: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 26 };

// Token-derived control styles (built per-render so the panel re-skins with the theme).
function swatchStyle(t: UiTokens): CSSProperties {
  return { width: 34, height: 20, padding: 0, border: `1px solid ${t.color.border}`, background: 'transparent', borderRadius: t.radius.sm, cursor: 'pointer' };
}
function selectStyle(t: UiTokens): CSSProperties {
  return { background: t.color.surface, color: t.color.text, border: `1px solid ${t.color.border}`, borderRadius: t.radius.sm, fontSize: t.font.size.xs, padding: '2px 4px' };
}

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
  // which does NOT) AND on any document mutation (version bump reflects new style values live).
  const sig = useValue(() => {
    editor.sceneIndex.version.get();
    return [...editor.selectedAtom.get()].join(',');
  });
  const ids = (sig ? sig.split(',') : []) as Id[];
  if (ids.length === 0) return null;
  const first = editor.store.peek(ids[0]!);
  if (!first) return null;

  const st = (first.style ?? {}) as Partial<StateTokens>;
  const isNode = first.typeName === 'node';
  // Continuous controls (slider, color picker) fire onChange repeatedly; batch each gesture into ONE
  // undo entry with capture:'later', then commit() (mark) on release/blur — matching the drag tools.
  const set = (o: Partial<StateTokens>) => editor.setStyle(ids, o, { capture: 'later' });
  const commit = () => editor.mark();
  const dashed = Array.isArray(st.dash) && st.dash.length > 0;
  const swatch = swatchStyle(t);
  const select = selectStyle(t);
  const checkbox: CSSProperties = { accentColor: t.color.accent };
  const row = (label: string, control: ReactNode) => (
    <label style={rowCss}>
      <span style={{ color: t.color.textMuted, fontSize: t.font.size.xs }}>{label}</span>
      {control}
    </label>
  );

  return (
    <UiTokensProvider tokens={t}>
      <Panel
        elevated
        className={className}
        role="region"
        aria-label="Element style properties"
        style={{ width: 210, padding: 12, fontSize: t.font.size.sm, ...style }}
      >
        <div style={{ fontSize: t.font.size.xs, letterSpacing: '.08em', textTransform: 'uppercase', color: t.color.textMuted, marginBottom: 8 }}>
          Style · {ids.length} selected
        </div>
        {row('Stroke', <input type="color" value={st.stroke ?? '#7a8a80'} onChange={(e) => set({ stroke: e.target.value })} onBlur={commit} style={swatch} aria-label="Stroke color" />)}
        {row('Fill', <input type="color" value={typeof st.fill === 'string' && st.fill.startsWith('#') ? st.fill : '#0c100f'} onChange={(e) => set({ fill: e.target.value })} onBlur={commit} style={swatch} aria-label="Fill color" />)}
        {row('Text', <input type="color" value={st.text ?? '#e5e5e5'} onChange={(e) => set({ text: e.target.value })} onBlur={commit} style={swatch} aria-label="Text color" />)}
        {row('Width', <input type="range" min={0.5} max={8} step={0.5} value={st.strokeWidth ?? 1.2} onChange={(e) => set({ strokeWidth: Number(e.target.value) })} onPointerUp={commit} onBlur={commit} style={{ flex: 1, minWidth: 0, accentColor: t.color.accent }} aria-label="Stroke width" />)}
        {row('Dashed', <input type="checkbox" checked={dashed} onChange={(e) => { set({ dash: e.target.checked ? [5, 4] : [] }); commit(); }} style={checkbox} aria-label="Dashed stroke" />)}
        {isNode &&
          row(
            'State',
            <select
              aria-label="Node visual state"
              value={(first as NodeRecord).visual.state}
              onChange={(e) => {
                const state = e.target.value;
                for (const id of ids) {
                  const r = editor.store.peek(id);
                  if (r && r.typeName === 'node') editor.updateNode(id, { visual: { ...r.visual, state } }, { capture: 'later' });
                }
                commit(); // collapse a multi-select state change into one undo entry
              }}
              style={select}
            >
              {NODE_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>,
          )}
        <Button
          variant="default"
          size="sm"
          style={{ marginTop: 8, width: '100%' }}
          onClick={() => { editor.clearStyle(ids, { capture: 'later' }); commit(); }}
        >
          Clear style
        </Button>
        <FlowControls editor={editor} ids={ids} />
      </Panel>
    </UiTokensProvider>
  );
}
