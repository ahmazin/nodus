/** Data-driven flow scale authoring: the color-stop ramp (draggable handles), Domain, the three
 *  visual ranges, Gradient, the stops list, and the live metric scrubber. */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { Editor, EdgeRecord, FlowColorStop, FlowScale, FlowSpec, Id } from '@ahmazin/core';
import { buildRampCss, clamp, DEFAULT_SCALE, flowStyles, isHex6, type FlowStyles } from './flow-shared.js';
import { useUiTokens } from './ui/tokens.js';

// Parse a number field, treating empty/NaN as "no change" — so clearing a field to retype it
// doesn't write 0 (and re-stamp "0" under the caret) into the scale.
const num = (s: string): number | null => {
  const n = Number(s);
  return s.trim() === '' || !Number.isFinite(n) ? null : n;
};

export interface FlowScaleEditorProps {
  editor: Editor;
  edgeIds: Id[];
  firstEdge: Id;
}

export function FlowScaleEditor({ editor, edgeIds, firstEdge }: FlowScaleEditorProps): ReactElement {
  const s = flowStyles(useUiTokens(editor));
  const rec = editor.store.peek(firstEdge) as EdgeRecord | undefined;
  const flow = rec?.flow ?? {};
  const scale = flow.scale;

  // ---- scale write helpers (display-first / apply-to-all, undo-batched) ----
  const writeScale = (next: FlowScale | undefined, capture: 'later' | 'immediately'): void => {
    const cur = (editor.store.peek(firstEdge) as EdgeRecord | undefined)?.flow ?? {};
    const merged: FlowSpec = { ...cur };
    if (next === undefined) delete merged.scale;
    else merged.scale = next;
    editor.setFlow(edgeIds, merged, { capture });
  };
  const patchScale = (p: Partial<FlowScale>, capture: 'later' | 'immediately' = 'later'): void => {
    const base = ((editor.store.peek(firstEdge) as EdgeRecord | undefined)?.flow?.scale) ?? DEFAULT_SCALE;
    const next: FlowScale = { ...base };
    for (const k of Object.keys(p) as (keyof FlowScale)[]) {
      const v = p[k];
      if (v === undefined) delete next[k];
      else (next as unknown as Record<string, unknown>)[k] = v;
    }
    writeScale(next, capture);
  };
  const commit = (): void => editor.mark();

  const row = (label: string, control: ReactNode): ReactElement => (
    <label style={s.rowCss}>
      <span style={{ color: s.labelColor }}>{label}</span>
      {control}
    </label>
  );

  const dataOn = !!scale;
  const domain: [number, number] = scale?.domain ?? DEFAULT_SCALE.domain;

  return (
    <div style={{ marginTop: 4 }}>
      {row(
        'Data-driven',
        <input data-testid="flow-datadriven" type="checkbox" checked={dataOn} onChange={(e) => writeScale(e.target.checked ? DEFAULT_SCALE : undefined, 'immediately')} style={s.checkbox} />,
      )}

      {dataOn && scale && (
        <>
          <RampStrip scale={scale} onDrag={patchScale} onCommit={commit} s={s} />

          {row(
            'Domain',
            <span style={{ display: 'flex', gap: 6 }}>
              <input data-testid="flow-domain-min" type="number" style={s.numField} value={domain[0]} onChange={(e) => { const n = num(e.target.value); if (n !== null) patchScale({ domain: [n, domain[1]] }); }} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} onBlur={commit} />
              <input data-testid="flow-domain-max" type="number" style={s.numField} value={domain[1]} onChange={(e) => { const n = num(e.target.value); if (n !== null) patchScale({ domain: [domain[0], n] }); }} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} onBlur={commit} />
            </span>,
          )}

          <RangeRow label="Speed range" testid="speed" value={scale.speed} fallback={[40, 120]} onToggle={(v) => patchScale({ speed: v }, 'immediately')} onEdit={(v) => patchScale({ speed: v })} onCommit={commit} s={s} />
          <RangeRow label="Count range" testid="count" value={scale.count} fallback={[2, 16]} onToggle={(v) => patchScale({ count: v }, 'immediately')} onEdit={(v) => patchScale({ count: v })} onCommit={commit} s={s} />
          <RangeRow label="Size range" testid="size" value={scale.size} fallback={[2, 6]} onToggle={(v) => patchScale({ size: v }, 'immediately')} onEdit={(v) => patchScale({ size: v })} onCommit={commit} s={s} />

          {row(
            'Gradient',
            <input data-testid="flow-gradient" type="checkbox" checked={!!scale.gradient} onChange={(e) => patchScale({ gradient: e.target.checked }, 'immediately')} style={s.checkbox} />,
          )}

          <StopsList scale={scale} domain={domain} onChange={(colors, capture) => patchScale({ colors }, capture)} onCommit={commit} s={s} />

          <MetricScrubber editor={editor} edgeIds={edgeIds} firstEdge={firstEdge} domain={domain} s={s} />
        </>
      )}
    </div>
  );
}

