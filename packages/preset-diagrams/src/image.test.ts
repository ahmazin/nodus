import { afterEach, describe, expect, it } from 'vitest';
import { DrawApi, Editor, type Ctx2D, type NodeRecord, type ResolvedTokens } from '@ahmazin/core';
import {
  IMAGE_CACHE_CAP,
  clearImageCache,
  getImage,
  imageCacheSize,
  imageNode,
  installDiagrams,
  setImageDecoder,
  setImageInvalidator,
  type DecodedImage,
  type ImageNodeProps,
} from '@ahmazin/preset-diagrams';

// A 1x1 transparent PNG.
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function stubCtx() {
  const calls: Record<string, number> = {};
  const rec = (n: string) => {
    calls[n] = (calls[n] ?? 0) + 1;
  };
  const ctx = {
    save() {}, restore() {}, scale() {}, translate() {}, rotate() {}, setTransform() {}, transform() {},
    clearRect() {}, fillRect() { rec('fillRect'); }, strokeRect() { rec('strokeRect'); },
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, arcTo() {}, ellipse() {},
    quadraticCurveTo() {}, bezierCurveTo() {}, rect() {},
    fill() { rec('fill'); }, stroke() { rec('stroke'); }, clip() { rec('clip'); },
    fillText() { rec('fillText'); }, strokeText() {}, measureText: (t: string) => ({ width: t.length * 6 }),
    setLineDash() {}, drawImage() { rec('drawImage'); },
    fillStyle: '', strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '', lineDashOffset: 0,
    font: '', textAlign: '', textBaseline: '', globalAlpha: 1, shadowBlur: 0, shadowColor: '', shadowOffsetX: 0, shadowOffsetY: 0,
  };
  return { ctx: ctx as unknown as Ctx2D, calls };
}

const TOKENS: ResolvedTokens = {
  fill: '#0c100f', stroke: '#3b82f6', strokeWidth: 1, text: '#e5e5e5', glow: '#3b82f6',
  opacity: 1, fontScale: 1, radius: 6, fontFamily: 'monospace', fontSize: 12, lineHeight: 1.3,
};

const mkNode = (over: Partial<NodeRecord> = {}): NodeRecord =>
  ({
    id: 'node:img', typeName: 'node', version: 0, type: 'diagram.image',
    x: 10, y: 20, w: 100, h: 60, z: '0', visual: { state: 'solid' },
    props: { src: TINY_PNG, naturalWidth: 1, naturalHeight: 1 }, ...over,
  }) as NodeRecord;

afterEach(() => {
  clearImageCache();
  setImageDecoder(null); // restore browser default (undefined in node → placeholder path)
  setImageInvalidator(() => {});
});

describe('imageNode geometry', () => {
  it('geometry and bounds track the node box', () => {
    const b = imageNode.getGeometry(mkNode()).bounds();
    expect(b).toEqual({ x: 10, y: 20, w: 100, h: 60 });
  });

  it('exposes four connection ports', () => {
    expect(imageNode.getPorts!(mkNode())).toHaveLength(4);
  });

  it('declares resize + rotate capabilities', () => {
    expect(imageNode.capabilities).toMatchObject({ canResize: true, canRotate: true });
  });

  it('default size clamps large images to a max side while preserving aspect ratio', () => {
    const s = imageNode.getDefaultSize!({ naturalWidth: 1600, naturalHeight: 800 } as Record<string, unknown>);
    expect(Math.max(s.w, s.h)).toBeLessThanOrEqual(320);
    expect(s.w / s.h).toBeCloseTo(2, 1); // 1600:800 aspect kept
  });
});

describe('imageNode serialization', () => {
  it('props round-trip through canonical serialization (aspect survives)', () => {
    const ed = new Editor();
    installDiagrams(ed);
    ed.createNode({
      type: 'diagram.image', x: 0, y: 0, w: 64, h: 32,
      props: { src: TINY_PNG, naturalWidth: 32, naturalHeight: 16, alt: 'logo', fit: 'cover' },
    });

    const snap = ed.toJSON();
    const ed2 = new Editor();
    installDiagrams(ed2);
    ed2.loadSnapshot(snap);

    const restored = ed2.store.nodes().find((n) => n.type === 'diagram.image');
    expect(restored).toBeDefined();
    const expected: ImageNodeProps = { src: TINY_PNG, naturalWidth: 32, naturalHeight: 16, alt: 'logo', fit: 'cover' };
    expect(restored!.props).toMatchObject(expected);
  });
});

