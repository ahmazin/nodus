/**
 * C6/F40 — component conventions: every panel accepts `className` + `style` and applies them to its
 * root (style spread LAST so callers win), and the barrel re-exports the canvas-registry helpers.
 * Rendered server-side (node env, no DOM) via react-dom/server.
 *
 * CommandPalette (closed) and FlowControls (no flow edges) render `null` in their default SSR state,
 * so their className/style can't be asserted from markup here — that path is covered by the browser
 * suite; below we assert their prop plumbing type-checks and renders without throwing.
 */
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Editor } from '@ahmazin/core';
import { Nodus, LayersPanel, NodusContextMenu, CommandPalette, FlowControls, getCanvas, registerCanvas } from '@ahmazin/react';

const CLS = 'probe-classname-xyz';
const STYLE = { zIndex: 424242 } as const; // distinctive, unitless → serializes as `z-index:424242`

describe('C6 conventions — className + style land on rendered panels', () => {
  it('Nodus applies className and style to its host', () => {
    const html = renderToString(<Nodus editor={new Editor()} className={CLS} style={STYLE} />);
    expect(html).toContain(CLS);
    expect(html).toContain('z-index:424242');
  });

  it('LayersPanel applies className and style', () => {
    const html = renderToString(<LayersPanel editor={new Editor()} className={CLS} style={STYLE} />);
    expect(html).toContain(CLS);
    expect(html).toContain('z-index:424242');
  });

  it('NodusContextMenu applies className and style', () => {
    const html = renderToString(
      <NodusContextMenu editor={new Editor()} x={10} y={20} target={null} onClose={() => {}} className={CLS} style={STYLE} />,
    );
    expect(html).toContain(CLS);
    expect(html).toContain('z-index:424242');
  });

  it('CommandPalette and FlowControls accept className/style without throwing', () => {
    expect(() => renderToString(<CommandPalette editor={new Editor()} className={CLS} style={STYLE} />)).not.toThrow();
    expect(() => renderToString(<FlowControls editor={new Editor()} ids={[]} className={CLS} style={STYLE} />)).not.toThrow();
  });
});

describe('C6 conventions — barrel surface', () => {
  it('re-exports the canvas-registry helpers', () => {
    expect(typeof getCanvas).toBe('function');
    expect(typeof registerCanvas).toBe('function');
  });
});
