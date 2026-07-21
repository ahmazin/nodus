/**
 * The six semantic infra node types. Each registers through the public `NodeUtil` interface —
 * proof the core is general. A single factory covers all six; only the type key differs (accent
 * color comes from the theme's `byType`, not from code here).
 *
 * They render "symbol-forward": a large glyph on a rounded accent tile with the label beneath it
 * (via the shared `drawStencil`), so an infra diagram reads by symbol at a glance.
 */

import {
  Rectangle2d,
  STENCIL,
  drawStencil,
  measureStencil,
  type DrawApi,
  type Geometry2d,
  type NodeRecord,
  type NodeUtil,
  type Port,
  type ResolvedTokens,
  type Theme,
} from '@nodus/core';
import { classifyIcon } from './classify-icon.js';
import { INFRA_TYPES, type InfraKind, infraTypeKey } from './theme.js';

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
    getDefaultSize: () => ({ w: STENCIL.DEFAULT_W, h: STENCIL.NODE_H }),
    measure(node: NodeRecord): { w: number; h: number } {
      return measureStencil(node.label ?? kind);
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
      // Explicit props.icon wins; else classify the label into a more specific registered glyph;
      // else fall back to the type's default icon. Draw-time only — never written to the record.
      const icon = (node.props.icon as string) ?? classifyIcon(node.label) ?? iconName;
      drawStencil(api, node, tokens, { icon, label: node.label ?? kind });
    },
  };
}

/** All six infra node utils, keyed by their type string (`infra.service`, ...). */
export const infraNodeUtils: NodeUtil[] = INFRA_TYPES.map(infraNodeUtil);

/** Default stencil node height (kept as a named export for consumers of the old constant). */
export const NODE_H = STENCIL.NODE_H;

// keep the Theme import referenced (used by the preset install typing elsewhere)
export type { Theme };
