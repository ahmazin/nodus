/**
 * @nodus/core — a headless, framework-agnostic, extensible Canvas-2D diagram engine.
 */

// model
export * from './model.js';

// data-driven flow
export { resolveFlow, colorForValue } from './flow.js';

// errors
export { NodusError, isNodusError, type NodusErrorCode } from './errors/index.js';

// ids
export { sessionIdFactory, deterministicIdFactory, type IdFactory } from './ids/index.js';

// reactivity
export {
  atom,
  computed,
  effect,
  reaction,
  batch,
  transact,
  untrack,
  setEffectErrorHandler,
  type Atom,
  type Computed,
  type Dispose,
  type Eq,
  type EffectErrorHandler,
} from './signals/index.js';

// geometry
export {
  Geometry2d,
  Rectangle2d,
  Ellipse2d,
  Polygon2d,
  Polyline2d,
  vec,
  add,
  sub,
  scale,
  len,
  dist,
  boxCenter,
  boxContains,
  boxIntersects,
  boxEncloses,
  unionBox,
  padBox,
  distToSegment,
  IDENTITY,
  matMul,
  applyMat,
  invertMat,
  type RectOpts,
} from './geometry/index.js';

// camera
export {
  DEFAULT_CAMERA,
  worldToScreen,
  screenToWorld,
  renderMatrix,
  viewportWorldBounds,
  zoomAt,
  panByScreen,
  fitBox,
  clamp,
} from './camera/index.js';

// theme
export {
  resolveTokens,
  defaultTheme,
  defaultLightTheme,
  type Theme,
  type StateTokens,
  type ResolvedTokens,
} from './theme/index.js';
export {
  lightTheme,
  blueprintTheme,
  neonTheme,
  paperTheme,
  pisTheme,
  themePack,
} from './theme/presets.js';

// routing
export {
  RouterRegistry,
  straightRouter,
  orthogonalRouter,
  bezierRouter,
  defaultRouters,
  segmentHitsBoxInterior,
  type Router,
  type RouteContext,
} from './routing/index.js';

// store
export { Store, type ChangeInfo, type StoreListener, type BeforeApply } from './store/index.js';

// commands
export { CommandRegistry, installDefaultCommands, type Command } from './commands/index.js';

// scene index
export { SceneIndex, type RenderItem, type SceneIndexDeps } from './scene-index/index.js';

// registries
export {
  Registry,
  DEFAULT_CAPABILITIES,
  validateNodeUtil,
  validateEdgeUtil,
  type RegistryOptions,
  type NodeUtil,
  type EdgeUtil,
  type Migration,
  type Port,
  type NodeCapabilities,
  type EdgeRouteContext,
  type NodeRegistry,
  type EdgeRegistry,
} from './registries/index.js';

// diff
export { diff, type DiffResult, type RecordChange } from './diff/index.js';

// history
export { History, type ApplyFn } from './history/index.js';

// events
export {
  EventBus,
  type NodusEvent,
  type NodusEventMap,
  type NodusEventOf,
  type NodusCustomEvent,
  type NodusErrorEvent,
  type ErrorEventContext,
  type EventBusOptions,
} from './events/index.js';

// layout
export type {
  LayoutEngine,
  LayoutGraph,
  LayoutGraphNode,
  LayoutGraphEdge,
  LayoutOptions,
  LayoutResult,
  LayoutDirection,
} from './layout/index.js';

// plugins
export type { Plugin, EngineHost, OverlayLayer, FrameContext } from './plugins/index.js';

// tools
export {
  ToolNode,
  ToolManager,
  SelectTool,
  HandTool,
  CreateNodeTool,
  ConnectTool,
  defaultTools,
  type PointerInfo,
  type KeyInfo,
} from './tools/index.js';

// builtins
export { rectNodeUtil, lineEdgeUtil, groupNodeUtil, drawEdgeLabel } from './builtins/index.js';

// renderer
export { DrawApi, type FillOpts, type StrokeOpts, type LabelOpts, type ImageOpts } from './renderer/draw-api.js';
export type { Ctx2D, CanvasGradientLike, DrawableImage } from './renderer/context.js';
export { fillBackground, drawGrid, paintItem, strokeWorldBox, fillHandle, setPaintErrorHandler } from './renderer/paint.js';
export { SVGContext } from './renderer/svg-context.js';
export { renderSVG, type RenderSVGOptions } from './renderer/svg-export.js';
export { drawStencil, measureStencil, STENCIL, type StencilOpts } from './renderer/stencil.js';
export { drawVectorIcon, OP, type VectorIcon, type VectorSubpath } from './icons/vector.js';

// icons
export {
  registerIcon,
  getIcon,
  getIconMeta,
  drawIcon,
  iconNames,
  installDefaultIcons,
  type IconDraw,
  type IconMeta,
} from './icons/index.js';

// serialization
export {
  serializeRecords,
  restore,
  SCHEMA_VERSION,
  stableStringify,
  toCanonicalString,
  compareRecords,
  type Snapshot,
  type RestoreResult,
  type RestoreOptions,
} from './serialization/index.js';

// editor
export {
  Editor,
  type EditorOptions,
  type PointerMods,
  type ConnectDraft,
  type SnapConfig,
  type Guide,
  type ResizeHandle,
  type ToPNGOptions,
  type CreateCanvas,
  type ExportCanvas,
  type AlignEdge,
  type DistributeAxis,
  type Presentation,
} from './editor/index.js';

// animation
export {
  linear,
  easeOutCubic,
  easeInOutCubic,
  type Easing,
  type TweenSpec,
} from './editor/animation.js';
