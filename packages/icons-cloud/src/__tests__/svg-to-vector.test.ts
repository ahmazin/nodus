import { describe, expect, it } from 'vitest';
import { OP } from '@nodus/core';
import { svgToVectorIcon } from '../codegen/svg-to-vector.js';

const SVG = `<svg viewBox="0 0 24 24">
  <g transform="translate(2 2)"><rect x="0" y="0" width="20" height="20" fill="#ED7100"/></g>
  <path d="M4 4 L16 4 L10 16 Z" fill="#ffffff"/>
</svg>`;

describe('svgToVectorIcon', () => {
  it('reads the viewBox', () => {
    expect(svgToVectorIcon(SVG).icon.vb).toEqual([24, 24]);
  });

  it('bakes group transforms into coordinates and keeps per-shape fills', () => {
    const { icon } = svgToVectorIcon(SVG);
    expect(icon.sub).toHaveLength(2);
    const rect = icon.sub[0]!;
    expect(rect.fill).toBe('#ED7100');
    expect(rect.cmds[0]).toBe(OP.M);
    // rect origin (0,0) translated by (2,2) -> first moveTo is (2,2)
    expect(rect.cmds.slice(1, 3)).toEqual([2, 2]);
    expect(icon.sub[1]!.fill).toBe('#ffffff');
  });

  it('flattens a gradient fill to a representative solid', () => {
    const g = `<svg viewBox="0 0 10 10">
      <defs><linearGradient id="a"><stop offset="0" stop-color="#111"/><stop offset="1" stop-color="#999"/></linearGradient></defs>
      <rect x="0" y="0" width="10" height="10" fill="url(#a)"/></svg>`;
    const { icon } = svgToVectorIcon(g);
    expect(icon.sub[0]!.fill).toBe('#999'); // mid stop of 2 -> index 1
  });

  it('carries fill-rule=evenodd onto the subpath for compound glyphs with holes', () => {
    const g = `<svg viewBox="0 0 10 10">
      <path d="M0 0L10 0L10 10Z" fill="#000" fill-rule="evenodd"/>
    </svg>`;
    const { icon } = svgToVectorIcon(g);
    expect(icon.sub[0]!.fillRule).toBe('evenodd');
  });

  it('omits fillRule for plain (nonzero) fills', () => {
    const g = `<svg viewBox="0 0 10 10">
      <path d="M0 0L10 0L10 10Z" fill="#000"/>
    </svg>`;
    const { icon } = svgToVectorIcon(g);
    expect(icon.sub[0]!.fillRule).toBeUndefined();
  });

  it('warns and drops stroke-only geometry (fill=none with a stroke)', () => {
    const g = `<svg viewBox="0 0 10 10">
      <path d="M0 0L10 0" fill="none" stroke="#000"/>
    </svg>`;
    const { icon, warnings } = svgToVectorIcon(g);
    expect(icon.sub).toHaveLength(0);
    expect(warnings.some((w) => /stroke-only/.test(w))).toBe(true);
  });

  // GCP toolkits (Cloud Run, BigQuery, GKE, ...) paint via CSS classes in a <style> block
  // rather than inline fills. Without class resolution these glyphs convert to solid black.
  it('resolves fills from <style> CSS classes (class="st1" -> .st1 { fill })', () => {
    const g = `<svg viewBox="0 0 512 512">
      <defs><style>.st0 { fill: none; } .st1 { fill: #4285f4; } .st2 { fill: #34a853; }</style></defs>
      <g id="bounding_box"><rect class="st0" width="512" height="512"/></g>
      <g id="art">
        <path class="st1" d="M0 0L512 0L512 512Z"/>
        <path class="st2" d="M0 0L0 512L512 512Z"/>
      </g>
    </svg>`;
    const { icon } = svgToVectorIcon(g);
    // the fill:none bounding box is dropped; two colored art paths remain, each its class color
    expect(icon.sub).toHaveLength(2);
    expect(icon.sub[0]!.fill).toBe('#4285f4');
    expect(icon.sub[1]!.fill).toBe('#34a853');
  });

  // Azure gradients often define a base gradient with stops, then reference it from a stop-less
  // gradient via SVG2 `href` (e.g. Application Gateway). The reference must inherit the base stops.
  it('resolves a gradient that inherits its stops via href', () => {
    const g = `<svg viewBox="0 0 10 10">
      <defs>
        <linearGradient id="base"><stop offset="0" stop-color="#111"/><stop offset="1" stop-color="#eee"/></linearGradient>
        <linearGradient id="ref" x1="0" y1="0" x2="0" y2="1" href="#base"/>
      </defs>
      <rect x="0" y="0" width="10" height="10" fill="url(#ref)"/>
    </svg>`;
    const { icon, warnings } = svgToVectorIcon(g);
    expect(icon.sub[0]!.fill).toBe('#eee'); // mid stop of the inherited pair
    expect(warnings.some((w) => /unresolved paint/.test(w))).toBe(false);
  });

  it('lets an inline fill override a CSS class on the same element', () => {
    const g = `<svg viewBox="0 0 10 10">
      <defs><style>.c { fill: #111; }</style></defs>
      <path class="c" d="M0 0L10 0L10 10Z" fill="#eee"/>
    </svg>`;
    // presentation attr is lower precedence than the class rule per CSS cascade
    expect(svgToVectorIcon(g).icon.sub[0]!.fill).toBe('#111');
  });
});
