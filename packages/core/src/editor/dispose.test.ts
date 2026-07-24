/**
 * Dispose completeness (task A11) + instance-factory injection (A6). `dispose()` is idempotent and
 * additionally cancels pan momentum / in-flight tweens / the active tool and runs disposers in reverse;
 * guarded entry points throw `NodusError('editor-disposed')` afterward. Each `it` fails on the
 * pre-change editor (dispose only ran disposers forward; no disposed flag; no guards).
 */
import { describe, expect, it } from 'vitest';
import { Editor } from './index.js';
import { ToolNode } from '../tools/index.js';
import { deterministicIdFactory, type IdFactory } from '../ids/index.js';
import { isNodusError, type NodusError } from '../errors/index.js';
import type { Plugin } from '../plugins/index.js';
import type { Id } from '../model.js';

describe('Editor.dispose — completeness & idempotency', () => {
  it('flips disposed to true and is idempotent', () => {
    const ed = new Editor();
    expect(ed.disposed).toBe(false);
    ed.dispose();
    expect(ed.disposed).toBe(true);
    expect(() => ed.dispose()).not.toThrow(); // second call is a no-op
  });

  it('cancels an in-flight tween WITHOUT firing its onDone', () => {
    const ed = new Editor();
    let doneFired = false;
    ed.animate({ from: 0, to: 1, durationMs: 10_000, onTick: () => {}, onDone: () => (doneFired = true) });
    expect(ed.isAnimating()).toBe(true);
    ed.dispose();
    expect(ed.isAnimating()).toBe(false); // tweens cleared
    expect(doneFired).toBe(false); // clear() drops them without their completion callback
  });

  it('runs the active (non-select) tool onExit on dispose', () => {
    const ed = new Editor();
    let exited = false;
    class SpyTool extends ToolNode {
      readonly id = 'spy';
      override onExit(): void {
        exited = true;
      }
    }
    ed.toolManager.register(new SpyTool());
    ed.setTool('spy');
    exited = false; // ignore any exit during the switch-in; observe only dispose's exit
    ed.dispose();
    expect(exited).toBe(true);
  });

  it('runs disposers in REVERSE registration order', () => {
    const ed = new Editor();
    const order: string[] = [];
    const mkPlugin = (id: string): Plugin => ({ id, register: () => () => order.push(id) });
    ed.use(mkPlugin('p1'));
    ed.use(mkPlugin('p2'));
    ed.use(mkPlugin('p3'));
    ed.dispose();
    // registered after the editor's internal disposers, so reverse iteration runs them first + reversed
    expect(order.filter((x) => x.startsWith('p'))).toEqual(['p3', 'p2', 'p1']);
  });

  it('guarded entry points throw NodusError("editor-disposed") after dispose', () => {
    const ed = new Editor();
    ed.dispose();
    const calls: Array<() => void> = [
      () => ed.pointerDown({ x: 0, y: 0 }),
      () => ed.pointerMove({ x: 0, y: 0 }),
      () => ed.pointerUp({ x: 0, y: 0 }),
      () => ed.doubleClick({ x: 0, y: 0 }),
      () => ed.keyDown({ key: 'a', shift: false, meta: false, alt: false }),
      () => ed.undo(),
      () => ed.redo(),
      () => ed.mark(),
    ];
    for (const call of calls) {
      let err: unknown;
      try {
        call();
      } catch (e) {
        err = e;
      }
      expect(isNodusError(err)).toBe(true);
      expect((err as NodusError).code).toBe('editor-disposed');
    }
  });

  it('leaves the ~programmatic helpers UNGUARDED (documented decision)', () => {
    const ed = new Editor();
    ed.dispose();
    // a plain read/helper still works post-dispose — only input/load/history/paint are guarded
    expect(() => ed.store.nodes()).not.toThrow();
    expect(() => ed.selectedIdsArray()).not.toThrow();
  });
});

describe('EditorOptions.idFactory injection', () => {
  it('threads createNode through the injected factory', () => {
    let n = 0;
    const factory: IdFactory = {
      make: <T extends string>(t: T, seed?: string) => `${t}:${seed ?? `custom${n++}`}` as Id<T>,
      seed: () => {},
    };
    const ed = new Editor({ idFactory: factory });
    expect(ed.createNode({ type: 'rect', x: 0, y: 0 })).toBe('node:custom0');
    expect(ed.createNode({ type: 'rect', x: 0, y: 0 })).toBe('node:custom1');
  });

  it('a deterministic-factory editor mints legacy-shaped ids (not the session prefix form)', () => {
    const ed = new Editor({ idFactory: deterministicIdFactory() });
    const id = ed.createNode({ type: 'rect', x: 0, y: 0 });
    expect(id).toMatch(/^node:[0-9a-z]+x[0-9a-z]+$/); // `<n b36>x<hash b36>`, no session `prefix-counter`
  });
});
