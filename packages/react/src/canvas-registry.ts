/**
 * Internal DOM link between an Editor and its mounted <canvas>. The core Editor is headless, but a
 * drop target (e.g. the cloud icon picker) needs the canvas's screen rect to map a pointer to world
 * coordinates. The <Nodus> host registers its canvas on mount; consumers read it here.
 */
import type { Editor } from '@nodus/core';

const registry = new WeakMap<Editor, HTMLCanvasElement>();

export function registerCanvas(editor: Editor, canvas: HTMLCanvasElement): void {
  registry.set(editor, canvas);
}
export function unregisterCanvas(editor: Editor): void {
  registry.delete(editor);
}
export function getCanvas(editor: Editor): HTMLCanvasElement | undefined {
  return registry.get(editor);
}
