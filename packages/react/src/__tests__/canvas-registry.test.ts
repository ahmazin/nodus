import { describe, expect, it } from 'vitest';
import { Editor } from '@nodus/core';
import { getCanvas, registerCanvas, unregisterCanvas } from '../canvas-registry.js';

describe('canvas registry', () => {
  it('stores, returns, and clears the canvas for an editor', () => {
    const editor = new Editor();
    const canvas = {} as HTMLCanvasElement; // WeakMap only needs object identity
    expect(getCanvas(editor)).toBeUndefined();
    registerCanvas(editor, canvas);
    expect(getCanvas(editor)).toBe(canvas);
    unregisterCanvas(editor);
    expect(getCanvas(editor)).toBeUndefined();
  });

  it('keeps registrations independent per editor', () => {
    const a = new Editor();
    const b = new Editor();
    const ca = {} as HTMLCanvasElement;
    registerCanvas(a, ca);
    expect(getCanvas(a)).toBe(ca);
    expect(getCanvas(b)).toBeUndefined();
  });
});
