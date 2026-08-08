/**
 * PRR i18n (react shell chrome): the built-in shell controls — zoom, undo/redo, theme toggle, tool
 * palette, toolbar, and the shortcuts button — route every user-facing literal through the
 * `ReactMessages` table. Rendered server-side (node env, no DOM) via `react-dom/server`, matching the
 * existing SSR test convention: a `messages` override must surface in the markup (aria-label / title /
 * visible text) and the English default must be gone. `fmt` interpolation is asserted through the
 * zoom-reset label's `{pct}` token.
 *
 * Note: `ShortcutsDialog`'s *dialog body* renders through `createPortal` and bails when
 * `typeof document === 'undefined'`, so it is not reachable under the node environment; its `?`-button
 * trigger (`ShortcutsButton`) is, and is covered here.
 */
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Editor, defaultTheme, lightTheme } from '@nodus-dev/core';
import {
  ZoomControls,
  UndoRedo,
  ThemeToggle,
  ToolPalette,
  Toolbar,
  ShortcutsButton,
} from '@nodus-dev/react';

describe('i18n — shell chrome `messages` override', () => {
  it('ZoomControls localizes group/out/in/fit/reset labels and interpolates {pct} via fmt', () => {
    const html = renderToString(
      <ZoomControls
        editor={new Editor()}
        messages={{
          zoom: {
            groupLabel: 'Zoomen',
            out: 'Raus',
            in: 'Rein',
            fit: 'Einpassen',
            resetLabel: 'Zoom {pct}% zurücksetzen',
            resetTitle: 'Auf 100% zurücksetzen',
          },
        }}
      />,
    );
    expect(html).toContain('Zoomen');
    expect(html).toContain('Raus');
    expect(html).toContain('Rein');
    expect(html).toContain('Einpassen');
    expect(html).toContain('Auf 100% zurücksetzen');
    // {pct} interpolated at the default zoom (z=1 → 100%), and the English template is gone.
    expect(html).toContain('Zoom 100% zurücksetzen');
    expect(html).not.toContain('reset to 100%');
    expect(html).not.toContain('Fit to content');
  });

  it('UndoRedo localizes the group, button labels, and shortcut titles', () => {
    const html = renderToString(
      <UndoRedo
        editor={new Editor()}
        messages={{
          history: {
            groupLabel: 'Verlauf',
            undo: 'Rückgängig',
            undoTitle: 'Rückgängig (⌘Z)',
            redo: 'Wiederholen',
            redoTitle: 'Wiederholen (⇧⌘Z)',
          },
        }}
      />,
    );
    expect(html).toContain('Verlauf');
    expect(html).toContain('Rückgängig');
    expect(html).toContain('Wiederholen');
    expect(html).not.toContain('aria-label="Undo"');
    expect(html).not.toContain('aria-label="History"');
  });

  it('ThemeToggle localizes the dark-mode (switch-to-light) aria-label + title', () => {
    // A fresh Editor uses the dark `defaultTheme`, so the toggle offers "switch to light".
    const html = renderToString(
      <ThemeToggle
        editor={new Editor()}
        light={lightTheme}
        dark={defaultTheme}
        messages={{ theme: { toLight: 'Zu hellem Design', lightTitle: 'Helles Design' } }}
      />,
    );
    expect(html).toContain('Zu hellem Design');
    expect(html).toContain('Helles Design');
    expect(html).not.toContain('Switch to light theme');
    expect(html).not.toContain('>Light theme<');
    expect(html).not.toContain('title="Light theme"');
  });

  it('ToolPalette falls back to the localized default label when no aria-label prop is given', () => {
    const html = renderToString(
      <ToolPalette editor={new Editor()} tools={[]} messages={{ toolPalette: { label: 'Werkzeuge' } }} />,
    );
    expect(html).toContain('aria-label="Werkzeuge"');
    expect(html).not.toContain('aria-label="Tools"');
  });

  it('ToolPalette aria-label prop still wins over the localized default', () => {
    const html = renderToString(
      <ToolPalette
        editor={new Editor()}
        tools={[]}
        aria-label="Explicit palette"
        messages={{ toolPalette: { label: 'Werkzeuge' } }}
      />,
    );
    expect(html).toContain('aria-label="Explicit palette"');
    expect(html).not.toContain('Werkzeuge');
  });

  it('Toolbar falls back to the localized default landmark name', () => {
    const html = renderToString(
      <Toolbar editor={new Editor()} messages={{ toolbar: { label: 'Hauptwerkzeugleiste' } }}>
        <span>child</span>
      </Toolbar>,
    );
    expect(html).toContain('aria-label="Hauptwerkzeugleiste"');
    expect(html).not.toContain('Main toolbar');
  });

  it('ShortcutsButton localizes the trigger aria-label + title', () => {
    const html = renderToString(
      <ShortcutsButton
        editor={new Editor()}
        messages={{ shortcuts: { buttonLabel: 'Tastenkürzel', buttonTitle: 'Tastenkürzel (?)' } }}
      />,
    );
    expect(html).toContain('Tastenkürzel');
    expect(html).not.toContain('aria-label="Keyboard shortcuts"');
    expect(html).not.toContain('title="Keyboard shortcuts (?)"');
  });
});
