/**
 * PRR wave E2 (react): i18n threading, a11y host regions, context-menu extensibility, and the
 * NaN-free edge-label editor. Rendered server-side (node env, no DOM) via `react-dom/server`, matching
 * the existing SSR test convention — attributes and text content both appear in the markup, so a
 * localized string / aria wiring / custom menu item is directly assertable, and a broken edge overlay
 * shows up as `NaN` in the inline style.
 */
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Editor } from '@nodus-dev/core';
import {
  BranchBar,
  CodePanel,
  FlowControls,
  LayersPanel,
  MessagesProvider,
  NodusContextMenu,
  Nodus,
  Properties,
  ZoomControls,
  defaultReactMessages,
} from '@nodus-dev/react';

describe('i18n — per-panel `messages` override', () => {
  it('LayersPanel renders overridden title + empty-state strings (and not the English defaults)', () => {
    const html = renderToString(
      <LayersPanel editor={new Editor()} messages={{ layers: { title: 'Ebenen', empty: 'Keine Objekte' } }} />,
    );
    expect(html).toContain('Ebenen');
    expect(html).toContain('Keine Objekte');
    expect(html).not.toContain('No objects yet');
    // untouched keys keep the English default
    expect(html).not.toContain('>Layers<');
  });

  it('resolves through <MessagesProvider> when no per-panel prop is given', () => {
    const html = renderToString(
      <MessagesProvider messages={{ layers: { empty: 'Keine Objekte' } }}>
        <LayersPanel editor={new Editor()} />
      </MessagesProvider>,
    );
    expect(html).toContain('Keine Objekte');
  });

  it('a per-panel prop wins over the provider (most-specific override)', () => {
    const html = renderToString(
      <MessagesProvider messages={{ layers: { empty: 'from-provider' } }}>
        <LayersPanel editor={new Editor()} messages={{ layers: { empty: 'from-prop' } }} />
      </MessagesProvider>,
    );
    expect(html).toContain('from-prop');
    expect(html).not.toContain('from-provider');
  });
});

describe('defaultReactMessages — the localizable surface', () => {
  it('exposes the shared host.selectionAnnounce key with its interpolation tokens', () => {
    expect(defaultReactMessages.host.selectionAnnounce).toContain('{label}');
    expect(defaultReactMessages.host.selectionAnnounce).toContain('{i}');
    expect(defaultReactMessages.host.selectionAnnounce).toContain('{n}');
    expect(defaultReactMessages.host.selectionMulti).toContain('{count}');
  });
});

describe('context menu — custom items / extendItems (P1g)', () => {
  it('items replaces the built-in list entirely', () => {
    const html = renderToString(
      <NodusContextMenu
        editor={new Editor()}
        x={0}
        y={0}
        target={null}
        onClose={() => {}}
        items={[{ label: 'Teleport', run: () => {} }]}
      />,
    );
    expect(html).toContain('Teleport');
    expect(html).not.toContain('Select all'); // a default canvas item that must be gone
  });

  it('extendItems appends to the built-in list', () => {
    const html = renderToString(
      <NodusContextMenu
        editor={new Editor()}
        x={0}
        y={0}
        target={null}
        onClose={() => {}}
        extendItems={(_e, _t, defaults) => [...defaults, { label: 'Diagnostics', run: () => {} }]}
      />,
    );
    expect(html).toContain('Diagnostics'); // custom
    expect(html).toContain('Select all'); // default preserved
  });

  it('localizes the menu aria-label', () => {
    const html = renderToString(
      <NodusContextMenu editor={new Editor()} x={0} y={0} target={null} onClose={() => {}} messages={{ contextMenu: { actions: 'Aktionen' } }} />,
    );
    expect(html).toContain('Aktionen');
  });
});

describe('host a11y wiring (P1b/P1e)', () => {
  it('canvas aria-label documents the Escape exit and an aria-live selection region exists', () => {
    const html = renderToString(<Nodus editor={new Editor()} />);
    expect(html).toContain('Escape'); // WCAG 2.1.2 exit documented on the host label
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('nodus-selection-live');
  });

  it('localizes the canvas aria-label', () => {
    const html = renderToString(<Nodus editor={new Editor()} messages={{ host: { canvasLabel: 'Zeichenfläche' } }} />);
    expect(html).toContain('Zeichenfläche');
  });
});

describe('edge-label editor is finitely positioned, not NaN (P1c)', () => {
  function editorWithEdge() {
    const editor = new Editor();
    const a = editor.createNode({ type: 'rect', x: 0, y: 0 });
    const b = editor.createNode({ type: 'rect', x: 300, y: 200 });
    const edgeId = editor.connect({ kind: 'node', nodeId: a }, { kind: 'node', nodeId: b });
    return { editor, edgeId };
  }

  it('renders a finitely-positioned textarea (no NaN in the inline style) for an edge label', () => {
    const { editor, edgeId } = editorWithEdge();
    editor.beginEdit(edgeId);
    const html = renderToString(<Nodus editor={editor} />);
    expect(html).toContain('<textarea');
    expect(html).not.toContain('NaN');
    // the inline editor carries a localizable aria-label
    expect(html).toContain(defaultReactMessages.host.editLabel);
  });
});

