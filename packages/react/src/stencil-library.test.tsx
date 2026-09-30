/**
 * i18n wiring for the stencil-library trigger. Rendered server-side (node env, no jsdom) via
 * `react-dom/server`, matching the repo's SSR test convention (see messages-override.test.tsx): the
 * closed popover renders only its trigger button, so the trigger label is what SSR can assert. The
 * deeper popover strings (search/clear/save/empty/recent/footer) are open-state-only and covered by
 * typecheck + the browser suite. The assertion below fails against the pre-i18n hardcoded literal.
 */
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Editor } from '@nodus-dev/core';
import { StencilLibrary } from '@nodus-dev/react';

describe('StencilLibrary — i18n trigger', () => {
  it('renders the overridden trigger label (and not the English default)', () => {
    const html = renderToString(
      <StencilLibrary editor={new Editor()} libraries={[]} messages={{ stencils: { trigger: 'Schablonen' } }} />,
    );
    expect(html).toContain('Schablonen');
    expect(html).not.toContain('Stencils');
  });
});