// ---- the color-stop ramp with draggable handles (signature, data-driven mode) ----
function RampStrip({ scale, onDrag, onCommit, s }: {
  scale: FlowScale;
  onDrag: (p: Partial<FlowScale>, capture?: 'later' | 'immediately') => void;
  onCommit: () => void;
  s: FlowStyles;
}): ReactElement {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [min, max] = scale.domain;
  const span = max - min || 1;
  const stops = scale.colors ?? [];
  const pos = (at: number): number => clamp((at - min) / span, 0, 1) * 100;

  useEffect(() => {
    if (dragIdx == null) return;
    const onMove = (e: PointerEvent): void => {
      if (!barRef.current) return;
      const r = barRef.current.getBoundingClientRect();
      const frac = clamp((e.clientX - r.left) / r.width, 0, 1);
      const at = +(min + frac * span).toFixed(2);
      const next = stops.map((stop, i) => (i === dragIdx ? { ...stop, at } : stop));
      onDrag({ colors: next }, 'later');
    };
    const onUp = (): void => { setDragIdx(null); onCommit(); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ marginBottom: 8 }}>
      <div
        ref={barRef}
        data-testid="flow-ramp"
        style={{ position: 'relative', width: '100%', height: 24, borderRadius: 6, border: `1px solid ${s.border}`, background: buildRampCss(stops, scale.domain, scale.gradient) }}
      >
        {stops.map((stop, i) => (
          <span
            key={i}
            data-testid={`flow-ramp-handle-${i}`}
            // seal any open 'later' group (e.g. a number field edited just before, whose blur our
            // preventDefault suppresses) so this drag becomes its own single undo entry.
            onPointerDown={(e) => { e.preventDefault(); onCommit(); setDragIdx(i); }}
            title={`${stop.at}`}
            style={{ position: 'absolute', top: -3, left: `${pos(stop.at)}%`, width: 10, height: 30, transform: 'translateX(-50%)', borderRadius: 3, border: `1.5px solid ${s.accent}`, background: isHex6(stop.color) ? stop.color : '#000', cursor: 'ew-resize', boxSizing: 'border-box' }}
          />
        ))}
      </div>
    </div>
  );
}

// ---- enable + [lo][hi] for a scale visual range (speed/count/size) ----
function RangeRow({ label, testid, value, fallback, onToggle, onEdit, onCommit, s }: {
  label: string;
  testid: string;
  value: [number, number] | undefined;
  fallback: [number, number];
  onToggle: (v: [number, number] | undefined) => void;
  onEdit: (v: [number, number]) => void;
  onCommit: () => void;
  s: FlowStyles;
}): ReactElement {
  const on = !!value;
  const v = value ?? fallback;
  return (
    <label style={s.rowCss}>
      <span style={{ color: s.labelColor }}>{label}</span>
      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input data-testid={`flow-range-${testid}`} type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked ? fallback : undefined)} style={s.checkbox} />
        <input type="number" style={{ ...s.numField, opacity: on ? 1 : 0.4 }} value={v[0]} disabled={!on} onChange={(e) => { const n = num(e.target.value); if (n !== null) onEdit([n, v[1]]); }} onKeyDown={(e) => { if (e.key === 'Enter') onCommit(); }} onBlur={onCommit} />
        <input type="number" style={{ ...s.numField, opacity: on ? 1 : 0.4 }} value={v[1]} disabled={!on} onChange={(e) => { const n = num(e.target.value); if (n !== null) onEdit([v[0], n]); }} onKeyDown={(e) => { if (e.key === 'Enter') onCommit(); }} onBlur={onCommit} />
      </span>
    </label>
  );
}

