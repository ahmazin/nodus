/**
 * Plugins & events (extensibility Axis 4). A `Plugin` receives an `EngineHost` — the public
 * extension surface — and registers node/edge types, tools, layouts, themes, overlays, and
 * event/store hooks, returning a disposer. Mode adapters (Freeform/Reveal/Stages) are just
 * plugins. `OverlayLayer`s are composited canvases (ghost/reveal/stage layers) painted per frame.
 */

import type { Dispose } from '../signals/index.js';
import type { Camera } from '../model.js';
import type { Theme } from '../theme/index.js';
import type { NodeUtil, EdgeUtil } from '../registries/index.js';
import type { LayoutEngine } from '../layout/index.js';
import type { NodusEvent, NodusEventMap, NodusEventOf, NodusCustomEvent } from '../events/index.js';
import type { StoreListener, BeforeApply } from '../store/index.js';
import type { Command } from '../commands/index.js';
import type { Ctx2D } from '../renderer/context.js';
import type { ToolNode } from '../tools/index.js';
import type { Editor } from '../editor/index.js';

export interface FrameContext {
  ctx: Ctx2D;
  camera: Camera;
  dpr: number;
  cssW: number;
  cssH: number;
  theme: Theme;
  editor: Editor;
}

export interface OverlayLayer {
  id: string;
  /** Paint onto the overlay. The world transform is already applied to `frame.ctx`. */
  paint(frame: FrameContext): void;
}

export interface EngineHost {
  registerNodeType(util: NodeUtil): void;
  registerEdgeType(util: EdgeUtil): void;
  registerTool(tool: ToolNode): void;
  registerLayout(engine: LayoutEngine): void;
  setTheme(theme: Theme): void;
  addOverlay(overlay: OverlayLayer): Dispose;
  /** Subscribe to the event bus; the handler payload is narrowed by key (`'*'` receives every event,
   *  a `custom:${string}` key its custom arm). The trailing `string` overload keeps forwarders that
   *  carry an untyped event name type-checking. */
  on<K extends keyof NodusEventMap>(type: K, handler: (event: NodusEventOf<K>) => void): Dispose;
  on(type: `custom:${string}`, handler: (event: NodusCustomEvent) => void): Dispose;
  on(type: '*', handler: (event: NodusEvent) => void): Dispose;
  on(type: string, handler: (event: NodusEvent) => void): Dispose;
  /** Subscribe to raw store changes (for constraints, snapping, derived data). */
  onChange(handler: StoreListener): Dispose;
  /** Register a before-apply interceptor (transform / veto changes before they commit). */
  onBeforeChange(fn: BeforeApply): Dispose;
  /** Contribute a command to the editor's command registry. */
  registerCommand(cmd: Command): Dispose;
  readonly editor: Editor;
}

export interface Plugin {
  id: string;
  register(host: EngineHost): Dispose | void;
}
