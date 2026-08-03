/**
 * Pins for the react half of the audit-closure polish (task #50): palette namespacing surface and
 * the injectStyles opt-out prop. The injectStyles=false BEHAVIOR is DOM-only (covered by typecheck
 * here and the browser suite); these tests pin the public contract shapes.
 */
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Editor } from '@nodus-dev/core';
import { CommandPalette, Nodus, OPEN_COMMAND_PALETTE_EVENT } from '@nodus-dev/react';

describe('F40 — command palette is namespaceable', () => {
  it('exports the open-event name as a constant', () => {
    expect(OPEN_COMMAND_PALETTE_EVENT).toBe('nodus:open-command-palette');
  });

  it('accepts per-instance storageKey and openEventName props (SSR-safe)', () => {
    const editor = new Editor();
    expect(() =>
      renderToString(
        <CommandPalette editor={editor} storageKey="doc-a:recents" openEventName="doc-a:open-palette" />,
      ),
    ).not.toThrow();
    editor.dispose();
  });
});

describe('F12 — injectStyles opt-out prop', () => {
  it('<Nodus injectStyles={false}> renders (SSR) without style side effects', () => {
    const editor = new Editor();
    expect(() => renderToString(<Nodus editor={editor} injectStyles={false} />)).not.toThrow();
    editor.dispose();
  });
});
