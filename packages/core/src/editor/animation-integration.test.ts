import { describe, expect, it } from 'vitest';
import { Editor, linear } from '../index.js';

function editor(): Editor {
  return new Editor();
}

describe('editor animation integration', () => {
  it('animate() drives a presentation value and reports isAnimating()', () => {
    const ed = editor();
    ed.animate({
      from: 0,
      to: 1,
      durationMs: 100,
      easing: linear,
      onTick: (v) => ed.setPresentation('n1', { alpha: v }),
      onDone: () => ed.clearPresentation('n1'),
    });
    expect(ed.isAnimating()).toBe(true);
    ed.animClockStep(1000); // test-only helper, see step 3
    ed.animClockStep(1050);
    expect(ed.presentationFor('n1')?.alpha).toBeCloseTo(0.5);
    ed.animClockStep(1100);
    expect(ed.isAnimating()).toBe(false);
    expect(ed.presentationFor('n1')).toBeUndefined(); // cleared onDone
  });

  it('reduced motion snaps presentation and never sustains animation', () => {
    const ed = editor();
    ed.setReducedMotion(true);
    ed.animate({ from: 0, to: 1, durationMs: 1000, onTick: (v) => ed.setPresentation('n1', { alpha: v }) });
    ed.animClockStep(0);
    expect(ed.presentationFor('n1')?.alpha).toBe(1);
    expect(ed.isAnimating()).toBe(false);
  });

  it('animate() bumps animationEpochAtom so a signal-subscribed host repaint wakes an idle rAF loop', () => {
    const ed = editor();
    const before = ed.animationEpochAtom.peek();
    ed.animate({ from: 0, to: 1, durationMs: 100, onTick: () => {} });
    expect(ed.animationEpochAtom.peek()).toBe(before + 1);
    ed.animate({ from: 0, to: 1, durationMs: 100, onTick: () => {} });
    expect(ed.animationEpochAtom.peek()).toBe(before + 2);
  });
});
