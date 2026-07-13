/**
 * `InfraCanvas({ model, mode, overlays })` — the seed spec's north-star API, as a thin facade over
 * the core `Editor`. Accepts a friendly model (semantic type + world coords), wires the chosen mode
 * adapter, and returns `{ editor, render, toPNG, toJSON, on }` (+ `unlock`/`advance` per mode).
 */

import {
  Editor,
  STENCIL,
  makeId,
  measureStencil,
  type Ctx2D,
  type CreateCanvas,
  type Dispose,
  type Endpoint,
  type NodeState,
  type NodusRecord,
  type ToPNGOptions,
} from '@nodus/core';
import { installInfraPreset } from './install.js';
import { INFRA_TYPES, type InfraKind } from './theme.js';
import { freeformMode, revealMode, stagesMode, type RevealController, type StagesController } from './adapters.js';

export interface InfraNodeSpec {
  id?: string;
  key?: string;
  type: InfraKind | string;
  label?: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  state?: NodeState;
  overlay?: string;
  focused?: boolean;
}

export interface InfraEdgeSpec {
  from: string;
  to: string;
  type?: string;
  state?: NodeState;
}

export interface InfraModel {
  nodes: InfraNodeSpec[];
  edges?: InfraEdgeSpec[];
}

export type InfraMode = 'freeform' | 'reveal' | 'stages';

export interface InfraCanvasOptions {
  model: InfraModel;
  mode?: InfraMode;
  /** key (or id) -> overlay name (`met` | `partial` | `missed` | custom). */
  overlays?: Record<string, string>;
  revealed?: string[];
  viewport?: { w: number; h: number };
}

export interface InfraCanvasHandle {
  editor: Editor;
  render(ctx: Ctx2D, cssW: number, cssH: number, dpr?: number, interactive?: boolean): void;
  toPNG(create: CreateCanvas, opts?: ToPNGOptions): Promise<Uint8Array>;
  toJSON(): unknown;
  on(type: string, handler: (event: unknown) => void): Dispose;
  /** reveal mode only */
  unlock?(key: string): void;
  /** stages mode only */
  advance?(records: NodusRecord[]): void;
  dispose(): void;
}

const isInfraKind = (t: string): t is InfraKind => (INFRA_TYPES as readonly string[]).includes(t);

export function modelToRecords(model: InfraModel, overlays?: Record<string, string>): NodusRecord[] {
  const idMap = new Map<string, string>();
  const records: NodusRecord[] = [];
  let z = 0;

  for (const spec of model.nodes) {
    const type = isInfraKind(spec.type) ? `infra.${spec.type}` : spec.type;
    const id = spec.id ?? makeId('node');
    if (spec.key) idMap.set(spec.key, id);
    idMap.set(spec.id ?? id, id);
    const overlayName = overlays?.[spec.key ?? spec.id ?? ''] ?? spec.overlay;
    records.push({
      id: id as NodusRecord['id'],
      typeName: 'node',
      version: 0,
      type,
      x: spec.x,
      y: spec.y,
      w: spec.w ?? measureStencil(spec.label ?? String(spec.type)).w,
      h: spec.h ?? STENCIL.NODE_H,
      z: (z++).toString(36).padStart(10, '0'),
      visual: {
        state: spec.state ?? 'accent',
        ...(overlayName ? { overlay: overlayName } : {}),
        ...(spec.focused ? { focused: true } : {}),
      },
      ...(spec.label !== undefined ? { label: spec.label } : {}),
      props: spec.key ? { key: spec.key } : {},
    } as NodusRecord);
  }

  for (const e of model.edges ?? []) {
    const from = idMap.get(e.from);
    const to = idMap.get(e.to);
    if (!from || !to) continue;
    const fromEp: Endpoint = { kind: 'node', nodeId: from as `node:${string}`, portId: 'out' };
    const toEp: Endpoint = { kind: 'node', nodeId: to as `node:${string}`, portId: 'in' };
    records.push({
      id: makeId('edge'),
      typeName: 'edge',
      version: 0,
      type: e.type ?? 'infra.connector',
      from: fromEp,
      to: toEp,
      visual: { state: e.state ?? 'solid' },
      props: {},
    });
  }
  return records;
}

export function InfraCanvas(opts: InfraCanvasOptions): InfraCanvasHandle {
  const editor = new Editor({ viewport: opts.viewport ?? { w: 1200, h: 720 } });
  installInfraPreset(editor);
  const records = modelToRecords(opts.model, opts.overlays);
  editor.loadSnapshot({ schemaVersion: 1, document: { records } }, { fit: true });

  let reveal: RevealController | undefined;
  let stages: StagesController | undefined;
  const mode = opts.mode ?? 'freeform';
  if (mode === 'reveal') reveal = revealMode(editor, opts.revealed ?? []);
  else if (mode === 'stages') stages = stagesMode(editor);
  else freeformMode(editor);

  return {
    editor,
    render: (ctx, w, h, dpr = 1, interactive = false) => editor.render(ctx, w, h, dpr, interactive),
    toPNG: (create, o) => editor.toPNG(create, o),
    toJSON: () => editor.toJSON(),
    on: (type, handler) => editor.on(type, handler as never),
    ...(reveal ? { unlock: (key: string) => reveal!.unlock(key) } : {}),
    ...(stages ? { advance: (recs: NodusRecord[]) => stages!.advance(recs) } : {}),
    dispose: () => {
      stages?.dispose();
      editor.dispose();
    },
  };
}
