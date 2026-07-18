import { describe, expect, it } from 'vitest';
// Pure logic extracted from the WS-D panel migration. No jsdom here, so the DOM wiring is verified by
// the browser E2E drive; these cover the framework-free helpers each panel now depends on.
import { nextMenuIndex } from '../context-menu.js';
import { stackOffsets } from '../toast.js';
import { createVersionCache } from '../minimap.js';
import { flowAccent, flowStyles } from '../flow-shared.js';
import { uiTokens } from '../ui/tokens.js';

describe('nextMenuIndex (context-menu keyboard nav)', () => {
  it('moves down with wrap', () => {
    expect(nextMenuIndex(0, 3, 'ArrowDown')).toBe(1);
    expect(nextMenuIndex(2, 3, 'ArrowDown')).toBe(0);
  });
  it('moves up with wrap', () => {
    expect(nextMenuIndex(1, 3, 'ArrowUp')).toBe(0);
    expect(nextMenuIndex(0, 3, 'ArrowUp')).toBe(2);
  });
  it('jumps to first/last on Home/End', () => {
    expect(nextMenuIndex(2, 4, 'Home')).toBe(0);
    expect(nextMenuIndex(0, 4, 'End')).toBe(3);
  });
  it('holds position for unrelated keys and guards an empty menu', () => {
    expect(nextMenuIndex(1, 3, 'x')).toBe(1);
    expect(nextMenuIndex(0, 0, 'ArrowDown')).toBe(-1);
  });
});

describe('stackOffsets (toast stacking)', () => {
  it('is empty for no toasts', () => {
    expect(stackOffsets([], 24, 8)).toEqual([]);
  });
  it('places the first toast at the base offset', () => {
    expect(stackOffsets([30], 24, 8)).toEqual([24]);
  });
  it('accumulates height + gap for each stacked toast', () => {
    expect(stackOffsets([30, 40], 24, 8)).toEqual([24, 62]);
    expect(stackOffsets([30, 40, 20], 24, 8)).toEqual([24, 62, 110]);
  });
});

describe('createVersionCache (minimap contentBounds cache)', () => {
  it('recomputes only when the version changes', () => {
    const cache = createVersionCache<number>();
    let calls = 0;
    const compute = (v: number) => () => { calls++; return v; };

    expect(cache(1, compute(10))).toBe(10);
    expect(cache(1, compute(999))).toBe(10); // same version → cached, compute NOT called
    expect(calls).toBe(1);

    expect(cache(2, compute(20))).toBe(20); // new version → recompute
    expect(calls).toBe(2);
    expect(cache(2, compute(999))).toBe(20); // cached again
    expect(calls).toBe(2);
  });
});

describe('flow styles (token migration + contrast fix)', () => {
  it('exposes a mode-aware flow accent that meets AA in both modes', () => {
    expect(flowAccent('dark')).toBe('#2dd4bf');
    expect(flowAccent('light')).toBe('#0f766e');
  });
  it('derives row/micro labels from the AA token greys, not the old low-contrast literals', () => {
    const d = flowStyles(uiTokens.dark);
    expect(d.micro.color).toBe(uiTokens.dark.color.textMuted);
    expect(d.labelColor).toBe(uiTokens.dark.color.textMuted);
    // the removed MICRO/ROW_LABEL greys (#556058 / #8b958f) must no longer surface
    expect(d.micro.color).not.toBe('#556058');
    expect(d.labelColor).not.toBe('#8b958f');
  });
  it('builds field styles from the active surface/border tokens per mode', () => {
    const l = flowStyles(uiTokens.light);
    expect(l.accent).toBe('#0f766e');
    expect(l.select.background).toBe(uiTokens.light.color.surface);
    expect(l.numField.border).toBe(`1px solid ${uiTokens.light.color.border}`);
    expect(l.checkbox.accentColor).toBe('#0f766e');
  });
});
