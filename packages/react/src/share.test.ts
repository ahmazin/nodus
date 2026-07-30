/**
 * Pure-logic tests for shareable scenes. The clipboard surface (`copyShareLink`, `copySvg`) needs a
 * browser `navigator.clipboard` and is covered by the Playwright drive of the example app; here we
 * pin the headless core: base64 round-trip fidelity, URL/hash extraction, and hardened decode
 * (never throws, rejects non-Nodus input) through a real (headless) `Editor`.
 */

import { describe, expect, it } from 'vitest';
import { Editor, toCanonicalString } from '@ahmazin/core';
import {
  buildEmbedSnippet,
  buildShareUrl,
  decodeScene,
  encodeScene,
  MAX_SCENE_BYTES,
  sceneFromHash,
} from './share.js';

function makeEditor(): Editor {
  const ed = new Editor({ viewport: { w: 800, h: 600 } });
  ed.createNode({ type: 'rect', x: 10, y: 20, label: 'alpha' });
  ed.createNode({ type: 'rect', x: 300, y: 140, label: 'béta ☁' }); // non-ASCII → exercises UTF-8 path
  return ed;
}

describe('encode/decode round-trip', () => {
  it('reproduces the document (canonical equality)', () => {
    const editor = makeEditor();
    const snap = editor.toJSON();

    const decoded = decodeScene(encodeScene(snap));
    expect(decoded).not.toBeNull();
    expect(toCanonicalString(decoded!)).toBe(toCanonicalString(snap));
  });
});

describe('buildShareUrl', () => {
  it('prefixes origin+pathname and encodes a decodable scene in the hash', () => {
    const editor = makeEditor();
    const prefix = 'https://x.test/app#scene=';
    const url = buildShareUrl(editor, { origin: 'https://x.test', pathname: '/app' });

    expect(url.startsWith(prefix)).toBe(true);
    const decoded = decodeScene(url.slice(prefix.length));
    expect(decoded).not.toBeNull();
    expect(toCanonicalString(decoded!)).toBe(toCanonicalString(editor.toJSON()));
  });
});

describe('sceneFromHash', () => {
  it('extracts + decodes from a hash, a bare param, and a full URL', () => {
    const editor = makeEditor();
    const enc = encodeScene(editor.toJSON());
    const canonical = toCanonicalString(editor.toJSON());

    for (const hash of [`#scene=${enc}`, `scene=${enc}`, `https://x.test/app#scene=${enc}`]) {
      const snap = sceneFromHash(hash);
      expect(snap).not.toBeNull();
      expect(toCanonicalString(snap!)).toBe(canonical);
    }
  });

  it('returns null when there is no scene param or the value is not base64', () => {
    expect(sceneFromHash('#foo=bar')).toBeNull();
    expect(sceneFromHash('#scene=@@@notbase64@@@')).toBeNull();
  });
});

describe('decodeScene hardening', () => {
  it('never throws on garbage input', () => {
    expect(decodeScene('garbage!')).toBeNull();
  });

  it('rejects valid base64 that is not a Nodus snapshot', () => {
    expect(decodeScene(btoa('{"not":"a snapshot"}'))).toBeNull();
  });
});

describe('buildEmbedSnippet', () => {
  it('wraps the share URL in an <iframe> with the requested size', () => {
    const editor = makeEditor();
    const snippet = buildEmbedSnippet(editor, { width: 400, height: 300 });

    expect(snippet).toContain('<iframe');
    expect(snippet).toContain(buildShareUrl(editor));
    expect(snippet).toContain('width="400"');
    expect(snippet).toContain('height="300"');
  });
});

describe('share — zero-click #scene= size cap (audit M2)', () => {
  it('rejects an oversized encoded fragment before decoding, returning null', () => {
    // A crafted share link loads zero-click on page open; an over-cap fragment must be refused before
    // atob/JSON.parse allocates. Pre-fix this decoded + parsed a multi-MB blob on the main thread.
    const huge = 'A'.repeat(MAX_SCENE_BYTES + 1);
    expect(decodeScene(huge)).toBeNull();
    expect(sceneFromHash(`#scene=${huge}`)).toBeNull();
  });

  it('still round-trips an ordinary scene', () => {
    const ed = new Editor();
    ed.createNode({ type: 'rect', x: 0, y: 0, w: 10, h: 10 });
    const encoded = encodeScene(ed.toJSON());
    expect(encoded.length).toBeLessThan(MAX_SCENE_BYTES);
    expect(decodeScene(encoded)).not.toBeNull();
  });
});