// ---- color stops list. Rows are kept in the stored (raw) order and edited by that stable index —
//      NOT sorted for display: re-sorting on each keystroke would rebind the focused input to a
//      different stop when an `at` edit crosses a neighbor. buildRampCss/the ramp sort internally,
//      and RampStrip's handles use this same raw order, so the two surfaces agree on stop identity.
function StopsList({ scale, domain, onChange, onCommit, s }: {
  scale: FlowScale;
  domain: [number, number];
  onChange: (colors: FlowColorStop[], capture?: 'later' | 'immediately') => void;
  onCommit: () => void;
  s: FlowStyles;
}): ReactElement {
  const [min, max] = domain;
  const stops = scale.colors ?? [];
  const editAt = (i: number, at: number): void => {
    onChange(stops.map((stop, j) => (j === i ? { ...stop, at: clamp(at, min, max) } : stop)), 'later');
  };
  const editColor = (i: number, color: string): void => {
    onChange(stops.map((stop, j) => (j === i ? { ...stop, color } : stop)), 'later');
  };
  const remove = (i: number): void => { onChange(stops.filter((_, j) => j !== i), 'immediately'); };
  const add = (): void => {
    const at = +(((min + max) / 2)).toFixed(2);
    onChange([...stops, { at, color: '#2dd4bf' }], 'immediately');
  };
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ ...s.micro, marginBottom: 4 }}>Color stops</div>
      {stops.map((stop, i) => (
        <div key={i} data-testid={`flow-stop-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ color: s.accent }}>●</span>
          <input data-testid={`flow-stop-at-${i}`} type="number" style={s.numField} value={stop.at} onChange={(e) => { const n = num(e.target.value); if (n !== null) editAt(i, n); }} onKeyDown={(e) => { if (e.key === 'Enter') onCommit(); }} onBlur={onCommit} />
          <input data-testid={`flow-stop-color-${i}`} type="color" style={s.swatch} value={isHex6(stop.color) ? stop.color : '#2dd4bf'} onChange={(e) => editColor(i, e.target.value)} onBlur={onCommit} />
          <button data-testid={`flow-stop-remove-${i}`} style={s.ghostBtn} title="Remove stop" aria-label={`Remove color stop ${i + 1}`} onClick={() => remove(i)}>✕</button>
        </div>
      ))}
      <button data-testid="flow-stop-add" style={{ ...s.ghostBtn, width: '100%', marginTop: 2 }} onClick={add}>+ Add stop</button>
    </div>
  );
}

// ---- live metric scrubber: drives the REAL edge via ephemeral setFlowMetric ----
function MetricScrubber({ editor, edgeIds, firstEdge, domain, s }: {
  editor: Editor;
  edgeIds: Id[];
  firstEdge: Id;
  domain: [number, number];
  s: FlowStyles;
}): ReactElement {
  const [min, max] = domain;
  const [value, setValue] = useState<number>(() => editor.flowMetric(firstEdge) ?? (min + max) / 2);
  // resync when the selected edge changes
  useEffect(() => { setValue(editor.flowMetric(firstEdge) ?? (min + max) / 2); }, [firstEdge]); // eslint-disable-line react-hooks/exhaustive-deps
  const onInput = (v: number): void => {
    setValue(v);
    for (const id of edgeIds) editor.setFlowMetric(id, v); // ephemeral — no undo, no mark
  };
  return (
    <label style={{ ...s.rowCss, marginTop: 6 }}>
      <span style={{ color: s.labelColor }}>Metric</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
        <input data-testid="flow-metric" type="range" min={min} max={max} step={Math.abs(max - min) / 100 || 1} value={clamp(value, min, max)} onChange={(e) => onInput(Number(e.target.value))} style={s.slider} />
        <span style={{ color: s.accent, fontSize: 11, minWidth: 28, textAlign: 'right' }}>{Math.round(value)}</span>
      </span>
    </label>
  );
}
