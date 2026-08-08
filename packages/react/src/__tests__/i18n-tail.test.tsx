/**
 * PRR i18n sweep — the small tail. Six user-facing strings that stayed hardcoded only because their
 * message keys did not exist yet (messages.tsx was a frozen contract during the parallel panel
 * fan-out) are now wired through `useMessages`. These tests lock that wiring the same way the sibling
 * suite (messages-override.test.tsx) does: render server-side (node env, no DOM) via
 * `react-dom/server` with a per-panel `messages` override and assert the overridden text shows up in
 * the markup while the English default is gone — an assertion that FAILS if the panel still holds the
 * literal.
 *
 * Two of the six strings have no server-rendered surface and are locked at the message-table level
 * instead (documented inline where they appear):
 *   - `cloudIcons.footerHelp` renders only inside the picker popover, which is gated by internal
 *     `open` state with no prop to force it — unreachable in one-shot SSR (same limitation as a
 *     portal child). Its sibling `stencils.footerHelp` is likewise not render-tested for this reason.
 *   - `stencils.namePrompt` / `stencils.nameDefault` are `window.prompt` arguments — a browser-only
 *     side effect, never present in rendered markup and not driven in the node test env.
 */
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Editor, type FlowScale } from '@nodus-dev/core';
import { FlowScaleEditor, Properties, defaultReactMessages } from '@nodus-dev/react';

describe('i18n tail is LIVE — properties clear-style button', () => {
  function editorWithSelectedNode(): Editor {
    const editor = new Editor();
    const id = editor.createNode({ type: 'rect', x: 0, y: 0 });
    editor.select([id]); // the panel returns null with an empty selection
    return editor;
  }

  it('renders the overridden clear-style label (and not the English default)', () => {
    const html = renderToString(
      <Properties
        editor={editorWithSelectedNode()}
        messages={{ properties: { clearStyle: 'Stil zurücksetzen' } }}
      />,
    );
    expect(html).toContain('Stil zurücksetzen');
    expect(html).not.toContain('Clear style'); // the literal is gone — proves it flows through messages
  });
});

describe('i18n tail is LIVE — flow scale editor (data-driven / domain / gradient)', () => {
  function editorWithScaledEdge() {
    const editor = new Editor();
    const a = editor.createNode({ type: 'rect', x: 0, y: 0 });
    const b = editor.createNode({ type: 'rect', x: 300, y: 200 });
    const edgeId = editor.connect({ kind: 'node', nodeId: a }, { kind: 'node', nodeId: b });
    // Turn on data-driven mode so the Domain + Gradient rows (gated on `scale`) render too.
    const scale: FlowScale = { domain: [0, 100], colors: [{ at: 0, color: '#22c55e' }, { at: 60, color: '#f59e0b' }] };
    editor.setFlow([edgeId], { scale });
    return { editor, edgeId };
  }

  it('renders the three overridden row labels (and not their English defaults)', () => {
    const { editor, edgeId } = editorWithScaledEdge();
    const html = renderToString(
      <FlowScaleEditor
        editor={editor}
        edgeIds={[edgeId]}
        firstEdge={edgeId}
        messages={{ flow: { dataDriven: 'Datengesteuert', domain: 'Bereich', gradient: 'Farbverlauf' } }}
      />,
    );
    expect(html).toContain('Datengesteuert'); // Data-driven row
    expect(html).toContain('Bereich'); // Domain row (gated on data-driven)
    expect(html).toContain('Farbverlauf'); // Gradient row (gated on data-driven)
    // English defaults gone — the labels are not hardcoded. ('Gradient' with a capital G would only
    // appear as a literal label; CSS `linear-gradient` in the ramp background is lowercase.)
    expect(html).not.toContain('Data-driven');
    expect(html).not.toContain('Domain');
    expect(html).not.toContain('Gradient');
  });
});

describe('i18n tail — message-table lock for strings without a server-rendered surface', () => {
  // cloudIcons.footerHelp renders only inside the (state-gated) picker popover — not reachable in
  // one-shot SSR. Lock the key + its interpolation tokens at the table level; behavioral wiring is
  // exercised by the browser-verify pass.
  it('exposes cloudIcons.footerHelp with its {count}/{total} tokens', () => {
    expect(defaultReactMessages.cloudIcons.footerHelp).toContain('{count}');
    expect(defaultReactMessages.cloudIcons.footerHelp).toContain('{total}');
    expect(defaultReactMessages.cloudIcons.footerHelp).toContain('drag to place');
  });

  // stencils.namePrompt / nameDefault are `window.prompt` arguments — never rendered. Lock the values.
  it('exposes the stencil save-prompt strings', () => {
    expect(defaultReactMessages.stencils.namePrompt).toBe('Name this stencil');
    expect(defaultReactMessages.stencils.nameDefault).toBe('My stencil');
  });
});
