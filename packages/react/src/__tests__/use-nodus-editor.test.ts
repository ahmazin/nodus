/**
 * C1/F2 — `useNodusEditor` must survive React StrictMode's dev-only mount → unmount → remount, which
 * runs only the EFFECT again (never the render). vitest runs `environment: 'node'` with no DOM renderer
 * and react-test-renderer isn't a dependency, so we drive the REAL hook through a minimal hook runtime
 * (a `vi.mock('react')` providing controllable useRef/useReducer/useEffect) and replay that exact
 * lifecycle. The hook must end holding a LIVE editor, having disposed the one StrictMode tore down.
 */
import { describe, expect, it, vi } from 'vitest';

const rt = vi.hoisted(() => {
  interface EffectSlot { committedDeps?: unknown[]; cleanup?: (() => void) | void; setup?: () => (() => void) | void; deps?: unknown[]; }
  const slots: unknown[] = [];
  const effects: EffectSlot[] = [];
  let cursor = 0;
  let effectCursor = 0;
  let scheduled = false;

  const depsChanged = (a?: unknown[], b?: unknown[]): boolean =>
    !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));

  const useRef = <T>(initial: T): { current: T } => {
    const i = cursor++;
    if (slots[i] === undefined) slots[i] = { current: initial };
    return slots[i] as { current: T };
  };
  const useReducer = <S>(reducer: (s: S, a: unknown) => S, init: S): [S, () => void] => {
    const i = cursor++;
    if (slots[i] === undefined) slots[i] = { s: init };
    const slot = slots[i] as { s: S };
    const dispatch = (): void => { slot.s = reducer(slot.s, undefined); scheduled = true; };
    return [slot.s, dispatch];
  };
  const useEffect = (setup: () => (() => void) | void, deps?: unknown[]): void => {
    const i = effectCursor++;
    const slot = (effects[i] ??= {});
    slot.setup = setup;
    slot.deps = deps;
  };

  // ---- driver ----
  const render = (fn: () => unknown): unknown => { cursor = 0; effectCursor = 0; return fn(); };
  const commit = (): void => {
    for (const e of effects) {
      if (depsChanged(e.committedDeps, e.deps)) {
        e.cleanup?.();
        e.cleanup = e.setup?.();
        e.committedDeps = e.deps;
      }
    }
  };
  // StrictMode dev remount: unconditional cleanup + setup replay for the SAME committed render.
  const strictModeRemount = (): void => {
    for (const e of effects) { e.cleanup?.(); e.cleanup = e.setup?.(); }
  };
  const flush = (fn: () => unknown): unknown => {
    let result: unknown;
    for (let guard = 0; scheduled; guard++) {
      if (guard > 20) throw new Error('render loop did not settle');
      scheduled = false;
      result = render(fn);
      commit();
    }
    return result;
  };
  const unmount = (): void => { for (const e of effects) { e.cleanup?.(); e.cleanup = undefined; } };
  const reset = (): void => { slots.length = 0; effects.length = 0; cursor = 0; effectCursor = 0; scheduled = false; };

  return { useRef, useReducer, useEffect, render, commit, strictModeRemount, flush, unmount, reset };
});

vi.mock('react', () => ({ useRef: rt.useRef, useReducer: rt.useReducer, useEffect: rt.useEffect }));

import { Editor } from '@nodus-dev/core';
import { useNodusEditor } from '../use-nodus-editor.js';

describe('useNodusEditor — StrictMode lifecycle (C1/F2)', () => {
  it('ends with a LIVE editor after mount → unmount(dispose) → remount', () => {
    rt.reset();
    const built: Editor[] = [];
    const component = (): Editor => useNodusEditor(() => { const e = new Editor(); built.push(e); return e; });

    let current = rt.render(component) as Editor; // render 1
    rt.commit();                                   // effect setup (E1 live)
    rt.strictModeRemount();                         // cleanup disposes E1, setup replay detects it → bump
    current = rt.flush(component) as Editor;         // bump-driven re-render rebuilds a live E2

    expect(built.length).toBe(2);          // factory re-ran once to replace the disposed instance
    expect(built[0]!.disposed).toBe(true); // StrictMode disposed the first
    expect(current.disposed).toBe(false);  // the hook hands back a live editor
    expect(current).toBe(built[1]);
  });

  it('a plain mount → unmount disposes the editor exactly once', () => {
    rt.reset();
    const built: Editor[] = [];
    const component = (): Editor => useNodusEditor(() => { const e = new Editor(); built.push(e); return e; });

    const e = rt.render(component) as Editor;
    rt.commit();
    expect(e.disposed).toBe(false);
    rt.unmount();
    expect(e.disposed).toBe(true);
    expect(built.length).toBe(1); // never rebuilt without a StrictMode remount
  });
});
