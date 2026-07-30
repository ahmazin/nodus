/**
 * The three arena mode adapters, built on the generalized `{state, overlay, focused}` model and
 * the one `diff()` engine — all through the public API, zero core edits.
 *
 *  - Freeform (Studio): plain select/create/connect.
 *  - Reveal (Reverse):  nodes are `locked` (label `?`) until `unlock(key)` reveals them.
 *  - Stages (Evolution): advancing to a new snapshot renders the previous one as a ghost overlay.
 */

import {
  diff,
  resolveTokens,
  type Dispose,
  type Editor,
  type FrameContext,
  type Id,
  type NodeRecord,
  type NodusRecord,
  type OverlayLayer,
} from '@ahmazin/core';

export function freeformMode(editor: Editor): Dispose {
  editor.setTool('select');
  return () => {};
}

export interface RevealController {
  unlock(key: string): void;
  reset(): void;
}

/** Lock every keyed node until its key is unlocked. Real state is stashed in `meta.realState`. */
export function revealMode(editor: Editor, revealed: Iterable<string> = []): RevealController {
  const revealedSet = new Set(revealed);
  const apply = (): void => {
    for (const n of editor.store.nodes()) {
      const key = (n.props.key ?? n.meta?.key) as string | undefined;
      if (!key) continue;
      const real = (n.meta?.realState as NodeRecord['visual']['state']) ?? n.visual.state;
      const nextState = revealedSet.has(key) ? real : 'locked';
      if (n.visual.state !== nextState || n.meta?.realState === undefined) {
        editor.updateNode(
          n.id,
          {
            visual: { ...n.visual, state: nextState },
            meta: { ...n.meta, realState: real, key },
          },
          { capture: 'never' },
        );
      }
    }
  };
  apply();
  return {
    unlock(key: string): void {
      revealedSet.add(key);
      apply();
    },
    reset(): void {
      revealedSet.clear();
      apply();
    },
  };
}

export interface StagesController {
  /** Advance to a new stage: diff against the current scene, then load it; the removed/changed
   *  records from the previous stage render as ghosts underneath. */
  advance(records: NodusRecord[]): void;
  dispose: Dispose;
}

export function stagesMode(editor: Editor): StagesController {
  let ghosts: NodeRecord[] = [];
  const overlay: OverlayLayer = {
    id: 'infra.stages.ghost',
    paint(frame: FrameContext): void {
      for (const g of ghosts) {
        const util = editor.nodes.get(g.type);
        if (!util) continue;
        const tokens = resolveTokens(frame.theme, { state: 'ghost' }, g.type);
        frame.ctx.save();
        frame.ctx.globalAlpha *= tokens.opacity;
        frame.ctx.fillStyle = tokens.fill;
        frame.ctx.strokeStyle = tokens.stroke;
        frame.ctx.lineWidth = tokens.strokeWidth;
        roundRect(frame.ctx, g.x, g.y, g.w, g.h, tokens.radius);
        frame.ctx.fill();
        frame.ctx.stroke();
        frame.ctx.restore();
      }
    },
  };
  const disposeOverlay = editor.addOverlay(overlay);

  return {
    advance(records: NodusRecord[]): void {
      const prev = editor.store.allRecords();
      const d = diff(prev, records);
      const prevById = new Map<string, NodusRecord>(prev.map((r) => [r.id, r]));
      const ghostIds = new Set<Id>([...d.removed, ...d.changed.map((c) => c.id)]);
      ghosts = [...ghostIds]
        .map((id) => prevById.get(id))
        .filter((r): r is NodeRecord => !!r && r.typeName === 'node');
      editor.loadSnapshot({ schemaVersion: 1, document: { records } });
    },
    dispose: disposeOverlay,
  };
}

function roundRect(
  ctx: FrameContext['ctx'],
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
