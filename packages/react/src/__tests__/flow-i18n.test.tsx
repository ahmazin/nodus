/**
 * i18n coverage for the Flow authoring chrome (`FlowControls` + `FlowScaleEditor`). Mirrors the
 * SSR convention of `messages-override.test.tsx`: render server-side (node env, no DOM) via
 * `react-dom/server`, so a localized label / placeholder / title / aria-label appears directly in
 * the markup. Each assertion checks that the German override wins AND that the English default is
 * gone — the pair fails against the pre-i18n build where the strings were hardcoded.
 */
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Editor } from '@nodus-dev/core';
import { FlowControls } from '../flow-controls.js';
import { FlowScaleEditor } from '../flow-scale-editor.js';
import { DEFAULT_FLOW, DEFAULT_SCALE } from '../flow-shared.js';

function editorWithEdge() {
  const editor = new Editor();
  const a = editor.createNode({ type: 'rect', x: 0, y: 0 });
  const b = editor.createNode({ type: 'rect', x: 300, y: 200 });
  const edgeId = editor.connect({ kind: 'node', nodeId: a }, { kind: 'node', nodeId: b });
  return { editor, edgeId };
}

describe('FlowControls — i18n', () => {
  it('interpolates the localized heading (count token) and localizes the flow-off preview', () => {
    const { editor, edgeId } = editorWithEdge(); // no flow → preview shows the off label
    const html = renderToString(
      <FlowControls
        editor={editor}
        ids={[edgeId]}
        messages={{ flow: { heading: 'Fluss · {count} Kanten', animate: 'Animieren', off: 'Fluss aus' } }}
      />,
    );
    expect(html).toContain('Fluss · 1 Kanten'); // {count} interpolated by fmt
    expect(html).toContain('Animieren');
    expect(html).toContain('Fluss aus');
    expect(html).not.toContain('Flow · '); // English heading gone
    expect(html).not.toContain('flow off');
    expect(html).not.toContain('>Animate<');
  });

  it('localizes every basic control label, the rate placeholder, and the reset/advanced controls when flow is on', () => {
    const { editor, edgeId } = editorWithEdge();
    editor.setFlow([edgeId], DEFAULT_FLOW); // dots → Style/Speed/Size/Count/Reverse/Rate/Color all render
    const html = renderToString(
      <FlowControls
        editor={editor}
        ids={[edgeId]}
        messages={{
          flow: {
            style: 'Stil',
            speed: 'Tempo',
            size: 'Größe',
            count: 'Anzahl',
            reverse: 'Umkehren',
            rate: 'Rate-DE',
            ratePlaceholder: 'z. B. 350 Anf/s',
            color: 'Farbe',
            resetColorTitle: 'Auf Kantenstrich zurücksetzen',
            reset: 'zurück',
            advanced: 'Erweitert · datengesteuert',
          },
        }}
      />,
    );
    expect(html).toContain('Stil');
    expect(html).toContain('Tempo');
    expect(html).toContain('Anzahl');
    expect(html).toContain('Umkehren');
    expect(html).toContain('z. B. 350 Anf/s'); // placeholder attribute
    expect(html).toContain('Auf Kantenstrich zurücksetzen'); // title attribute
    expect(html).toContain('zurück');
    expect(html).toContain('Erweitert · datengesteuert');
    expect(html).not.toContain('e.g. 350 req/s');
    expect(html).not.toContain('Reset to edge stroke');
    expect(html).not.toContain('Advanced · data-driven');
    // enum <option> values are NOT localized
    expect(html).toContain('>dots<');
    expect(html).toContain('>dash<');
  });
});

describe('FlowScaleEditor — i18n', () => {
  it('localizes the stops heading, add/remove controls (incl. the {n} aria token), metric, and range labels', () => {
    const { editor, edgeId } = editorWithEdge();
    editor.setFlow([edgeId], { ...DEFAULT_FLOW, scale: DEFAULT_SCALE }); // data-driven on
    const html = renderToString(
      <FlowScaleEditor
        editor={editor}
        edgeIds={[edgeId]}
        firstEdge={edgeId}
        messages={{
          flow: {
            colorStops: 'Farbstopps',
            addStop: '+ Stopp',
            removeStop: 'Stopp entfernen',
            removeStopN: 'Farbstopp {n} entfernen',
            metric: 'Metrik',
            speed: 'Tempo',
            count: 'Anzahl',
            size: 'Größe',
          },
        }}
      />,
    );
    expect(html).toContain('Farbstopps');
    expect(html).toContain('+ Stopp');
    expect(html).toContain('Stopp entfernen'); // title
    expect(html).toContain('Farbstopp 1 entfernen'); // aria-label, {n} interpolated
    expect(html).toContain('Metrik');
    // RangeRow labels routed through flow.speed/count/size
    expect(html).toContain('Tempo');
    expect(html).toContain('Anzahl');
    expect(html).toContain('Größe');
    expect(html).not.toContain('Color stops');
    expect(html).not.toContain('+ Add stop');
    expect(html).not.toContain('Remove color stop 1');
    expect(html).not.toContain('>Metric<');
  });
});
