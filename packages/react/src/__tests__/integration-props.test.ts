/**
 * C5/F26 — the `<Nodus>` integration props (onMount / onChange / onSelectionChange / onCameraChange)
 * forward the engine's `change` / `selection` / `camera` events, and `onMount` fires once per editor
 * instance. This exercises the wiring against a manual editor (node env, no DOM): the host subscribes
 * through `editor.on(...)` in an effect keyed on `editor`, with a once-per-instance mount guard that
 * must hold up under StrictMode's double-invoked effect.
 */
import { describe, expect, it } from 'vitest';
import { Editor, type Camera, type ChangeInfo, type Id } from '@nodus-dev/core';

describe('C5 integration props — editor event wiring', () => {
  it('forwards change / selection / camera and fires onMount once per instance', () => {
    const editor = new Editor();
    const changes: ChangeInfo[] = [];
    const selections: Id[][] = [];
    const cameras: Camera[] = [];
    let mountCount = 0;
    let mountedFor: Editor | null = null;

    // Mirrors nodus-host.tsx's subscription effect + once-per-instance mount guard.
    const subscribe = (): Array<() => void> => {
      if (mountedFor !== editor) { mountedFor = editor; mountCount++; }
      return [
        editor.on('change', (e) => changes.push(e.info)),
        editor.on('selection', (e) => selections.push(e.ids)),
        editor.on('camera', (e) => cameras.push(e.camera)),
      ];
    };

    let offs = subscribe();
    // StrictMode double-invoke: tear down then re-subscribe. onMount must NOT fire again.
    for (const off of offs) off();
    offs = subscribe();

    const id = editor.createNode({ type: 'rect', x: 10, y: 20 });
    editor.select([id]);
    editor.setCamera({ x: 5, y: 6, z: 2 });

    expect(mountCount).toBe(1);
    expect(changes.length).toBeGreaterThan(0);
    expect(selections.at(-1)).toEqual([id]);
    expect(cameras.at(-1)).toMatchObject({ x: 5, y: 6, z: 2 });

    // Unsubscribe → later mutations no longer reach the callbacks.
    for (const off of offs) off();
    const before = changes.length;
    editor.createNode({ type: 'rect', x: 0, y: 0 });
    expect(changes.length).toBe(before);
  });
});
