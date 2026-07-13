/** Data-driven flow scale authoring: the color-stop ramp (draggable handles), Domain, the three
 *  visual ranges, Gradient, the stops list, and the live metric scrubber. */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { Editor, EdgeRecord, FlowColorStop, FlowScale, FlowSpec, Id } from '@nodus/core';
import { BORDER, buildRampCss, DEFAULT_SCALE, FLOW, flowMicro, flowRowCss, ghostBtn, numField, ROW_LABEL, swatch } from './flow-shared.js';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const isHex6 = (c: string): boolean => /^#[0-9a-f]{6}$/i.test(c);

export interface FlowScaleEditorProps {
  editor: Editor;
  edgeIds: Id[];
  firstEdge: Id;
}

export function FlowScaleEditor({ editor, edgeIds, firstEdge }: FlowScaleEditorProps): ReactElement {
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
    <label style={flowRowCss}>
      <span style={{ color: ROW_LABEL }}>{label}</span>
      {control}
    </label>
  );

  const dataOn = !!scale;
  const domain: [number, number] = scale?.domain ?? DEFAULT_SCALE.domain;

  return (
    <div style={{ marginTop: 4 }}>
      {row(
        'Data-driven',
        <input data-testid="flow-datadriven" type="checkbox" checked={dataOn} onChange={(e) => writeScale(e.target.checked ? DEFAULT_SCALE : undefined, 'immediately')} />,
      )}

      {dataOn && scale && (
        <>
          <RampStrip scale={scale} onDrag={patchScale} onCommit={commit} />

          {row(
            'Domain',
            <span style={{ display: 'flex', gap: 6 }}>
              <input data-testid="flow-domain-min" type="number" style={numField} value={domain[0]} onChange={(e) => patchScale({ domain: [Number(e.target.value), domain[1]] })} onBlur={commit} />
              <input data-testid="flow-domain-max" type="number" style={numField} value={domain[1]} onChange={(e) => patchScale({ domain: [domain[0], Number(e.target.value)] })} onBlur={commit} />
            </span>,
          )}

          <RangeRow label="Speed range" testid="speed" value={scale.speed} fallback={[40, 120]} onToggle={(v) => patchScale({ speed: v }, 'immediately')} onEdit={(v) => patchScale({ speed: v })} onCommit={commit} />
          <RangeRow label="Count range" testid="count" value={scale.count} fallback={[2, 16]} onToggle={(v) => patchScale({ count: v }, 'immediately')} onEdit={(v) => patchScale({ count: v })} onCommit={commit} />
          <RangeRow label="Size range" testid="size" value={scale.size} fallback={[2, 6]} onToggle={(v) => patchScale({ size: v }, 'immediately')} onEdit={(v) => patchScale({ size: v })} onCommit={commit} />

          {row(
            'Gradient',
            <input data-testid="flow-gradient" type="checkbox" checked={!!scale.gradient} onChange={(e) => patchScale({ gradient: e.target.checked }, 'immediately')} />,
          )}

          <StopsList scale={scale} domain={domain} onChange={(colors, capture) => patchScale({ colors }, capture)} onCommit={commit} />

          <MetricScrubber editor={editor} edgeIds={edgeIds} firstEdge={firstEdge} domain={domain} />
        </>
      )}
    </div>
  );
}

// ---- the color-stop ramp with draggable handles (signature, data-driven mode) ----
function RampStrip({ scale, onDrag, onCommit }: {
  scale: FlowScale;
  onDrag: (p: Partial<FlowScale>, capture?: 'later' | 'immediately') => void;
  onCommit: () => void;
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
      const next = stops.map((s, i) => (i === dragIdx ? { ...s, at } : s));
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
        style={{ position: 'relative', width: '100%', height: 24, borderRadius: 6, border: `1px solid ${BORDER}`, background: buildRampCss(stops, scale.domain, scale.gradient) }}
      >
        {stops.map((s, i) => (
          <span
            key={i}
            data-testid={`flow-ramp-handle-${i}`}
            onPointerDown={(e) => { e.preventDefault(); setDragIdx(i); }}
            title={`${s.at}`}
            style={{ position: 'absolute', top: -3, left: `${pos(s.at)}%`, width: 10, height: 30, transform: 'translateX(-50%)', borderRadius: 3, border: `1.5px solid ${FLOW}`, background: isHex6(s.color) ? s.color : '#000', cursor: 'ew-resize', boxSizing: 'border-box' }}
          />
        ))}
      </div>
    </div>
  );
}

