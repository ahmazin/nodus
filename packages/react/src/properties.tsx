/** A properties panel over the per-element style bag — appears when something is selected. */
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { Editor, Id, NodeRecord, StateTokens } from '@nodus/core';
import { useValue } from './use-value.js';
import { FlowControls } from './flow-controls.js';

const NODE_STATES = ['accent', 'solid', 'ghost', 'locked'];

const panel: CSSProperties = {
  width: 210,
  background: '#0d1310',
  border: '1px solid #28322c',
  borderRadius: 10,
  padding: 12,
  fontFamily: 'ui-monospace, monospace',
  fontSize: 12,
  color: '#cdd5d0',
  boxShadow: '0 14px 40px -18px rgba(0,0,0,0.7)',
};
const rowCss: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, height: 26 };
const color: CSSProperties = { width: 34, height: 20, padding: 0, border: '1px solid #28322c', background: 'transparent', borderRadius: 4 };
const select: CSSProperties = { background: '#12161c', color: '#cdd5d0', border: '1px solid #28322c', borderRadius: 5, fontSize: 12, padding: '2px 4px' };
const btn: CSSProperties = { marginTop: 8, width: '100%', background: '#12161c', color: '#cdd5d0', border: '1px solid #28322c', borderRadius: 6, padding: '6px', fontSize: 12, cursor: 'pointer' };

export interface PropertiesProps {
  editor: Editor;
  className?: string;
  style?: CSSProperties;
}

export function Properties({ editor, className, style }: PropertiesProps): ReactElement | null {
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
  const row = (label: string, control: ReactNode) => (
    <label style={rowCss}>
      <span style={{ color: '#8b958f' }}>{label}</span>
      {control}
    </label>
  );

  return (
    <div className={className} style={{ ...panel, ...style }}>
      <div style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: '#556058', marginBottom: 8 }}>
        Style · {ids.length} selected
      </div>
      {row('Stroke', <input type="color" value={st.stroke ?? '#7a8a80'} onChange={(e) => set({ stroke: e.target.value })} onBlur={commit} style={color} />)}
      {row('Fill', <input type="color" value={typeof st.fill === 'string' && st.fill.startsWith('#') ? st.fill : '#0c100f'} onChange={(e) => set({ fill: e.target.value })} onBlur={commit} style={color} />)}
      {row('Text', <input type="color" value={st.text ?? '#e5e5e5'} onChange={(e) => set({ text: e.target.value })} onBlur={commit} style={color} />)}
      {row('Width', <input type="range" min={0.5} max={8} step={0.5} value={st.strokeWidth ?? 1.2} onChange={(e) => set({ strokeWidth: Number(e.target.value) })} onPointerUp={commit} onBlur={commit} />)}
      {row('Dashed', <input type="checkbox" checked={dashed} onChange={(e) => { set({ dash: e.target.checked ? [5, 4] : [] }); commit(); }} />)}
      {isNode &&
        row(
          'State',
          <select
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
      <button style={btn} onClick={() => { editor.clearStyle(ids, { capture: 'later' }); commit(); }}>
        Clear style
      </button>
      <FlowControls editor={editor} ids={ids} />
    </div>
  );
}
