import { describe, expect, it } from 'vitest';
import { getIcon, iconNames, registerIcon } from '../index.js';

describe('icons', () => {
  it('ships a set of built-in icons', () => {
    const names = iconNames();
    expect(names).toEqual(expect.arrayContaining(['server', 'database', 'cache', 'queue', 'balancer', 'globe']));
    expect(getIcon('database')).toBeTypeOf('function');
    expect(getIcon('nope')).toBeUndefined();
  });

  it('supports registering custom icons', () => {
    let called = false;
    registerIcon('custom-star', () => { called = true; });
    const fn = getIcon('custom-star')!;
    // minimal stub ctx — the star icon just needs to be invokable
    fn({ save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, ellipse() {}, rect() {}, closePath() {}, lineJoin: '', lineCap: '', strokeStyle: '', lineWidth: 0 } as never, 0, 0, 10, '#fff');
    expect(called).toBe(true);
  });
});
