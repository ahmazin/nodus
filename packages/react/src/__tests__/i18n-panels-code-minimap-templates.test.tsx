/**
 * i18n threading for the CodePanel / Minimap / TemplatesGallery chrome (PRR P3). Same SSR-render
 * convention as `messages-override.test.tsx` (node env, no DOM) via `react-dom/server`: a per-panel
 * `messages` override must surface localized strings in the markup and the English defaults must be
 * gone. Each assertion fails against the pre-i18n components, which hardcoded the English literals
 * and did not accept a `messages` prop.
 */
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Editor, fmt } from '@nodus-dev/core';
import type { Template } from '@nodus-dev/stencils';
import { CodePanel, Minimap, TemplatesGallery, defaultReactMessages } from '@nodus-dev/react';

describe('i18n — CodePanel `messages` override', () => {
  it('localizes the region label, heading, editor label and the synced status pill', () => {
    const html = renderToString(
      <CodePanel
        editor={new Editor()}
        messages={{
          codePanel: {
            regionLabel: 'Dokumentquelle',
            title: 'Quelle',
            editorLabel: 'Bearbeitbares JSON',
            statusSynced: 'Sync-OK',
          },
        }}
      />,
    );
    expect(html).toContain('Dokumentquelle');
    expect(html).toContain('>Quelle<'); // the heading span
    expect(html).toContain('Bearbeitbares JSON');
    expect(html).toContain('Sync-OK'); // default sync status on mount
    // English defaults are gone
    expect(html).not.toContain('Document source (JSON)');
    expect(html).not.toContain('>Source<');
    expect(html).not.toContain('Editable document JSON');
    expect(html).not.toContain('>Synced<');
  });

  it('exposes the parse-error keys with their {line} interpolation token', () => {
    // Locks the interpolated error-pill string the component feeds through `fmt`.
    expect(defaultReactMessages.codePanel.parseErrorLine).toContain('{line}');
    expect(fmt(defaultReactMessages.codePanel.parseErrorLine, { line: 7 })).toContain('7');
  });
});

describe('i18n — Minimap `messages` override', () => {
  it('localizes the aria-label', () => {
    const html = renderToString(
      <Minimap editor={new Editor()} messages={{ minimap: { label: 'Übersichtskarte' } }} />,
    );
    expect(html).toContain('Übersichtskarte');
    expect(html).not.toContain('Minimap — drag to pan the viewport');
  });
});

describe('i18n — TemplatesGallery `messages` override', () => {
  const blankTemplate: Template = {
    id: 'blank',
    name: 'Blank',
    snapshot: { schemaVersion: 1, document: { records: [] } },
  };

  it('localizes the empty-state when no templates are registered', () => {
    const html = renderToString(
      <TemplatesGallery editor={new Editor()} templates={[]} messages={{ templates: { empty: 'Keine Vorlagen' } }} />,
    );
    expect(html).toContain('Keine Vorlagen');
    expect(html).not.toContain('No templates available');
  });

  it('localizes the blank-canvas placeholder on an empty-snapshot template card', () => {
    const html = renderToString(
      <TemplatesGallery
        editor={new Editor()}
        templates={[blankTemplate]}
        messages={{ templates: { blank: 'Leere Leinwand' } }}
      />,
    );
    expect(html).toContain('Leere Leinwand');
    expect(html).not.toContain('Blank canvas');
  });
});
