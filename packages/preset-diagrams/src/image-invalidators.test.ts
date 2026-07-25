/** Pin for F22's last leg: the repaint-invalidator slot must be multi-cast so a second editor/host
 *  can never steal the first's trigger (task #51). */
import { afterEach, describe, expect, it } from 'vitest';
import { addImageInvalidator, clearImageCache, getImage, setImageDecoder, setImageInvalidator } from './image.js';

afterEach(() => {
  setImageDecoder(null);
  clearImageCache();
});

describe('image invalidators are multi-cast', () => {
  it('two hosts both receive the decode-complete trigger; disposing one leaves the other', () => {
    const fired: string[] = [];
    // decoder that "completes" synchronously by calling the invalidate callback it is given
    setImageDecoder((_src, invalidate) => {
      invalidate();
      return { width: 1, height: 1 } as never;
    });
    const disposeA = addImageInvalidator(() => fired.push('a'));
    addImageInvalidator(() => fired.push('b'));
    setImageInvalidator(() => fired.push('legacy'));

    getImage('img:one');
    expect(fired.sort()).toEqual(['a', 'b', 'legacy']);

    fired.length = 0;
    disposeA();
    getImage('img:two');
    expect(fired.sort()).toEqual(['b', 'legacy']);

    // legacy slot replaces, never accumulates
    fired.length = 0;
    setImageInvalidator(() => fired.push('legacy2'));
    getImage('img:three');
    expect(fired.sort()).toEqual(['b', 'legacy2']);
  });
});