// ---------------------------------------------------------------------------
// Wave-1 panel-wiring verification: each panel below reads its visible strings
// through `useMessages`, so a `messages` override that changes a key MUST show
// up in the SSR markup. Every assertion here would FAIL if the panel still held
// a hardcoded literal — that is the whole point of these cases.
// ---------------------------------------------------------------------------

describe('i18n wiring is LIVE — properties panel', () => {
  function editorWithSelectedNode() {
    const editor = new Editor();
    const id = editor.createNode({ type: 'rect', x: 0, y: 0 });
    editor.select([id]); // the panel returns null with an empty selection
    return editor;
  }

  it('renders overridden region + section labels through the properties namespace', () => {
    const html = renderToString(
      <Properties
        editor={editorWithSelectedNode()}
        messages={{ properties: { regionLabel: 'Stil-Inspektor', fill: 'Füllung', stroke: 'Kontur' } }}
      />,
    );
    expect(html).toContain('Stil-Inspektor'); // aria-label on the region
    expect(html).toContain('Füllung'); // Fill section heading
    expect(html).toContain('Kontur'); // Stroke section heading
    // the English defaults are gone — proving the labels are not hardcoded
    expect(html).not.toContain('Element style properties');
    expect(html).not.toContain('>Fill<');
  });

  it('renders overridden action-button labels', () => {
    const html = renderToString(
      <Properties
        editor={editorWithSelectedNode()}
        messages={{ properties: { actionDelete: 'Löschen', actionDuplicate: 'Duplizieren' } }}
      />,
    );
    expect(html).toContain('Löschen');
    expect(html).toContain('Duplizieren');
    expect(html).not.toContain('aria-label="Delete"');
  });
});

describe('i18n wiring is LIVE — flow controls', () => {
  function editorWithEdgeSelected() {
    const editor = new Editor();
    const a = editor.createNode({ type: 'rect', x: 0, y: 0 });
    const b = editor.createNode({ type: 'rect', x: 300, y: 200 });
    const edgeId = editor.connect({ kind: 'node', nodeId: a }, { kind: 'node', nodeId: b });
    return { editor, edgeId };
  }

  it('renders the overridden flow heading + animate toggle + off-state labels', () => {
    const { editor, edgeId } = editorWithEdgeSelected();
    const html = renderToString(
      <FlowControls
        editor={editor}
        ids={[edgeId]}
        messages={{ flow: { heading: 'Datenfluss · {count} Kanten', animate: 'Animieren', off: 'Fluss aus' } }}
      />,
    );
    expect(html).toContain('Datenfluss'); // heading (fmt-interpolated) is not hardcoded
    expect(html).toContain('Kanten');
    expect(html).toContain('Animieren'); // animate row label
    expect(html).toContain('Fluss aus'); // off-state preview label (flow starts disabled)
    expect(html).not.toContain('Animate'); // English default label is gone
  });
});

describe('i18n wiring is LIVE — review / branch bar', () => {
  it('renders overridden branch-bar button labels through the review namespace', () => {
    const html = renderToString(
      <BranchBar
        editor={new Editor()}
        messages={{ review: { saveVersion: 'Version sichern', history: 'Verlauf', review: 'Prüfen' } }}
      />,
    );
    expect(html).toContain('Version sichern'); // Save-version button
    expect(html).toContain('Verlauf'); // History button
    expect(html).toContain('Prüfen'); // Review button
    // English defaults are gone — the labels flow through messages, not literals
    expect(html).not.toContain('Save version');
    expect(html).not.toContain('>History<');
  });
});

describe('i18n wiring is LIVE — code panel', () => {
  it('renders overridden title + region + synced-status strings', () => {
    const html = renderToString(
      <CodePanel
        editor={new Editor()}
        messages={{ codePanel: { title: 'Quelle', regionLabel: 'Dokumentquelle (JSON)', statusSynced: 'Abgeglichen' } }}
      />,
    );
    expect(html).toContain('Quelle'); // header/tab title
    expect(html).toContain('Dokumentquelle (JSON)'); // region aria-label
    expect(html).toContain('Abgeglichen'); // synced status pill (initial state)
    // English defaults are gone
    expect(html).not.toContain('>Source<');
    expect(html).not.toContain('>Synced<');
  });
});

describe('i18n wiring is LIVE — ui/shell (zoom controls)', () => {
  it('renders overridden zoom group + button labels through the zoom namespace', () => {
    const html = renderToString(
      <ZoomControls
        editor={new Editor()}
        messages={{ zoom: { groupLabel: 'Zoomen', out: 'Verkleinern', in: 'Vergrößern', fit: 'Einpassen' } }}
      />,
    );
    expect(html).toContain('aria-label="Zoomen"'); // group aria-label
    expect(html).toContain('Verkleinern'); // zoom-out aria-label/title
    expect(html).toContain('Vergrößern'); // zoom-in aria-label/title
    expect(html).toContain('Einpassen'); // fit-to-content aria-label/title
    // English defaults are gone
    expect(html).not.toContain('Zoom out');
    expect(html).not.toContain('aria-label="Zoom"');
  });
});
