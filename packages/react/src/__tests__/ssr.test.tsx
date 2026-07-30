/**
 * Server-side rendering safety (C2/F3) + network-free default styles (C4/F12).
 *
 * vitest runs `environment: 'node'`, so `react-dom/server`'s `renderToString` exercises the true
 * server path with no jsdom. Importing the components through the `@ahmazin/react` barrel doubles as a
 * node-environment barrel-import smoke test (the barrel must not touch the DOM at module scope).
 *
 * The SSR cases fail without the `getServerSnapshot` fix: `useValue` builds on `useSyncExternalStore`,
 * whose third argument is the server snapshot. Omit it and React 18 throws "Missing getServerSnapshot"
 * the moment any subscribing component is server-rendered — which is every panel below.
 */
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Editor } from '@ahmazin/core';
import { Nodus, Properties, Minimap, LayersPanel, injectGlobalStyles } from '@ahmazin/react';

describe('SSR — renderToString without a DOM (C2/F3)', () => {
  it('renders <Nodus> on the server without throwing', () => {
    const editor = new Editor();
    // <Nodus> renders <EditOverlay>, which reads editor state via useValue → getServerSnapshot.
    // Its rAF/pointer wiring lives in a layout effect that never runs on the server.
    expect(() => renderToString(<Nodus editor={editor} />)).not.toThrow();
  });

  it('renders the state-reading panels on the server without throwing', () => {
    const editor = new Editor();
    // Each panel subscribes to engine signals through useValue. Without a server snapshot every one
    // of these throws "Missing getServerSnapshot"; with it they render to markup.
    expect(() => renderToString(<Properties editor={editor} />)).not.toThrow();
    expect(() => renderToString(<Minimap editor={editor} />)).not.toThrow();
    expect(() => renderToString(<LayersPanel editor={editor} />)).not.toThrow();
  });
});

interface FakeEl {
  tagName: string;
  id: string;
  rel: string;
  href: string;
  textContent: string;
}

/** Minimal DOM stub — enough for `injectGlobalStyles` (getElementById / createElement / appendChild). */
function fakeDocument() {
  const children: FakeEl[] = [];
  return {
    children,
    head: { appendChild: (el: FakeEl): void => void children.push(el) },
    getElementById: (id: string): FakeEl | null => children.find((el) => el.id === id) ?? null,
    createElement: (tag: string): FakeEl => ({ tagName: tag.toUpperCase(), id: '', rel: '', href: '', textContent: '' }),
  };
}

describe('injectGlobalStyles — network-free by default, fonts opt-in (C4/F12)', () => {
  it('injects base styles with no @import and no Google Fonts request', () => {
    const doc = fakeDocument();
    const g = globalThis as unknown as { document?: unknown };
    g.document = doc;
    try {
      injectGlobalStyles();
      const style = doc.children.find((el) => el.id === 'nodus-ui-global-styles');
      expect(style).toBeDefined();
      expect(style!.textContent).not.toContain('@import');
      expect(style!.textContent).not.toContain('fonts.googleapis');
      // No web-font link unless explicitly requested.
      expect(doc.children.some((el) => el.id === 'nodus-ui-webfonts')).toBe(false);
    } finally {
      delete g.document;
    }
  });

  it('adds a separate web-font <link> only when { webFonts: true } — even after the base sheet exists', () => {
    const doc = fakeDocument();
    const g = globalThis as unknown as { document?: unknown };
    g.document = doc;
    try {
      injectGlobalStyles(); // base sheet first; its id must not suppress the later font link
      injectGlobalStyles({ webFonts: true });
      const link = doc.children.find((el) => el.id === 'nodus-ui-webfonts');
      expect(link).toBeDefined();
      expect(link!.tagName).toBe('LINK');
      expect(link!.rel).toBe('stylesheet');
      expect(link!.href).toContain('fonts.googleapis.com');
    } finally {
      delete g.document;
    }
  });
});
