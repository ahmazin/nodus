import { describe, expect, it } from 'vitest';
import { Editor, type Id } from '../index.js';

/** Build an editor with one flowing edge; returns the editor and edge id. */
function build(): { ed: Editor; e: Id } {
  const ed = new Editor();
  const a = ed.createNode({ type: 'rect', x: 0, y: 0, w: 100, h: 100 });
  const b = ed.createNode({ type: 'rect', x: 400, y: 0, w: 100, h: 100 });
  const e = ed.connect({ kind: 'outline', nodeId: a }, { kind: 'outline', nodeId: b })!;
  ed.setFlow([e], { style: 'dots', count: 3, speed: 70 });
  return { ed, e };
}

describe('flow runtime config', () => {
  it('exposes defaults', () => {
    const { ed } = build();
    expect(ed.flowConfig()).toEqual({
      enabled: true, paused: false, speedScale: 1, respectReducedMotion: true,
    });
  });

  it('setFlowConfig merges patches and clamps speedScale to >= 0', () => {
    const { ed } = build();
    ed.setFlowConfig({ paused: true });
    expect(ed.flowConfig().paused).toBe(true);
    expect(ed.flowConfig().enabled).toBe(true); // untouched by the patch
    ed.setFlowConfig({ speedScale: -5 });
    expect(ed.flowConfig().speedScale).toBe(0);
    ed.setFlowConfig({ maxFps: 30 });
    expect(ed.flowConfig().maxFps).toBe(30);
  });

  it('sugar methods delegate to setFlowConfig', () => {
    const { ed } = build();
    ed.pauseFlow(); expect(ed.flowConfig().paused).toBe(true);
    ed.resumeFlow(); expect(ed.flowConfig().paused).toBe(false);
    ed.setFlowEnabled(false); expect(ed.flowConfig().enabled).toBe(false);
    ed.setFlowSpeedScale(2); expect(ed.flowConfig().speedScale).toBe(2);
  });

  it('isFlowAnimating gates on enabled, paused, and reduced-motion; hasFlow is unchanged', () => {
    const { ed } = build();
    expect(ed.hasFlow()).toBe(true);
    expect(ed.isFlowAnimating()).toBe(true);

    ed.setFlowEnabled(false);
    expect(ed.isFlowAnimating()).toBe(false);
    expect(ed.hasFlow()).toBe(true); // doc truth unchanged

    ed.setFlowEnabled(true); ed.pauseFlow();
    expect(ed.isFlowAnimating()).toBe(false);

    ed.resumeFlow(); ed.setReducedMotion(true);
    expect(ed.isFlowAnimating()).toBe(false); // respected by default

    ed.setFlowConfig({ respectReducedMotion: false });
    expect(ed.isFlowAnimating()).toBe(true); // host override
  });

  it('isFlowAnimating is false when no edge is flowing', () => {
    const ed = new Editor();
    expect(ed.isFlowAnimating()).toBe(false);
  });
});