// ---- enable + [lo][hi] for a scale visual range (speed/count/size) ----
function RangeRow({ label, testid, value, fallback, onToggle, onEdit, onCommit }: {
  label: string;
  testid: string;
  value: [number, number] | undefined;
  fallback: [number, number];
  onToggle: (v: [number, number] | undefined) => void;
  onEdit: (v: [number, number]) => void;
  onCommit: () => void;
}): ReactElement {
  const on = !!value;
  const v = value ?? fallback;
  return (
    <label style={flowRowCss}>
      <span style={{ color: ROW_LABEL }}>{label}</span>
      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input data-testid={`flow-range-${testid}`} type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked ? fallback : undefined)} />
        <input type="number" style={{ ...numField, opacity: on ? 1 : 0.4 }} value={v[0]} disabled={!on} onChange={(e) => onEdit([Number(e.target.value), v[1]])} onBlur={onCommit} />
        <input type="number" style={{ ...numField, opacity: on ? 1 : 0.4 }} value={v[1]} disabled={!on} onChange={(e) => onEdit([v[0], Number(e.target.value)])} onBlur={onCommit} />
      </span>
    </label>
  );
}

// ---- color stops list (sorted by at; add / edit at / edit color / remove) ----
function StopsList({ scale, domain, onChange, onCommit }: {
  scale: FlowScale;
  domain: [number, number];
  onChange: (colors: FlowColorStop[], capture?: 'later' | 'immediately') => void;
  onCommit: () => void;
}): ReactElement {
  const [min, max] = domain;
  const stops = [...(scale.colors ?? [])].sort((a, b) => a.at - b.at);
  const editAt = (i: number, at: number): void => {
    onChange(stops.map((s, j) => (j === i ? { ...s, at: clamp(at, min, max) } : s)), 'later');
  };
  const editColor = (i: number, color: string): void => {
    onChange(stops.map((s, j) => (j === i ? { ...s, color } : s)), 'later');
  };
  const remove = (i: number): void => { onChange(stops.filter((_, j) => j !== i), 'immediately'); };
  const add = (): void => {
    const at = +(((min + max) / 2)).toFixed(2);
    onChange([...stops, { at, color: '#2dd4bf' }], 'immediately');
  };
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ ...flowMicro, marginBottom: 4 }}>Color stops</div>
      {stops.map((s, i) => (
        <div key={i} data-testid={`flow-stop-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ color: FLOW }}>●</span>
          <input data-testid={`flow-stop-at-${i}`} type="number" style={numField} value={s.at} onChange={(e) => editAt(i, Number(e.target.value))} onBlur={onCommit} />
          <input data-testid={`flow-stop-color-${i}`} type="color" style={swatch} value={isHex6(s.color) ? s.color : '#2dd4bf'} onChange={(e) => editColor(i, e.target.value)} onBlur={onCommit} />
          <button data-testid={`flow-stop-remove-${i}`} style={ghostBtn} title="Remove stop" onClick={() => remove(i)}>✕</button>
        </div>
      ))}
      <button data-testid="flow-stop-add" style={{ ...ghostBtn, width: '100%', marginTop: 2 }} onClick={add}>+ Add stop</button>
    </div>
  );
}

// ---- live metric scrubber: drives the REAL edge via ephemeral setFlowMetric ----
function MetricScrubber({ editor, edgeIds, firstEdge, domain }: {
  editor: Editor;
  edgeIds: Id[];
  firstEdge: Id;
  domain: [number, number];
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
    <label style={{ ...flowRowCss, marginTop: 6 }}>
      <span style={{ color: ROW_LABEL }}>Metric</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input data-testid="flow-metric" type="range" min={min} max={max} step={Math.abs(max - min) / 100 || 1} value={clamp(value, min, max)} onChange={(e) => onInput(Number(e.target.value))} />
        <span style={{ color: FLOW, fontSize: 11, minWidth: 28, textAlign: 'right' }}>{Math.round(value)}</span>
      </span>
    </label>
  );
}
