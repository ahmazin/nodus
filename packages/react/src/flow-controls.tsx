/** Per-edge flow authoring — a Flow section for the Properties panel. Basic FlowSpec controls +
 *  an animated preview strip; an Advanced disclosure holds the data-driven scale editor. */
import { useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { resolveTokens, type Editor, type EdgeRecord, type FlowSpec, type Id } from '@nodus/core';
import { useValue } from './use-value.js';
import { BORDER, buildRampCss, DEFAULT_FLOW, FLOW, flowMicro, flowRowCss, FLOW_STYLE, flowSelect, ghostBtn, MICRO, ROW_LABEL, swatch } from './flow-shared.js';
import { FlowScaleEditor } from './flow-scale-editor.js';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const isHex6 = (c: string): boolean => /^#[0-9a-f]{6}$/i.test(c);

export interface FlowControlsProps {
  editor: Editor;
  ids: Id[];
}

export function FlowControls({ editor, ids }: FlowControlsProps): ReactElement | null {
  // Re-render on selection change AND on flow edits to the selected edges. The parent panel's
  // snapshot is only the selection string, so a same-selection value change (adding/editing flow)
  // wouldn't re-render this subtree — and React would then snap our controlled inputs back to their
  // stale values. Depend on the version + each selected edge's flow so our snapshot changes too.
  useValue(() => {
    editor.sceneIndex.version.get();
    let s = '';
    for (const id of editor.selectedAtom.get()) {
      const r = editor.store.peek(id);
      if (r?.typeName === 'edge') s += `${id}:${JSON.stringify((r as EdgeRecord).flow ?? 0)};`;
    }
    return s;
  });
  const edgeIds = ids.filter((id) => editor.store.peek(id)?.typeName === 'edge');
  const first = edgeIds[0];
  const [advOpen, setAdvOpen] = useState(false);
  if (!first) return null;

  const rec = editor.store.peek(first) as EdgeRecord | undefined;
  const flow = rec?.flow;
  const on = !!flow;

  // display-first / apply-to-all: read the first edge's flow, merge a patch, write to all edges.
  const patch = (p: Partial<FlowSpec>, capture: 'later' | 'immediately' = 'later'): void => {
    const cur = (editor.store.peek(first) as EdgeRecord | undefined)?.flow ?? {};
    const next: FlowSpec = { ...cur };
    for (const k of Object.keys(p) as (keyof FlowSpec)[]) {
      const v = p[k];
      if (v === undefined) delete next[k];
      else (next as unknown as Record<string, unknown>)[k] = v;
    }
    editor.setFlow(edgeIds, next, { capture });
  };
  const commit = (): void => editor.mark();
  const setFlowOnOff = (enabled: boolean): void => editor.setFlow(edgeIds, enabled ? DEFAULT_FLOW : null);

  const row = (label: string, control: ReactNode): ReactElement => (
    <label style={flowRowCss}>
      <span style={{ color: ROW_LABEL }}>{label}</span>
      {control}
    </label>
  );

  const style = flow?.style ?? 'dots';

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${BORDER}` }}>
      <style>{FLOW_STYLE}</style>
      <div style={{ ...flowMicro, marginBottom: 8 }}>
        Flow · {edgeIds.length} edge{edgeIds.length === 1 ? '' : 's'}
      </div>

      {/* signature: live preview strip — animated packets/dashes (basic) or the ramp (data-driven). */}
      {flow?.scale ? (
        <div
          data-testid="flow-preview-ramp"
          style={{ width: '100%', height: 24, marginBottom: 8, borderRadius: 6, border: `1px solid ${BORDER}`, background: buildRampCss(flow.scale.colors ?? [], flow.scale.domain, flow.scale.gradient) }}
        />
      ) : (
        <FlowPreview editor={editor} edgeId={first} flow={flow} />
      )}

      {row(
        'Animate',
        <input data-testid="flow-animate" type="checkbox" checked={on} onChange={(e) => setFlowOnOff(e.target.checked)} />,
      )}

      {on && (
        <>
          {row(
            'Style',
            <select data-testid="flow-style" value={style} onChange={(e) => patch({ style: e.target.value as FlowSpec['style'] }, 'immediately')} style={flowSelect}>
              <option value="dots">dots</option>
              <option value="dash">dash</option>
            </select>,
          )}
          {row(
            'Speed',
            <input data-testid="flow-speed" type="range" min={10} max={200} step={1} value={flow?.speed ?? 70} onChange={(e) => patch({ speed: Number(e.target.value) })} onPointerUp={commit} onBlur={commit} />,
          )}
          {row(
            'Size',
            <input data-testid="flow-size" type="range" min={1} max={12} step={0.5} value={flow?.size ?? 3} onChange={(e) => patch({ size: Number(e.target.value) })} onPointerUp={commit} onBlur={commit} />,
          )}
          {style === 'dots' &&
            row(
              'Count',
              <input data-testid="flow-count" type="range" min={1} max={30} step={1} value={flow?.count ?? 8} onChange={(e) => patch({ count: Number(e.target.value) })} onPointerUp={commit} onBlur={commit} />,
            )}
          {row(
            'Reverse',
            <input data-testid="flow-reverse" type="checkbox" checked={!!flow?.reverse} onChange={(e) => patch({ reverse: e.target.checked }, 'immediately')} />,
          )}
          {row(
            'Color',
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input data-testid="flow-color" type="color" value={flow?.color && isHex6(flow.color) ? flow.color : resolvedStroke(editor, first)} onChange={(e) => patch({ color: e.target.value })} onBlur={commit} style={swatch} />
              <button data-testid="flow-color-reset" title="Reset to edge stroke" style={ghostBtn} onClick={() => patch({ color: undefined }, 'immediately')}>
                reset
              </button>
            </span>,
          )}

          {/* Advanced / data-driven disclosure. Chevron rotates; grid-rows animates height. */}
          <button
            data-testid="flow-advanced-toggle"
            onClick={() => setAdvOpen((v) => !v)}
            style={{ ...flowMicro, display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 0, padding: '6px 0 4px', cursor: 'pointer', width: '100%' }}
          >
            <span className="nodus-flow-chevron" style={{ transition: 'transform 160ms ease', transform: advOpen ? 'rotate(90deg)' : 'rotate(0deg)', color: FLOW }}>▸</span>
            Advanced · data-driven
          </button>
          <div className="nodus-flow-disc" style={{ display: 'grid', gridTemplateRows: advOpen ? '1fr' : '0fr', transition: 'grid-template-rows 180ms ease' }}>
            <div style={{ overflow: 'hidden' }}>
              <FlowScaleEditor editor={editor} edgeIds={edgeIds} firstEdge={first} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// resolved edge stroke — the fallback color the renderer uses when flow.color is unset.
export function resolvedStroke(editor: Editor, edgeId: Id): string {
  const rec = editor.store.peek(edgeId) as EdgeRecord | undefined;
  if (!rec) return '#7a8a80';
  try {
    const t = resolveTokens(editor.themeAtom.peek(), rec.visual, rec.type, rec.style);
    return t.stroke ?? '#7a8a80';
  } catch {
    return '#7a8a80';
  }
}

// ---- signature: the animated preview strip (basic mode) ----
function FlowPreview({ editor, edgeId, flow }: { editor: Editor; edgeId: Id; flow: FlowSpec | undefined }): ReactElement {
  const track: CSSProperties = {
    position: 'relative', width: '100%', height: 24, marginBottom: 8, borderRadius: 6,
    border: `1px solid ${BORDER}`, background: '#0a0f0c', overflow: 'hidden',
  };
  if (!flow) {
    return <div style={{ ...track, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MICRO, fontSize: 10.5 }}>flow off</div>;
  }
  const color = flow.color && isHex6(flow.color) ? flow.color : resolvedStroke(editor, edgeId);
  const speed = clamp(flow.speed ?? 70, 1, 400);
  const reverse = !!flow.reverse;

  if (flow.style === 'dash') {
    const lineW = clamp(flow.size ?? 1.5, 1, 8);
    const dashLen = clamp((flow.size ?? 6) * 2, 4, 40);
    const period = dashLen * 2;
    const dur = clamp(period / speed, 0.15, 4);
    const barStyle = {
      position: 'absolute', top: '50%', left: 0, right: 0, height: lineW, transform: 'translateY(-50%)',
      backgroundImage: `repeating-linear-gradient(90deg, ${color} 0, ${color} ${dashLen}px, transparent ${dashLen}px, transparent ${period}px)`,
      animation: `nodus-flow-dash ${dur}s linear infinite`,
      '--nodus-flow-shift': `${reverse ? -period : period}px`,
    } as CSSProperties;
    return (
      <div style={track}>
        <div className="nodus-flow-anim" style={barStyle} />
      </div>
    );
  }
  // dots
  const r = clamp(flow.size ?? 3, 1, 8);
  const count = clamp(Math.round(flow.count ?? 8), 1, 30);
  const spacing = clamp(180 / count, 8, 60);
  const dur = clamp(spacing / speed, 0.12, 3);
  const dots: ReactElement[] = [];
  for (let i = 0; i < count + 2; i++) {
    dots.push(
      <span
        key={i}
        style={{
          position: 'absolute', top: '50%', left: (i - 1) * spacing, width: r * 2, height: r * 2, marginTop: -r, marginLeft: -r,
          borderRadius: '50%', background: color, filter: `drop-shadow(0 0 ${r * 2.5}px ${color})`,
        }}
      />,
    );
  }
  const trackStyle = {
    position: 'absolute', top: 0, bottom: 0, left: 0, width: '200%',
    animation: `nodus-flow-dots ${dur}s linear infinite`,
    '--nodus-flow-shift': `${reverse ? -spacing : spacing}px`,
  } as CSSProperties;
  return (
    <div style={track}>
      <div className="nodus-flow-anim" style={trackStyle}>
        {dots}
      </div>
    </div>
  );
}
