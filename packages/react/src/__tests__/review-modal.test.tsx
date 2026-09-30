/**
 * i18n threading for the git-review chrome (`BranchBar` + `ReviewModal` + `HistoryModal`).
 *
 * `BranchBar` renders server-side (node env, no DOM) via `react-dom/server`, matching the existing
 * `messages-override` convention: the branch chip, the Save version / History / Review buttons and
 * their `title` tooltips all appear in the markup, so a localized `review` override is directly
 * assertable — and these strings are hardcoded English without the threading, so this test fails
 * without it. (The two modals are DOM-portalled and render `null` under node; their strings are wired
 * through the same `useMessages(editor, messages).review` resolution and exercised by browser-verify.)
 */
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Editor } from '@nodus-dev/core';
import { BranchBar } from '@nodus-dev/react';

describe('i18n — review chrome `messages` override (BranchBar)', () => {
  it('renders overridden `review` strings (labels + tooltips), not the English defaults', () => {
    const html = renderToString(
      <BranchBar
        editor={new Editor()}
        messages={{
          review: {
            branchChipTitle: 'In-Memory-Hauptzweig',
            saveVersion: 'Version speichern',
            saveVersionTitle: 'Aktuelles Dokument als Version speichern',
            history: 'Verlauf',
            historyTitle: 'Gespeicherte Versionen durchsuchen',
            review: 'Prüfen',
          },
        }}
      />,
    );
    // overridden button labels + tooltip (`title`) strings are in the markup
    expect(html).toContain('In-Memory-Hauptzweig');
    expect(html).toContain('Version speichern');
    expect(html).toContain('Aktuelles Dokument als Version speichern');
    expect(html).toContain('Verlauf');
    expect(html).toContain('Gespeicherte Versionen durchsuchen');
    expect(html).toContain('Prüfen');
    // the English defaults are gone — proof the literals were routed through i18n
    expect(html).not.toContain('In-memory main branch');
    expect(html).not.toContain('Save version');
    expect(html).not.toContain('Save the current document as a version');
    expect(html).not.toContain('Browse and restore saved versions');
  });

  it('falls back to the English defaults when no override is given', () => {
    const html = renderToString(<BranchBar editor={new Editor()} />);
    expect(html).toContain('In-memory main branch');
    expect(html).toContain('Save version');
    expect(html).toContain('History');
    expect(html).toContain('Review');
  });
});