describe('imageNode draw', () => {
  it('paints a labelled placeholder without throwing when the image is not decoded', () => {
    setImageDecoder(null); // no global Image in node → nothing to decode
    const { ctx, calls } = stubCtx();
    expect(() => imageNode.draw(new DrawApi(ctx, TOKENS), mkNode(), TOKENS)).not.toThrow();
    expect(calls.drawImage ?? 0).toBe(0); // placeholder path, not the image path
    expect(calls.fill).toBeGreaterThan(0); // placeholder tile filled
    expect(calls.fillText).toBeGreaterThan(0); // placeholder label drawn
  });

  it('draws the decoded image via drawImage once a decoder yields pixels', () => {
    setImageDecoder(() => ({ width: 20, height: 10 }));
    const { ctx, calls } = stubCtx();
    imageNode.draw(new DrawApi(ctx, TOKENS), mkNode({ props: { src: 'data:x', naturalWidth: 20, naturalHeight: 10, fit: 'contain' } }), TOKENS);
    expect(calls.drawImage).toBe(1);
  });
});

describe('image cache', () => {
  it('decodes each source at most once', () => {
    let decodes = 0;
    setImageDecoder(() => {
      decodes++;
      return { width: 4, height: 4 };
    });
    getImage('data:a');
    getImage('data:a');
    getImage('data:a');
    expect(decodes).toBe(1);
  });

  it('surfaces an async-decoded image on a later call and repaints via the invalidator', () => {
    const img = { width: 0, height: 0 };
    let fire = () => {};
    setImageDecoder((_src, onReady) => {
      fire = onReady;
      return img;
    });
    let repaints = 0;
    setImageInvalidator(() => {
      repaints++;
    });

    expect(getImage('data:async')).toBeUndefined(); // width 0 → still decoding
    img.width = 8;
    img.height = 8;
    fire(); // decode completes → invalidator repaints
    expect(repaints).toBe(1);
    expect(getImage('data:async')).toBe(img); // now ready
  });
});

// The decode cache is module-global and shared across editors; the audit (F22) required it be BOUNDED
// (so a long paste-many-images session can't grow without limit) and CLEARABLE (so it resets).
describe('image cache bounding (F22)', () => {
  it('is LRU-bounded: size never exceeds the cap, evicting the oldest on overflow', () => {
    const decoded: string[] = [];
    setImageDecoder((src) => {
      decoded.push(src);
      return { width: 4, height: 4 };
    });

    // Fill well past the cap with distinct sources.
    for (let i = 0; i < IMAGE_CACHE_CAP + 20; i++) getImage(`data:src-${i}`);
    expect(imageCacheSize()).toBe(IMAGE_CACHE_CAP); // capped, not IMAGE_CACHE_CAP + 20
    expect(imageCacheSize()).toBeLessThanOrEqual(IMAGE_CACHE_CAP);

    // The oldest source (src-0) was evicted → requesting it again re-decodes.
    const beforeReq = decoded.length;
    getImage('data:src-0');
    expect(decoded.length).toBe(beforeReq + 1);

    // A recently-used source is still resident → no re-decode.
    const beforeHit = decoded.length;
    getImage(`data:src-${IMAGE_CACHE_CAP + 19}`); // the most recently inserted
    expect(decoded.length).toBe(beforeHit);
  });

  it('a cache hit refreshes recency, protecting a hot entry from eviction', () => {
    const decoded: string[] = [];
    setImageDecoder((src) => {
      decoded.push(src);
      return { width: 4, height: 4 };
    });

    getImage('data:hot'); // insert first (would be the oldest / first eviction victim)
    // Fill the rest of the cap with other sources, touching `hot` before the final overflow.
    for (let i = 0; i < IMAGE_CACHE_CAP - 1; i++) getImage(`data:cold-${i}`);
    getImage('data:hot'); // touch → most-recently-used
    getImage('data:overflow'); // overflow: evicts the true oldest (cold-0), NOT hot

    const before = decoded.length;
    getImage('data:hot');
    expect(decoded.length).toBe(before); // still cached — recency protected it
  });

  it('clearImageCache empties the cache', () => {
    setImageDecoder(() => ({ width: 4, height: 4 }));
    getImage('data:a');
    getImage('data:b');
    expect(imageCacheSize()).toBeGreaterThan(0);
    clearImageCache();
    expect(imageCacheSize()).toBe(0);
  });
});

describe('DecodedImage export (F36)', () => {
  it('the DecodedImage type is importable from the package barrel', () => {
    // Type-level assertion: this annotation only compiles if `DecodedImage` is exported from the
    // barrel (the `export *` from image.ts). tsc is the gate; the runtime check just uses the value.
    const probe: DecodedImage = { width: 2, height: 3 };
    expect(probe.width).toBe(2);
    expect(probe.height).toBe(3);
  });
});
