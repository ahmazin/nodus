/**
 * The six semantic infra node types. Each registers through the public `NodeUtil` interface —
 * proof the core is general. A single factory covers all six; only the type key differs (accent
 * color comes from the theme's `byType`, not from code here).
 */

import { Rectangle2d, type DrawApi, type Geometry2d, type NodeRecord, type NodeUtil, type Port, type ResolvedTokens, type Theme } from '@nodus/core';
import { INFRA_TYPES, type InfraKind, infraTypeKey } from './theme.js';

const NODE_H = 46;
const CHAR_W = 6.3; // approx monospace advance at 10.5px
const H_PAD = 26;
const ICON_SPACE = 26;

/** infra kind -> icon glyph name (from the core icon registry). */
const KIND_ICON: Record<InfraKind, string> = {
  service: 'server',
  db: 'database',
  cache: 'cache',
  queue: 'queue',
  lb: 'balancer',
  edge: 'globe',
};

function infraNodeUtil(kind: InfraKind): NodeUtil {
  const type = infraTypeKey(kind);
  const iconName = KIND_ICON[kind];
  return {
    type,
    getDefaultProps: () => ({ kind }),
    getDefaultSize: () => ({ w: 138, h: NODE_H }),
    measure(node: NodeRecord): { w: number; h: number } {
      const label = node.label ?? kind;
      return { w: Math.max(112, Math.round(H_PAD * 2 + ICON_SPACE + label.length * CHAR_W)), h: NODE_H };
    },
    getGeometry(node: NodeRecord): Geometry2d {
      return new Rectangle2d({ x: node.x, y: node.y, w: node.w, h: node.h });
    },
    getPorts(): Port[] {
      return [
        { id: 'in', kind: 'target', anchor: { x: 0, y: 0.5 } },
        { id: 'out', kind: 'source', anchor: { x: 1, y: 0.5 } },
      ];
    },
    draw(api: DrawApi, node: NodeRecord, tokens: ResolvedTokens): void {
      const box = { x: node.x, y: node.y, w: node.w, h: node.h };
      api.fillRoundRect(box, tokens.radius, tokens.fill, {
        glow: tokens.glow ?? undefined,
        glowBlur: 14,
      });
      api.strokeRoundRect(box, tokens.radius, tokens.stroke, {
        width: tokens.strokeWidth,
        dash: tokens.dash,
      });
      const isLocked = tokens.labelOverride !== undefined;
      if (!isLocked) {
        const is = 18;
        api.icon(iconName, { x: node.x + 12, y: node.y + node.h / 2 - is / 2, w: is, h: is }, tokens.text);
      }
      const label = tokens.labelOverride ?? node.label ?? kind;
      const cx = isLocked ? node.x + node.w / 2 : node.x + 16 + (node.w - 16) / 2;
      api.label(label, { x: cx, y: node.y + node.h / 2 }, { weight: '500' });
    },
  };
}

/** All six infra node utils, keyed by their type string (`infra.service`, ...). */
export const infraNodeUtils: NodeUtil[] = INFRA_TYPES.map(infraNodeUtil);

export { NODE_H };

// keep the Theme import referenced (used by the preset install typing elsewhere)
export type { Theme };
