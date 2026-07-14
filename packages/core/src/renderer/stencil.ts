/**
 * `drawStencil` — a reusable "symbol-forward" node renderer: a large glyph on a rounded accent tile
 * with the label BELOW it (the AWS/Azure architecture-diagram convention), instead of a small icon
 * badge inside a labeled box. Generic and domain-agnostic — presets pass the glyph name + label and
 * the tile/glyph/label all derive from the node box + theme tokens, so resizing scales the glyph.
 */

import { getIconMeta } from '../icons/index.js';
import type { NodeRecord } from '../model.js';
import type { ResolvedTokens } from '../theme/index.js';
import type { DrawApi } from './draw-api.js';

const TILE = 54; // glyph tile side at the default size
const GAP = 4; // gap between tile and label band
const LABEL_BAND = 16; // reserved height for the label under the tile

/** Layout constants + the default square-ish node size for stencil nodes. */
export const STENCIL = {
  TILE,
  GAP,
  LABEL_BAND,
  NODE_H: TILE + GAP + LABEL_BAND, // 74
  DEFAULT_W: 74,
  /** Approx monospace advance at the theme's label size — used by `measureStencil`. */
  CHAR_W: 6.3,
} as const;

export interface StencilOpts {
  /** Registered glyph name to render on the tile. */
  icon: string;
  /** Resolved label text (before any token `labelOverride`). */
  label: string;
}

/** Grow width to fit the label; height is fixed at the stencil default. */
export function measureStencil(label: string): { w: number; h: number } {
  return {
    w: Math.max(STENCIL.DEFAULT_W, Math.round(label.length * STENCIL.CHAR_W + 16)),
    h: STENCIL.NODE_H,
  };
}

/** Paint a stencil node: accent tile + centered glyph + label below. Honors locked (`labelOverride`). */
export function drawStencil(api: DrawApi, node: NodeRecord, tokens: ResolvedTokens, opts: StencilOpts): void {
  // The tile is a centered square filling the space above the label band; it scales with the node.
  const tile = Math.max(0, Math.min(node.w, node.h - LABEL_BAND - GAP));
  const tileBox = {
    x: node.x + (node.w - tile) / 2,
    y: node.y,
    w: tile,
    h: tile,
  };

  api.fillRoundRect(tileBox, tokens.radius, tokens.fill, {
    glow: tokens.glow ?? undefined,
    glowBlur: 14,
  });
  api.strokeRoundRect(tileBox, tokens.radius, tokens.stroke, {
    width: tokens.strokeWidth,
    dash: tokens.dash,
  });

  // Locked nodes hide the glyph and show the override label ('?').
  const locked = tokens.labelOverride !== undefined;
  if (!locked && tile > 0) {
    const inset = tile * 0.22;
    const glyphBox = { x: tileBox.x + inset, y: tileBox.y + inset, w: tile - 2 * inset, h: tile - 2 * inset };
    if (getIconMeta(opts.icon)?.needsChip) {
      const cp = tile * 0.1;
      api.fillRoundRect(
        { x: glyphBox.x - cp, y: glyphBox.y - cp, w: glyphBox.w + 2 * cp, h: glyphBox.h + 2 * cp },
        Math.max(2, tokens.radius * 0.6),
        '#f5f6f8',
      );
    }
    api.icon(opts.icon, glyphBox, tokens.text, tokens.stroke);
  }

  const text = tokens.labelOverride ?? opts.label;
  api.label(text, { x: node.x + node.w / 2, y: node.y + node.h - LABEL_BAND / 2 }, { weight: '500' });
}
