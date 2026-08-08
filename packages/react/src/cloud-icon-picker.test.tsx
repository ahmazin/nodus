/**
 * i18n wiring for the cloud-icon picker trigger. Rendered server-side (node env, no jsdom) via
 * `react-dom/server`, matching the repo's SSR test convention (see messages-override.test.tsx): the
 * closed popover renders only its trigger button, so the trigger label/aria are what SSR can assert.
 * The deeper popover strings (search/clear/count/empty/footer) are open-state-only and covered by
 * typecheck + the browser suite. Each assertion below fails against the pre-i18n hardcoded literals.
 */
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Editor } from '@nodus-dev/core';
import { CloudIconPicker } from '@nodus-dev/react';

describe('CloudIconPicker — i18n trigger', () => {
  it('renders the overridden trigger label (and not the English default)', () => {
    const html = renderToString(
      <CloudIconPicker editor={new Editor()} catalog={[]} messages={{ cloudIcons: { trigger: 'Wolken-Symbole' } }} />,
    );
    expect(html).toContain('Wolken-Symbole');
    expect(html).not.toContain('Cloud icons');
  });

  it('localizes the icon-only trigger aria-label via cloudIcons.triggerLabel', () => {
    const html = renderToString(
      <CloudIconPicker
        editor={new Editor()}
        catalog={[]}
        triggerContent={<span>glyph</span>}
        messages={{ cloudIcons: { triggerLabel: 'Wolken' } }}
      />,
    );
    expect(html).toContain('aria-label="Wolken"');
  });
});
