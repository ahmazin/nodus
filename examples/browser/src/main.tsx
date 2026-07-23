/**
 * Nodus reference editor — the "Playground" product surface built on `@nodus/react`'s shell + design
 * system. A docked three-column layout: a top bar (brand · live-doc · undo/redo · insert pickers ·
 * sketch/flow/theme/search/export), a left tool rail, the canvas, and a right Properties/Source panel.
 *
 * Every control is skinned from one `UiTokens` set (`useUiTokens`) and wired to localStorage autosave
 * + open/save. `window.__editor` stays exposed for the E2E drive; the `data-testid` hooks the verify
 * script relies on (`status`, `tool-select`, `layout`, `minimap`, `type-select`, `tool-create`,
 * `templates-modal`) are preserved on their relocated controls.
 */

import {
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Editor, renderSVG, type NodeUtil, type NodusRecord, type Theme } from '@nodus/core';
import { DescribeDiagram } from './describe-diagram';
import { EmptyState } from './empty-state';
import { SyncInfra } from './sync-infra';
import { ImportEditor } from './import-editor';
import { StatusBar } from './status-bar';
import { PageBar } from './page-bar';
import { analyzeImport, detectImportFormat, type ImportAnalysis, type ImportFormat } from './import-analyze';
import {
  ArrowIcon,
  BranchBar,
  Button,
  CircleIcon,
  CloudIconPicker,
  CodePanel,
  CommandPalette,
  ConnectIcon,
  DiamondIcon,
  EraserIcon,
  HandIcon,
  ImageIcon,
  LayersPanel,
  LineIcon,
  Minimap,
  Nodus,
  Properties,
  SelectIcon,
  ShortcutsDialog,
  SquareIcon,
  StencilLibrary,
  TemplatesGallery,
  TextIcon,
  ThemeToggle,
  ToolPalette,
  UiTokensProvider,
  UndoRedo,
  ZoomControls,
  copyOrDownloadImage,
  copyShareLink,
  copySvg,
  DEFAULT_FLOW,
  defaultCommands,
  exportFlowGIF,
  injectGlobalStyles,
  loadSceneFromLocation,
  openFromFile,
  restoreAutosave,
  saveToFile,
  showToast,
  useAutosave,
  useCurrentTool,
  useUiTokens,
  useValue,
  type Command,
  type ShortcutSection,
  type ToolPaletteEntry,
  type UiTokens,
} from '@nodus/react';
import {
  ACCENTS,
  ACCENTS_LIGHT,
  INFRA_TYPES,
  classifyCategory,
  darkInfraTheme,
  infraLightTheme,
  installInfraPreset,
  modelToRecords,
  type InfraKind,
} from '@nodus/preset-infra';
import { iconNode, imageNode, installDiagrams } from '@nodus/preset-diagrams';
import { cloudIconCatalog, installCloudIcons } from '@nodus/icons-cloud';
import { drawShortcut, installDrawTools, rectShape, ellipseShape, diamondShape } from '@nodus/preset-draw';
import { dagreLayout } from '@nodus/layout-dagre';
import { treeLayout } from '@nodus/layout-tree';
import { forceLayout } from '@nodus/layout-force';
import { elkLayout } from '@nodus/layout-elk';
import { freehandPlugin } from '@nodus/plugin-freehand';
import {
  builtinStencils,
  builtinTemplates,
  parseLibrary,
  serializeLibrary,
  type Stencil,
  type StencilLibrary as StencilLibraryType,
} from '@nodus/stencils';

const AUTOSAVE_KEY = 'nodus-example';
const STENCILS_KEY = 'nodus-stencils';
const DOC_NAME = 'playground.nodus.json';

/**
 * Playground canvas themes: the infra themes with the dot grid bumped to the design's prominence
 * (the renderer paints `theme.canvas.grid` behind every node, so this *is* the dotted background —
 * no DOM overlay needed, and it pans/zooms with the camera for free). Everything else (node colors,
 * states, overlays) is inherited untouched via spread.
 */
const playgroundDark = {
  ...darkInfraTheme,
  canvas: {
    ...darkInfraTheme.canvas,
    fill: '#0a0b0e',
    // Design's dotted backdrop: sage-green dots (peak α 0.14, matching the reference's `dotA`) with
    // accent-lime major lines every 5th cell. `drawGrid` fades both toward the viewport edges, which
    // reproduces the design's radial vignette mask — no DOM overlay needed.
    grid: { color: 'rgba(150,175,140,0.14)', size: 26, major: 'rgba(196,242,78,0.13)', majorEvery: 5 },
  },
};
const playgroundLight = {
  ...infraLightTheme,
  canvas: {
    ...infraLightTheme.canvas,
    grid: { color: 'rgba(10,11,14,0.10)', size: 26, major: 'rgba(120,150,40,0.11)', majorEvery: 5 },
  },
};

/**
 * The four brand-accent choices from the Playground design's `accent` prop. Each carries the dark
 * accent (bright — used directly on the near-black canvas and chrome) plus two darkened light variants:
 * `lightCanvas` for strokes/glows/selection on the paper canvas, and `lightChrome` — a touch darker —
 * for the accent as active *text/icon* in panels (≥4.5:1 on white, mirroring the shipped light lime).
 * Lime is the default and maps to the exact tuned values already in `playgroundDark/Light`.
 */
type AccentKey = 'lime' | 'cyan' | 'coral' | 'violet';
interface AccentOption {
  key: AccentKey;
  label: string;
  dark: string;
  lightCanvas: string;
  lightChrome: string;
}
const ACCENT_OPTIONS: readonly AccentOption[] = [
  { key: 'lime', label: 'Lime', dark: '#c4f24e', lightCanvas: '#4d7c0f', lightChrome: '#3f6212' },
  { key: 'cyan', label: 'Cyan', dark: '#35d0e0', lightCanvas: '#0e7490', lightChrome: '#0e6d84' },
  { key: 'coral', label: 'Coral', dark: '#ff7a5c', lightCanvas: '#c2410c', lightChrome: '#b23a0c' },
  { key: 'violet', label: 'Violet', dark: '#a98bff', lightCanvas: '#7c3aed', lightChrome: '#6d28d9' },
];

/**
 * Build the [dark, light] playground theme pair for a chosen accent. Lime returns the untouched shipped
 * themes (zero regression). Any other accent overlays `palette.accent` (canvas selection/flow/glow) and
 * `palette.accentChrome` (chrome accent, read by `useUiTokens`). Node category hues stay put — the accent
 * is the brand/selection colour, not a node category, so switching it never recolours service/db/queue nodes.
 */
function themesForAccent(key: AccentKey): [Theme, Theme] {
  if (key === 'lime') return [playgroundDark, playgroundLight];
  const opt = ACCENT_OPTIONS.find((o) => o.key === key) ?? ACCENT_OPTIONS[0]!;
  const dark: Theme = { ...playgroundDark, palette: { ...playgroundDark.palette, accent: opt.dark, accentChrome: opt.dark } };
  const light: Theme = { ...playgroundLight, palette: { ...playgroundLight.palette, accent: opt.lightCanvas, accentChrome: opt.lightChrome } };
  return [dark, light];
}

/** Tiny FNV-1a string hash (demo-only determinism helper, not for security) — same edge id always
 *  yields the same synthetic rate across reloads, so the flow-rate pill looks stable rather than
 *  reshuffling on every toggle. */
function fnv1aHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic synthetic flow rate for an edge id, in a plausible ~120-2000 range. The core only
 * draws the flow-rate pill when an edge's resolved `data` is a finite number (see
 * `packages/core/src/editor/index.ts`'s `drawFlowRatePill`); the demo's edges otherwise carry
 * `DEFAULT_FLOW` with no `data`, so toggling Flow would show moving dots but never a rate label. This
 * is demo-only seed data — real usage is `editor.setFlowMetric`/`bindFlowSource` for a live metric.
 */
function syntheticFlowRate(id: string): number {
  return 120 + (fnv1aHash(id) % 1900);
}

/**
 * Load the user's saved stencil library from localStorage, tolerating a missing or corrupt value.
 * `parseLibrary` throws only when the value isn't a stencil library at all (missing key / invalid
 * JSON) — caught here into a fresh default — and otherwise silently drops any individually-corrupt
 * stencil, so one bad entry never wipes the rest.
 */
function loadUserLibrary(): StencilLibraryType {
  try {
    const raw = localStorage.getItem(STENCILS_KEY);
    return raw ? parseLibrary(raw) : { name: 'My stencils', stencils: [] };
  } catch {
    return { name: 'My stencils', stencils: [] };
  }
}

/**
 * Wrap a plain draw-shape util so an untyped shape (rect / ellipse / diamond) with NO explicit stroke
 * picks up its label's category hue — the colour-side twin of the infra glyph classifier, matching the
 * Playground design where every node colours from its label. An explicit Properties stroke pick still
 * wins (we only override when `style.stroke` is unset); the tint is applied at draw time and never
 * written to the record or the serialized diagram. Dark uses the glowing `ACCENTS`; light the darker,
 * label-legible `ACCENTS_LIGHT` (and drops the symmetric glow, which muddies the light canvas).
 */
function categoryColored(util: NodeUtil, editor: Editor): NodeUtil {
  return {
    ...util,
    draw(api, node, tokens) {
      if (!node.style?.stroke) {
        const kind = classifyCategory(node.label);
        if (kind) {
          const dark = editor.themeAtom.peek().appearance !== 'light';
          const hue = (dark ? ACCENTS : ACCENTS_LIGHT)[kind];
          util.draw(api, node, { ...tokens, stroke: hue, text: hue, glow: dark ? hue : tokens.glow });
          return;
        }
      }
      util.draw(api, node, tokens);
    },
  };
}

function buildEditor(): Editor {
  const editor = new Editor({ viewport: { w: 1200, h: 700 } });
  installInfraPreset(editor); // registers infra types + the dark theme (appearance: 'dark')
  installDrawTools(editor);
  // Re-register the whiteboard shapes with a label→category colour fallback (Playground parity). Same
  // type keys, so this overrides installDrawTools' plain utils while keeping their tools/shortcuts.
  for (const shape of [rectShape, ellipseShape, diamondShape]) {
    editor.registerNodeType(categoryColored(shape, editor));
  }
  installCloudIcons();
  editor.registerNodeType(iconNode);
  editor.registerNodeType(imageNode); // 'diagram.image' — raster insert / paste target
  editor.use(freehandPlugin); // registers the 'freehand' node type + pen tool (plugin API only)
  editor.registerLayout(dagreLayout);
  editor.registerLayout(treeLayout);
  editor.registerLayout(forceLayout);
  editor.registerLayout(elkLayout); // also the default engine for Mermaid import

  const records = modelToRecords({
    nodes: [
      { key: 'cdn', type: 'edge', label: 'CDN / Edge', x: 40, y: 300 },
      { key: 'lb', type: 'lb', label: 'Load Balancer', x: 250, y: 300 },
      { key: 'gw', type: 'service', label: 'API Gateway', x: 470, y: 180 },
      { key: 'auth', type: 'service', label: 'Auth Service', x: 470, y: 320, focused: true },
      { key: 'orders', type: 'service', label: 'Orders API', x: 470, y: 460 },
      { key: 'redis', type: 'cache', label: 'Redis', x: 720, y: 180, overlay: 'met' },
      { key: 'pg', type: 'db', label: 'Postgres', x: 720, y: 330, overlay: 'partial' },
      { key: 'kafka', type: 'queue', label: 'Kafka', x: 720, y: 480, overlay: 'missed' },
      { key: 'pay', type: 'service', label: 'Payments', x: 980, y: 260, state: 'solid' },
      { key: 'legacy', type: 'service', label: 'Legacy', x: 980, y: 420, state: 'locked' },
    ],
    edges: [
      { from: 'cdn', to: 'lb' },
      { from: 'lb', to: 'gw' },
      { from: 'lb', to: 'auth' },
      { from: 'lb', to: 'orders' },
      { from: 'gw', to: 'redis' },
      { from: 'auth', to: 'pg' },
      { from: 'orders', to: 'pg' },
      { from: 'orders', to: 'kafka' },
      { from: 'orders', to: 'pay' },
      { from: 'pay', to: 'legacy' },
    ],
  });
  editor.loadSnapshot({ schemaVersion: 1, document: { records } }, { fit: true });
  editor.setTheme(playgroundDark); // apply the prominent-grid variant on top of the preset's dark theme
  // Idle shimmer intentionally left OFF: it kept the canvas repainting ~38×/s even while idle, which —
  // behind the glass backdrop-filter chrome — is a needless, continuous compositing cost. The canvas
  // now paints only in response to real interaction/animation.
  // expose for e2e verification
  (window as unknown as { __editor: Editor }).__editor = editor;
  return editor;
}

/**
 * A 120×120 `feTurbulence` noise tile, inlined as a `data:` URI so the film-grain overlay (Change 3
 * below) needs no asset file. Tiled + panned via the `nd-grain` CSS animation (index.html) to read as
 * a faint, moving grain rather than a static repeating pattern.
 */
const GRAIN_SVG =
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">
      <filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" /></filter>
      <rect width="100%" height="100%" filter="url(#n)" />
    </svg>`,
  )}`;

/** `#rrggbb` -> `rgba(r,g,b,alpha)`. Tokens only expose the accent as a hex string, but the cursor-glow
 *  spotlight (Change 4 below) needs a translucent radial-gradient stop. Assumes a well-formed 6-digit
 *  hex, true of both Playground themes' `accent` values. */
function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Read a File as a `data:` URI (self-contained, canonical-serializable image source). */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

/** Decode an image to get its intrinsic pixel size. */
function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('decode failed'));
    img.src = dataUrl;
  });
}

/** Pencil glyph for the freehand tool — matches the shell's stroke-based, 24×24 `currentColor` icon set. */
function PenIcon({ size = 16 }: { size?: number }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}
    >
      <path d="M4 20l1-4 10-10a2 2 0 0 1 3 3L8 19z" />
      <path d="M13.5 6.5l3.5 3.5" />
    </svg>
  );
}

/** A 2×2 tile grid — the left-rail trigger for the cloud-icon picker (reads as an "asset library"). */
function CloudGridIcon({ size = 17 }: { size?: number }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}
    >
      <rect x="3" y="3" width="7" height="7" rx="1.6" />
      <rect x="14" y="3" width="7" height="7" rx="1.6" />
      <rect x="3" y="14" width="7" height="7" rx="1.6" />
      <rect x="14" y="14" width="7" height="7" rx="1.6" />
    </svg>
  );
}

/** The 3-circle Nodus glyph from the design's top bar, tinted from tokens (accent node + two outlined). */
function NodusLogo({ t }: { t: UiTokens }): ReactElement {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: 'block' }}>
      <circle cx="5" cy="6.5" r="2.5" style={{ fill: t.color.accent }} />
      <circle cx="18.5" cy="6" r="2.3" style={{ stroke: t.color.text }} strokeWidth={1.6} />
      <circle cx="12" cy="18" r="2.5" style={{ stroke: t.color.text }} strokeWidth={1.6} />
      <path
        d="M6.7 8 L10.6 15.8 M17 8 L13.3 15.8 M7.4 6.4 L16.2 6"
        style={{ stroke: t.color.borderStrong }}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Chevron-down for the Export dropdown / picker triggers. */
function ChevronIcon(): ReactElement {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 9l7 7 7-7" />
    </svg>
  );
}

/** Magnifier for the "Search ⌘K" button. */
function SearchIcon(): ReactElement {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.2-3.2" strokeLinecap="round" />
    </svg>
  );
}

/** Right-arrow flow glyph for the Flow toggle. */
function FlowGlyph(): ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <path d="M4 12h16M13 5l7 7-7 7" />
    </svg>
  );
}

/** Hierarchy glyph for the persistent auto-layout (arrange) action. */
function LayoutGlyph(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="5" rx="1" />
      <rect x="3" y="16" width="6" height="5" rx="1" />
      <rect x="15" y="16" width="6" height="5" rx="1" />
      <path d="M12 8v3M12 11H6v5M12 11h6v5" />
    </svg>
  );
}

/** Documented shortcuts, matching what this app actually binds. */
const SHORTCUTS: ShortcutSection[] = [
  {
    title: 'Tools',
    items: [
      { keys: 'V', description: 'Select / move' },
      { keys: 'R', description: 'Rectangle' },
      { keys: 'E', description: 'Ellipse' },
      { keys: 'D', description: 'Diamond' },
      { keys: 'T', description: 'Text' },
      { keys: 'L', description: 'Line' },
      { keys: 'A', description: 'Arrow' },
      { keys: 'P', description: 'Draw (freehand)' },
    ],
  },
  {
    title: 'Edit',
    items: [
      { keys: '⌘Z', description: 'Undo' },
      { keys: '⇧⌘Z', description: 'Redo' },
      { keys: ['⌫'], description: 'Delete selection' },
    ],
  },
  {
    title: 'View & files',
    items: [
      { keys: '⌘K', description: 'Command palette' },
      { keys: '?', description: 'This help' },
      { keys: '⌘O', description: 'Open .nodus.json' },
      { keys: '⌘S', description: 'Save .nodus.json' },
    ],
  },
];

/**
 * Token-derived chrome styles for the panels / bars, mirroring the design's `renderVals` builders but
 * sourced from `UiTokens` so everything re-skins with the theme. Built once per render.
 */
function chrome(t: UiTokens): {
  secLabel: CSSProperties;
  statCard: CSSProperties;
  statNum: CSSProperties;
  statLbl: CSSProperties;
  ghBtn: CSSProperties;
  tipRow: CSSProperties;
  kbd: CSSProperties;
  tabStyle: (active: boolean) => CSSProperties;
  topBtn: (active: boolean) => CSSProperties;
  iconBtn: CSSProperties;
  menuItem: CSSProperties;
  menuHint: CSSProperties;
  divider: CSSProperties;
} {
  return {
    secLabel: {
      fontFamily: t.font.mono,
      fontSize: '10.5px',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: t.color.textFaint,
      margin: '18px 0 9px',
    },
    statCard: {
      flex: 1,
      background: t.color.canvas,
      border: `1px solid ${t.color.border}`,
      borderRadius: t.radius.lg,
      padding: 12,
    },
    statNum: { fontFamily: t.font.mono, fontSize: '22px', fontWeight: 700, color: t.color.text },
    statLbl: { fontSize: t.font.size.sm, color: t.color.textFaint, marginTop: 2 },
    ghBtn: {
      height: 34,
      borderRadius: t.radius.md,
      border: `1px solid ${t.color.borderStrong}`,
      background: 'transparent',
      color: t.color.text,
      cursor: 'pointer',
      fontSize: t.font.size.md,
      fontFamily: t.font.mono,
    },
    tipRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      fontSize: '12.5px',
      color: t.color.textMuted,
    },
    kbd: {
      fontFamily: t.font.mono,
      fontSize: '10.5px',
      color: t.color.textFaint,
      border: `1px solid ${t.color.borderStrong}`,
      borderRadius: 5,
      padding: '2px 6px',
    },
    tabStyle: (active) => ({
      // Horizontal padding kept tight (6px) so all four tabs fit the 266px panel with a few px of slack
      // and never clip the last one — "Properties" alone is ~89px, and four tabs at the old 12px padding
      // overflowed by ~39px (measured), pushing "Insert" under the panel's overflow:hidden edge.
      padding: '9px 6px',
      border: 'none',
      borderBottom: `2px solid ${active ? t.color.accent : 'transparent'}`,
      background: 'transparent',
      color: active ? t.color.text : t.color.textMuted,
      fontSize: t.font.size.md,
      fontWeight: 500,
      fontFamily: t.font.family,
      whiteSpace: 'nowrap',
      cursor: 'pointer',
    }),
    topBtn: (active) => ({
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 32,
      padding: '0 11px',
      borderRadius: t.radius.md,
      cursor: 'pointer',
      fontSize: '12.5px',
      fontWeight: 500,
      fontFamily: t.font.family,
      border: `1px solid ${active ? t.color.accent : t.color.borderStrong}`,
      background: active ? t.color.selection : 'transparent',
      color: active ? t.color.accent : t.color.textMuted,
    }),
    iconBtn: {
      width: 32,
      height: 32,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: t.radius.md,
      border: `1px solid ${t.color.borderStrong}`,
      background: 'transparent',
      color: t.color.textMuted,
      cursor: 'pointer',
    },
    menuItem: {
      display: 'flex',
      alignItems: 'center',
      width: '100%',
      padding: '8px 10px',
      borderRadius: 7,
      border: 'none',
      background: 'transparent',
      color: t.color.text,
      fontSize: t.font.size.md,
      fontFamily: t.font.family,
      cursor: 'pointer',
    },
    menuHint: { marginLeft: 'auto', fontFamily: t.font.mono, fontSize: '10.5px', color: t.color.textFaint },
    divider: { width: 1, height: 20, background: t.color.border, flexShrink: 0 },
  };
}

/**
 * Full-screen modal (portal + backdrop) hosting the always-rendered `TemplatesGallery`. Mirrors the
 * shell's `ShortcutsDialog` overlay pattern: fixed backdrop, Escape / backdrop-click to dismiss.
 * `onBeforeOpen` guards against clobbering unsaved work; confirming both proceeds *and* closes the
 * modal (which is what "close after a template opens" means from the user's side).
 */
function TemplatesModal({ editor, open, onClose }: { editor: Editor; open: boolean; onClose: () => void }): ReactElement | null {
  const t = useUiTokens(editor);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      data-nodus-ui=""
      data-testid="templates-modal"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: t.space(4),
        background: 'rgba(0,0,0,0.45)',
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Templates"
        style={{
          width: 'min(760px, 100%)',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          background: t.color.panel,
          color: t.color.text,
          border: `1px solid ${t.color.border}`,
          borderRadius: t.radius.lg,
          boxShadow: t.shadow.popover,
          fontFamily: t.font.family,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: `${t.space(2.5)}px ${t.space(3)}px`,
            borderBottom: `1px solid ${t.color.border}`,
          }}
        >
          <strong style={{ fontSize: t.font.size.md }}>Templates</strong>
          <Button variant="ghost" aria-label="Close templates" onClick={onClose}>
            Close
          </Button>
        </div>
        <div style={{ overflowY: 'auto', padding: t.space(3) }}>
          <TemplatesGallery
            editor={editor}
            templates={builtinTemplates}
            onBeforeOpen={() => {
              const ok = window.confirm('Replace the current diagram?');
              if (ok) onClose();
              return ok;
            }}
            style={{ border: 'none', boxShadow: 'none', background: 'transparent', padding: 0 }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function App(): ReactElement {
  const editor = useMemo(buildEditor, []);
  const t = useUiTokens(editor);
  const c = chrome(t);
  const [helpOpen, setHelpOpen] = useState(false);
  const [createType, setCreateType] = useState<InfraKind>('service');
  const [sketchOn, setSketchOn] = useState(false);
  const [flowOn, setFlowOn] = useState(() => editor.hasFlow());
  const [userLibrary, setUserLibrary] = useState<StencilLibraryType>(loadUserLibrary);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [tab, setTab] = useState<'props' | 'source' | 'layers' | 'insert'>('props');
  const [exportOpen, setExportOpen] = useState(false);
  const [accent, setAccent] = useState<AccentKey>('lime');
  const [accentOpen, setAccentOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  // The [dark, light] playground theme pair for the chosen accent — rebuilt only when the accent changes.
  const [darkTheme, lightTheme] = useMemo(() => themesForAccent(accent), [accent]);
  // Apply the accent live: swap in whichever rebuilt theme matches the current appearance. Runs on mount
  // too (accent 'lime' → the untouched playgroundDark, matching buildEditor's initial setTheme).
  useEffect(() => {
    const isLight = editor.themeAtom.peek().appearance === 'light';
    editor.setTheme(isLight ? lightTheme : darkTheme);
  }, [editor, darkTheme, lightTheme]);
  const [describeOpen, setDescribeOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importInitial, setImportInitial] = useState<ImportFormat | undefined>(undefined);
  // Empty-state onboarding card: shown once on a zero-node doc, dismissible, and the dismissal
  // persists across reloads (private-mode localStorage failures just mean it reappears next time).
  const [onboardDismissed, setOnboardDismissed] = useState(() => {
    try {
      return localStorage.getItem('nodus.onboarding.dismissed') === '1';
    } catch {
      return false;
    }
  });
  const dismissOnboarding = useCallback((): void => {
    try {
      localStorage.setItem('nodus.onboarding.dismissed', '1');
    } catch {
      // best-effort: private mode / quota — the card just reappears next visit
    }
    setOnboardDismissed(true);
  }, []);

  // Status-bar cursor readout: world-space coords of the pointer over the canvas, throttled so a
  // fast mouse move doesn't re-render every event. `null` while the pointer is off the canvas.
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [isPointerDown, setIsPointerDown] = useState(false);
  const [overCanvas, setOverCanvas] = useState(false);
  const canvasWrapperRef = useRef<HTMLDivElement | null>(null);
  // The cursor-glow spotlight is positioned via this ref (a direct `transform` write on each pointer
  // move) rather than React state — so tracking the pointer never re-renders the App tree. Only the
  // throttled status-bar coord readout below still goes through state.
  const glowRef = useRef<HTMLDivElement | null>(null);
  const lastCursorMoveRef = useRef(0);
  const currentTool = useCurrentTool(editor);
  // Hide the glow while it would be distracting: no pointer over the canvas, mid-drag (dragging a
  // node, marquee-selecting, resizing), or while connect/eraser are active (both rely on precise
  // cursor feedback of their own that the glow would compete with). All rarely-changing states — no
  // per-move churn.
  const glowHidden = !overCanvas || isPointerDown || currentTool === 'connect' || currentTool === 'eraser';

  const canvasStyle: CSSProperties = { position: 'absolute', inset: 0 };

  // Restore a previous session if one exists (mount-only; the seed model stands if there's none).
  useEffect(() => {
    try {
      // A shared scene in the URL (#scene=…) takes precedence over the autosaved session.
      if (!loadSceneFromLocation(editor)) restoreAutosave(editor, AUTOSAVE_KEY, { fit: true });
    } catch {
      showToast('Could not restore the last session', 'error', { mode: editor.themeAtom.peek().appearance ?? 'dark' });
    }
  }, [editor]);

  useAutosave(editor, { key: AUTOSAVE_KEY });

  // Persist the user's stencil library (canonical, diff-stable JSON) whenever it changes.
  useEffect(() => {
    try {
      localStorage.setItem(STENCILS_KEY, serializeLibrary(userLibrary));
    } catch {
      // best-effort: ignore quota / serialization failures in the demo
    }
  }, [userLibrary]);

  // Keyboard: tool shortcuts (draw preset) + undo/redo/delete + `?` help. (⌘K is owned by
  // <CommandPalette>'s own listener.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (editor.editingAtom.peek()) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.metaKey || e.ctrlKey) {
        const k = e.key.toLowerCase();
        if (k === 'z') {
          e.preventDefault();
          e.shiftKey ? editor.redo() : editor.undo();
        } else if (k === 's') {
          e.preventDefault();
          saveToFile(editor);
        } else if (k === 'o') {
          e.preventDefault();
          void openFromFile(editor).catch(() => showToast('Not a valid Nodus file', 'error', { mode: t.mode }));
        }
        return;
      }

      if (e.key === '?') {
        setHelpOpen(true);
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const ids = editor.selectedIdsArray();
        if (ids.length) {
          e.preventDefault();
          editor.deleteRecords(ids);
        }
        return;
      }
      if (e.key === 'p' || e.key === 'P') {
        editor.setTool('freehand');
        return;
      }
      drawShortcut(editor, e.key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor, t.mode]);

  const selCount = useValue(() => editor.selectedAtom.get().size);
  const nodeCount = useValue(() => (editor.sceneIndex.version.get(), editor.store.nodes().length));
  const edgeCount = useValue(() => (editor.sceneIndex.version.get(), editor.store.edges().length));

  const insertImage = useCallback((): void => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void (async () => {
        try {
          const src = await fileToDataUrl(file);
          const { width, height } = await imageSize(src);
          const max = 320;
          const scale = Math.min(1, max / Math.max(width, height));
          const w = Math.round(width * scale) || 160;
          const h = Math.round(height * scale) || 120;
          const vp = editor.worldViewport();
          editor.createNode({
            type: 'diagram.image',
            x: vp.x + vp.w / 2 - w / 2,
            y: vp.y + vp.h / 2 - h / 2,
            w,
            h,
            props: { src, naturalWidth: width, naturalHeight: height, alt: file.name, fit: 'contain' },
          });
        } catch {
          showToast('Could not insert that image', 'error', { mode: t.mode });
        }
      })();
    };
    input.click();
  }, [editor, t.mode]);

  const openFile = useCallback((): void => {
    void openFromFile(editor).catch(() => showToast('Not a valid Nodus file', 'error', { mode: t.mode }));
  }, [editor, t.mode]);

  // Importers — add the parsed records in one undoable step, reindex, then lay out + fit. These are
  // the same programmatic importers the CLI/MCP use; a prompt() paste is enough for the reference app.
  const runImport = useCallback(
    (records: NodusRecord[], layoutId: string, direction: 'TB' | 'LR' | 'RL' | 'BT' = 'LR'): void => {
      if (records.length === 0) {
        showToast('Nothing to import from that input', 'error', { mode: t.mode });
        return;
      }
      editor.store.apply(
        records.map((record) => ({ op: 'add' as const, record })),
        { capture: 'immediately' }, // one undo entry for the whole import
      );
      editor.sceneIndex.rebuild(editor.store.allRecords());
      void editor.layout(layoutId, { direction }).then(() => editor.zoomToFit(48));
    },
    [editor, t.mode],
  );

  // The three format-locked buttons/commands and the unified auto-detect entry all open the same
  // analysis-driven modal; `openImport` sets which format it's pinned to (undefined = auto-detect).
  const openImport = useCallback((f?: ImportFormat): void => {
    setImportInitial(f);
    setImportOpen(true);
  }, []);
  const importMermaidFlow = useCallback((): void => openImport('mermaid'), [openImport]);
  const importTerraformFlow = useCallback((): void => openImport('terraform'), [openImport]);
  const importKubernetesFlow = useCallback((): void => openImport('kubernetes'), [openImport]);

  // Commit an already-parsed analysis: ensure the needed node types exist, then add + lay out (one undo).
  const commitImport = useCallback(
    (analysis: ImportAnalysis): void => {
      if (analysis.format === 'mermaid' && !editor.nodes.has('process')) installDiagrams(editor);
      runImport(analysis.records, analysis.format === 'mermaid' ? 'elk' : 'dagre', analysis.direction);
    },
    [editor, runImport],
  );

  const runLayout = useCallback(
    (id: string): void => {
      void editor.layout(id, { direction: 'LR' }).then(() => editor.zoomToFit(48));
    },
    [editor],
  );

  // Global hand-drawn toggle: applies the seeded 'sketchy' roughness to every node's style bag
  // (per-element roughness survives theme swaps). Fine-grained control stays in Properties.
  const toggleSketch = useCallback((): void => {
    const next = !sketchOn;
    setSketchOn(next);
    editor.setStyle(
      editor.store.nodes().map((n) => n.id),
      { roughness: next ? 1.6 : 0 },
    );
  }, [editor, sketchOn]);

  // Global flow toggle: turn animated flow on/off for every edge at once. Turning it ON also seeds a
  // deterministic, per-edge synthetic `flow.data` (demo-only — real usage is `editor.setFlowMetric`/
  // `bindFlowSource`) so the core's rate pill has a numeric value to format; without it every edge
  // would share one `DEFAULT_FLOW` object with no `data`, and the pill never appears. One `store.apply`
  // call keeps the whole toggle a single undo entry, matching `editor.setFlow`'s own grouping. Per-edge
  // authoring stays in the Properties FlowControls.
  const toggleFlow = useCallback((): void => {
    const next = !flowOn;
    setFlowOn(next);
    const edges = editor.store.edges();
    if (!edges.length) return;
    if (next) {
      editor.store.apply(
        edges.map((e) => ({ op: 'update' as const, id: e.id, patch: { flow: { ...DEFAULT_FLOW, data: syntheticFlowRate(e.id) } } })),
        { capture: 'immediately' },
      );
    } else {
      editor.setFlow(edges.map((e) => e.id), null);
    }
  }, [editor, flowOn]);

  const exportPNG = useCallback((): void => {
    void copyOrDownloadImage(editor, { selection: editor.selectedIdsArray().length > 0 });
  }, [editor]);

  const exportSVG = useCallback((): void => {
    // animateFlow keeps any live flow moving in the exported .svg (a no-op when no edge has flow).
    const blob = new Blob([renderSVG(editor, { animateFlow: true })], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'diagram.svg';
    a.click();
    URL.revokeObjectURL(a.href);
  }, [editor]);

  const exportGIF = useCallback(async (): Promise<void> => {
    try {
      const blob = await exportFlowGIF(editor);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'diagram.gif';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      showToast('Nothing to export — the diagram is empty', 'error', { mode: t.mode });
    }
  }, [editor, t.mode]);

  const copySource = useCallback((): void => {
    try {
      void navigator.clipboard.writeText(JSON.stringify(editor.toJSON(), null, 2));
      showToast('Copied .nodus.json', 'ok', { mode: t.mode });
    } catch {
      showToast('Could not copy the source', 'error', { mode: t.mode });
    }
  }, [editor, t.mode]);

  const shareLink = useCallback(async (): Promise<void> => {
    const ok = await copyShareLink(editor);
    showToast(ok ? 'Copied a share link' : 'Could not copy the link', ok ? 'ok' : 'error', { mode: t.mode });
  }, [editor, t.mode]);

  const copySvgToClipboard = useCallback(async (): Promise<void> => {
    const ok = await copySvg(editor);
    showToast(ok ? 'Copied SVG to clipboard' : 'Could not copy SVG', ok ? 'ok' : 'error', { mode: t.mode });
  }, [editor, t.mode]);

  // The "Search ⌘K" button opens the palette via the shared `nodus:open-command-palette` window
  // event (Lane D added the listener inside <CommandPalette>); ⌘K itself is bound by the component.
  const openPalette = useCallback((): void => {
    window.dispatchEvent(new Event('nodus:open-command-palette'));
  }, []);

  // ⌘K command set: the shell defaults (tools/edit/arrange/layouts/copy-image) plus the relocated
  // features so everything is reachable from the palette too.
  const commands = useMemo<Command[]>(
    () => [
      ...defaultCommands(editor),
      { id: 'import.auto', title: 'Import diagram…', group: 'Import', run: () => openImport() },
      { id: 'import.mermaid', title: 'Import Mermaid…', group: 'Import', run: importMermaidFlow },
      { id: 'import.terraform', title: 'Import Terraform (show -json)…', group: 'Import', run: importTerraformFlow },
      { id: 'import.kubernetes', title: 'Import Kubernetes (JSON)…', group: 'Import', run: importKubernetesFlow },
      { id: 'insert.image', title: 'Insert image…', group: 'Insert', run: insertImage },
      { id: 'insert.template', title: 'Add template…', group: 'Insert', run: () => setTemplatesOpen(true) },
      { id: 'insert.create', title: `Create ${createType} node`, group: 'Insert', run: () => editor.setTool('create', { type: `infra.${createType}` }) },
      { id: 'ai.describe', title: 'Describe a diagram (AI)…', group: 'Insert', run: () => setDescribeOpen(true) },
      { id: 'infra.sync', title: 'Sync from infra source (drift)…', group: 'Import', run: () => setSyncOpen(true) },
      { id: 'view.sketch', title: sketchOn ? 'Disable hand-drawn (Sketch)' : 'Enable hand-drawn (Sketch)', group: 'View', run: toggleSketch },
      { id: 'view.flow', title: flowOn ? 'Stop animated flow' : 'Animate flow', group: 'View', run: toggleFlow },
      { id: 'export.svg', title: 'Export SVG (vector)', group: 'Export', run: exportSVG },
      { id: 'export.gif', title: 'Export animated flow (GIF)', group: 'Export', run: () => void exportGIF() },
      { id: 'export.copySource', title: 'Copy source (.nodus.json)', group: 'Export', run: copySource },
      { id: 'file.open', title: 'Open .nodus.json…', hint: '⌘O', group: 'File', run: openFile },
      { id: 'file.save', title: 'Save .nodus.json', hint: '⌘S', group: 'File', run: () => saveToFile(editor) },
      { id: 'help.shortcuts', title: 'Keyboard shortcuts', hint: '?', group: 'Help', run: () => setHelpOpen(true) },
    ],
    [
      editor,
      openImport,
      importMermaidFlow,
      importTerraformFlow,
      importKubernetesFlow,
      insertImage,
      createType,
      sketchOn,
      flowOn,
      toggleSketch,
      toggleFlow,
      exportSVG,
      exportGIF,
      copySource,
      openFile,
    ],
  );

  // The left tool rail — config-driven, so it stays preset-agnostic. Eraser only if registered.
  const tools = useMemo<ToolPaletteEntry[]>(() => {
    const list: ToolPaletteEntry[] = [
      { id: 'select', label: 'Select', toolId: 'select', icon: <SelectIcon />, shortcut: 'V', testId: 'tool-select' },
      { id: 'hand', label: 'Pan', toolId: 'hand', icon: <HandIcon /> },
      'divider',
      { id: 'rect', label: 'Rectangle', toolId: 'create', config: { type: 'draw.rect' }, icon: <SquareIcon />, shortcut: 'R' },
      { id: 'ellipse', label: 'Ellipse', toolId: 'create', config: { type: 'draw.ellipse' }, icon: <CircleIcon />, shortcut: 'E' },
      { id: 'diamond', label: 'Diamond', toolId: 'create', config: { type: 'draw.diamond' }, icon: <DiamondIcon />, shortcut: 'D' },
      { id: 'text', label: 'Text', toolId: 'create', config: { type: 'draw.text' }, icon: <TextIcon />, shortcut: 'T' },
      'divider',
      { id: 'line', label: 'Line', toolId: 'line', config: { type: 'draw.line' }, icon: <LineIcon />, shortcut: 'L' },
      { id: 'arrow', label: 'Arrow', toolId: 'line', config: { type: 'draw.arrow' }, icon: <ArrowIcon />, shortcut: 'A' },
      { id: 'connect', label: 'Connect nodes', toolId: 'connect', icon: <ConnectIcon /> },
      'divider',
      { id: 'freehand', label: 'Draw', toolId: 'freehand', icon: <PenIcon />, shortcut: 'P' },
    ];
    if (editor.toolManager.has('eraser')) {
      list.push({ id: 'eraser', label: 'Eraser', toolId: 'eraser', icon: <EraserIcon /> });
    }
    return list;
  }, [editor]);

  const railStyle: CSSProperties = {
    position: 'static',
    background: 'transparent',
    border: 'none',
    boxShadow: 'none',
    borderRadius: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 3,
    padding: '9px 0',
    width: '100%',
  };

  return (
    <UiTokensProvider tokens={t}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: t.color.canvas, color: t.color.text, fontFamily: t.font.family }}>
        {/* ===== TOP BAR ===== */}
        <header
          role="toolbar"
          aria-label="Editor toolbar"
          style={{
            height: 52,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0 12px',
            borderBottom: `1px solid ${t.color.border}`,
            background: t.color.glass,
            backdropFilter: `blur(${t.blur}) saturate(1.4)`,
            WebkitBackdropFilter: `blur(${t.blur}) saturate(1.4)`,
            position: 'relative',
            zIndex: 40,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px' }}>
            <NodusLogo t={t} />
            <span style={{ fontWeight: 600, fontSize: t.font.size.lg, letterSpacing: '-0.01em', color: t.color.text }}>Nodus</span>
            <span
              style={{
                fontFamily: t.font.mono,
                fontSize: '9.5px',
                color: t.color.textFaint,
                border: `1px solid ${t.color.borderStrong}`,
                borderRadius: 4,
                padding: '1px 4px',
              }}
            >
              play
            </span>
          </span>
          <span style={c.divider} />
          {/* Live-doc indicator: pulsing green dot + filename, then the live node/selection status. */}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: t.font.mono, fontSize: '12.5px', color: t.color.textMuted, minWidth: 0 }}>
            <span className="nd-pulse-dot" style={{ width: 7, height: 7, borderRadius: 99, background: '#4ac26b', flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{DOC_NAME}</span>
          </span>
          <span data-testid="status" style={{ fontSize: t.font.size.xs, color: t.color.textFaint, whiteSpace: 'nowrap' }}>
            {nodeCount} nodes · {selCount} selected
          </span>
          <UndoRedo editor={editor} />
          {/* Git-native: working tree vs an in-app "main" baseline — live +adds/−dels + a review/diff modal. */}
          <BranchBar editor={editor} />

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7 }}>
            {/* Persistent auto-layout (dagre). Always visible so it's reachable regardless of the
                right panel's Properties/Scene state; the fuller engine picker lives in the Scene panel. */}
            <button type="button" data-testid="layout" onClick={() => runLayout('dagre')} title="Auto-layout (dagre)" aria-label="Auto-layout" style={c.iconBtn}>
              <LayoutGlyph />
            </button>
            <button
              type="button"
              onClick={toggleSketch}
              aria-pressed={sketchOn}
              title="Toggle a hand-drawn (sketchy) look for the whole diagram"
              style={c.topBtn(sketchOn)}
            >
              <span style={{ fontSize: 14 }}>✎</span> Sketch
            </button>
            <button
              type="button"
              onClick={toggleFlow}
              aria-pressed={flowOn}
              title="Animate flow along every edge"
              style={c.topBtn(flowOn)}
            >
              <FlowGlyph /> Flow
            </button>
            <ThemeToggle editor={editor} light={lightTheme} dark={darkTheme} />
            {/* Accent picker — the design's `accent` prop. Retints selection/flow/glow + chrome; a 4-swatch
                popover. Category node hues are deliberately independent of it. */}
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setAccentOpen((o) => !o)}
                aria-expanded={accentOpen}
                title="Accent colour"
                style={{ ...c.iconBtn, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <span style={{ width: 14, height: 14, borderRadius: '50%', background: t.color.accent, boxShadow: `0 0 0 2px ${t.color.selection}` }} />
              </button>
              {accentOpen && (
                <>
                  <div onPointerDown={() => setAccentOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 49 }} />
                  <div
                    className="nd-pop"
                    style={{ position: 'absolute', right: 0, top: 38, display: 'flex', gap: 6, padding: 8, background: t.color.panel, border: `1px solid ${t.color.borderStrong}`, borderRadius: t.radius.lg, boxShadow: t.shadow.popover, zIndex: 50 }}
                  >
                    {ACCENT_OPTIONS.map((o) => (
                      <button
                        key={o.key}
                        type="button"
                        title={o.label}
                        aria-pressed={accent === o.key}
                        onClick={() => { setAccent(o.key); setAccentOpen(false); }}
                        style={{ width: 24, height: 24, borderRadius: 7, cursor: 'pointer', background: o.dark, border: `2px solid ${accent === o.key ? t.color.text : 'transparent'}` }}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
            {/* Text ↔ canvas source: the dedicated wide code panel (replaces the right panel while open). */}
            <button
              type="button"
              onClick={() => setCodeOpen((o) => !o)}
              aria-pressed={codeOpen}
              title="Text ↔ canvas source"
              style={c.topBtn(codeOpen)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ stroke: 'currentColor' }} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M8 6l-5 6 5 6M16 6l5 6-5 6" /></svg>
            </button>
            <span style={c.divider} />
            <button
              type="button"
              onClick={openPalette}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                height: 32,
                padding: '0 10px',
                borderRadius: t.radius.md,
                border: `1px solid ${t.color.borderStrong}`,
                background: t.color.canvas,
                color: t.color.textMuted,
                fontSize: '12.5px',
                fontFamily: t.font.family,
                cursor: 'pointer',
              }}
            >
              <SearchIcon /> Search{' '}
              <span style={{ fontFamily: t.font.mono, fontSize: '10.5px', border: `1px solid ${t.color.borderStrong}`, borderRadius: 4, padding: '1px 5px' }}>⌘K</span>
            </button>
            <div style={{ position: 'relative' }}>
              <button type="button" onClick={() => setExportOpen((o) => !o)} aria-expanded={exportOpen} style={{ ...c.topBtn(exportOpen), fontWeight: 500 }}>
                Export <ChevronIcon />
              </button>
              {exportOpen && (
                <>
                  {/* click-away backdrop */}
                  <div onPointerDown={() => setExportOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 49 }} />
                  <div
                    className="nd-pop"
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: 38,
                      width: 200,
                      background: t.color.panel,
                      border: `1px solid ${t.color.borderStrong}`,
                      borderRadius: t.radius.lg,
                      padding: 6,
                      boxShadow: t.shadow.popover,
                      zIndex: 50,
                    }}
                  >
                    <button type="button" style={c.menuItem} onClick={() => { setExportOpen(false); exportPNG(); }}>
                      PNG <span style={c.menuHint}>.png</span>
                    </button>
                    <button type="button" style={c.menuItem} onClick={() => { setExportOpen(false); exportSVG(); }}>
                      SVG vector <span style={c.menuHint}>.svg</span>
                    </button>
                    <button type="button" style={c.menuItem} onClick={() => { setExportOpen(false); void exportGIF(); }}>
                      Animated flow <span style={c.menuHint}>.gif</span>
                    </button>
                    <div style={{ height: 1, background: t.color.border, margin: '5px 4px' }} />
                    <button type="button" style={c.menuItem} onClick={() => { setExportOpen(false); copySource(); }}>
                      Copy source <span style={c.menuHint}>.nodus.json</span>
                    </button>
                    <button type="button" style={c.menuItem} onClick={() => { setExportOpen(false); void shareLink(); }}>
                      Copy share link <span style={c.menuHint}>#scene</span>
                    </button>
                    <button type="button" style={c.menuItem} onClick={() => { setExportOpen(false); void copySvgToClipboard(); }}>
                      Copy SVG <span style={c.menuHint}>clipboard</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* ===== MAIN ROW ===== */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
          {/* LEFT RAIL */}
          <div
            style={{
              width: 50,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              borderRight: `1px solid ${t.color.border}`,
              background: t.color.glass,
              backdropFilter: `blur(${t.blur}) saturate(1.4)`,
              WebkitBackdropFilter: `blur(${t.blur}) saturate(1.4)`,
              zIndex: 30,
            }}
          >
            {/* Cloud-icon library — a rail asset picker whose popover floats out over the canvas. */}
            <div style={{ paddingTop: 9 }}>
              <CloudIconPicker
                editor={editor}
                catalog={cloudIconCatalog}
                variant="popover"
                triggerTitle="Cloud icons"
                triggerContent={<CloudGridIcon />}
                triggerStyle={{
                  width: 34,
                  height: 34,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: t.radius.md,
                  // longhand (not the `border` shorthand) so the picker's open-state `borderColor`
                  // accent doesn't trip React's shorthand/longhand style-conflict warning
                  borderWidth: 1,
                  borderStyle: 'solid',
                  borderColor: 'transparent',
                  background: 'transparent',
                  color: t.color.textMuted,
                  cursor: 'pointer',
                }}
              />
            </div>
            <div style={{ width: 22, height: 1, background: t.color.border, margin: '6px 0' }} />
            <ToolPalette editor={editor} tools={tools} style={railStyle} />
          </div>

          {/* CANVAS */}
          <div
            ref={canvasWrapperRef}
            style={{ flex: 1, position: 'relative', overflow: 'hidden' }}
            onPointerMove={(e) => {
              const rect = canvasWrapperRef.current?.getBoundingClientRect();
              if (!rect) return;
              const sx = e.clientX - rect.left;
              const sy = e.clientY - rect.top;
              // Position the glow directly (no React state) so pointer tracking never re-renders.
              const g = glowRef.current;
              if (g) g.style.transform = `translate3d(${sx - 240}px, ${sy - 240}px, 0)`;
              if (!overCanvas) setOverCanvas(true);
              // Only the status-bar coord readout needs React — throttle it so movement stays light.
              const now = performance.now();
              if (now - lastCursorMoveRef.current < 50) return;
              lastCursorMoveRef.current = now;
              setCursor(editor.screenToWorld({ x: sx, y: sy }));
            }}
            onPointerLeave={() => {
              setCursor(null);
              setOverCanvas(false);
            }}
            onPointerDown={() => setIsPointerDown(true)}
            onPointerUp={() => setIsPointerDown(false)}
          >
            {/* The dotted background is the renderer's own camera-synced `theme.canvas.grid` (painted
                behind every node), so no DOM overlay is needed here. */}
            <Nodus editor={editor} style={canvasStyle} imageNodeType="diagram.image" />

            {/* Film-grain atmosphere (Change 3): a static feTurbulence tile, panned by the `nd-grain`
                keyframes in index.html (which the `prefers-reduced-motion` block there disables). Purely
                cosmetic — inset:0 + pointer-events:none so it never intercepts canvas interaction, and a
                z-index below the floating controls/EmptyState (both 15) so it never visually competes. */}
            <div
              aria-hidden="true"
              className="nd-grain"
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 5,
                pointerEvents: 'none',
                opacity: 0.05,
                mixBlendMode: 'overlay',
                backgroundImage: `url("${GRAIN_SVG}")`,
                backgroundSize: '120px 120px',
              }}
            />

            {/* Cursor-following glow spotlight (Change 4): an accent-tinted radial gradient centered on
                the pointer, reusing the same throttled screen-space tracking as the status-bar cursor
                readout above. Hidden (opacity 0, no display flip needed) while off-canvas, mid-drag, or
                while connect/eraser are active — see `glowHidden`. */}
            <div
              ref={glowRef}
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: 480,
                height: 480,
                borderRadius: '50%',
                zIndex: 6,
                pointerEvents: 'none',
                mixBlendMode: 'screen',
                background: `radial-gradient(circle, ${hexToRgba(t.color.accent, 0.1)} 0%, transparent 70%)`,
                opacity: glowHidden ? 0 : 1,
                transition: 'opacity 150ms ease',
                willChange: 'transform',
              }}
            />

            {nodeCount === 0 && !onboardDismissed && (
              <EmptyState editor={editor} onDismiss={dismissOnboarding} onCommandPalette={openPalette} />
            )}

            <div style={{ position: 'absolute', left: 14, bottom: 14, zIndex: 15 }}>
              <ZoomControls
                editor={editor}
                style={{
                  background: t.color.glass,
                  backdropFilter: `blur(${t.blur}) saturate(1.4)`,
                  WebkitBackdropFilter: `blur(${t.blur}) saturate(1.4)`,
                }}
              />
            </div>

            <div
              data-testid="minimap"
              style={{
                position: 'absolute',
                right: 14,
                bottom: 14,
                zIndex: 15,
                border: `1px solid ${t.color.border}`,
                borderRadius: t.radius.lg,
                overflow: 'hidden',
                background: t.color.glass,
                backdropFilter: `blur(${t.blur}) saturate(1.4)`,
                WebkitBackdropFilter: `blur(${t.blur}) saturate(1.4)`,
                boxShadow: t.shadow.panel,
              }}
            >
              <Minimap editor={editor} width={200} height={130} />
            </div>

            <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 14, zIndex: 15 }}>
              <PageBar editor={editor} />
            </div>
          </div>

          {/* RIGHT PANEL — hidden while the dedicated wide code panel is open */}
          {!codeOpen && (
          <div
            style={{
              width: 266,
              flexShrink: 0,
              borderLeft: `1px solid ${t.color.border}`,
              background: t.color.glass,
              backdropFilter: `blur(${t.blur}) saturate(1.4)`,
              WebkitBackdropFilter: `blur(${t.blur}) saturate(1.4)`,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              zIndex: 30,
            }}
          >
            <div style={{ display: 'flex', padding: '8px 6px 0', gap: 3, borderBottom: `1px solid ${t.color.border}` }}>
              <button type="button" onClick={() => setTab('props')} style={c.tabStyle(tab === 'props')} aria-pressed={tab === 'props'}>
                Properties
              </button>
              <button type="button" onClick={() => setTab('source')} style={c.tabStyle(tab === 'source')} aria-pressed={tab === 'source'}>
                Source
              </button>
              <button type="button" onClick={() => setTab('layers')} style={c.tabStyle(tab === 'layers')} aria-pressed={tab === 'layers'}>
                Layers
              </button>
              <button type="button" data-testid="tab-insert" onClick={() => setTab('insert')} style={c.tabStyle(tab === 'insert')} aria-pressed={tab === 'insert'}>
                Insert
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
              {tab === 'props' ? (
                selCount > 0 ? (
                  <Properties
                    editor={editor}
                    style={{ position: 'static', width: '100%', background: 'transparent', border: 'none', boxShadow: 'none', borderRadius: 0 }}
                  />
                ) : (
                  <div style={{ padding: '16px 15px' }}>
                    <div style={{ fontSize: t.font.size.lg, fontWeight: 600, color: t.color.text }}>Scene</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <div style={c.statCard}>
                        <div style={c.statNum}>{nodeCount}</div>
                        <div style={c.statLbl}>nodes</div>
                      </div>
                      <div style={c.statCard}>
                        <div style={c.statNum}>{edgeCount}</div>
                        <div style={c.statLbl}>edges</div>
                      </div>
                    </div>

                    <div style={c.secLabel}>Auto-layout</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      <button type="button" style={c.ghBtn} onClick={() => runLayout('dagre')}>
                        dagre
                      </button>
                      <button type="button" style={c.ghBtn} onClick={() => runLayout('tree')}>
                        tree
                      </button>
                      <button type="button" style={c.ghBtn} onClick={() => runLayout('force')}>
                        force
                      </button>
                      <button type="button" style={c.ghBtn} onClick={() => runLayout('elk')}>
                        elk
                      </button>
                    </div>

                    <div style={c.secLabel}>Import</div>
                    <button
                      type="button"
                      data-testid="import-auto"
                      style={{ ...c.ghBtn, width: '100%', marginBottom: 6 }}
                      onClick={() => openImport()}
                    >
                      Import diagram…
                    </button>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" style={{ ...c.ghBtn, flex: 1 }} onClick={importMermaidFlow}>
                        Mermaid
                      </button>
                      <button type="button" style={{ ...c.ghBtn, flex: 1 }} onClick={importTerraformFlow}>
                        Terraform
                      </button>
                      <button type="button" style={{ ...c.ghBtn, flex: 1 }} onClick={importKubernetesFlow}>
                        K8s
                      </button>
                    </div>
                    <button
                      type="button"
                      data-testid="scene-sync"
                      style={{ ...c.ghBtn, marginTop: 6, color: t.color.accent, borderColor: t.color.accent }}
                      onClick={() => setSyncOpen(true)}
                    >
                      ⟳ Sync from infra source (drift)
                    </button>

                    <div style={c.secLabel}>Insert</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <select
                        data-testid="type-select"
                        aria-label="Infra node type"
                        value={createType}
                        onChange={(e) => {
                          const next = e.target.value as InfraKind;
                          setCreateType(next);
                          if (editor.currentToolId === 'create') editor.setTool('create', { type: `infra.${next}` });
                        }}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          height: 34,
                          padding: `0 ${t.space(1.5)}px`,
                          borderRadius: t.radius.md,
                          border: `1px solid ${t.color.borderStrong}`,
                          background: t.color.canvas,
                          color: t.color.text,
                          fontFamily: t.font.mono,
                          fontSize: t.font.size.sm,
                        }}
                      >
                        {INFRA_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        data-testid="tool-create"
                        style={{ ...c.ghBtn, padding: '0 14px', color: t.color.accent, borderColor: t.color.accent }}
                        onClick={() => editor.setTool('create', { type: `infra.${createType}` })}
                      >
                        Create
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <button type="button" style={{ ...c.ghBtn, flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} onClick={insertImage}>
                        <ImageIcon /> Image
                      </button>
                      <button type="button" style={{ ...c.ghBtn, flex: 1 }} onClick={() => setTemplatesOpen(true)}>
                        Templates
                      </button>
                    </div>
                    <p style={{ fontSize: t.font.size.xs, color: t.color.textFaint, lineHeight: 1.5, margin: '10px 0 0' }}>
                      Cloud icons and stencils live in the <strong style={{ color: t.color.textMuted, fontWeight: 600 }}>Insert</strong> tab.
                      Drag a tile onto the canvas, or use a shape tool then click to place.
                    </p>

                    <div style={c.secLabel}>Shortcuts</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      <div style={c.tipRow}>
                        <span>Command palette</span>
                        <span style={c.kbd}>⌘K</span>
                      </div>
                      <div style={c.tipRow}>
                        <span>Select tool</span>
                        <span style={c.kbd}>V</span>
                      </div>
                      <div style={c.tipRow}>
                        <span>Rectangle / Diamond</span>
                        <span style={c.kbd}>R / D</span>
                      </div>
                      <div style={c.tipRow}>
                        <span>Delete selected</span>
                        <span style={c.kbd}>Del</span>
                      </div>
                      <div style={c.tipRow}>
                        <span>Undo</span>
                        <span style={c.kbd}>⌘Z</span>
                      </div>
                      <div style={c.tipRow}>
                        <span>Zoom</span>
                        <span style={c.kbd}>⌘ + scroll</span>
                      </div>
                    </div>
                    <p style={{ fontSize: t.font.size.sm, color: t.color.textFaint, lineHeight: 1.5, margin: '16px 0 0' }}>
                      Click a shape tool, then click the canvas to place a node. Double-click a node to rename. Drag to
                      move, corners to resize. Press <span style={c.kbd}>?</span> for all shortcuts.
                    </p>
                  </div>
                )
              ) : tab === 'source' ? (
                // Live, editable `.nodus.json`. Type valid JSON → the canvas rebuilds; a parse error
                // shows a red line and leaves the canvas untouched; canvas edits flow back into the text.
                <CodePanel editor={editor} style={{ height: '100%' }} />
              ) : tab === 'layers' ? (
                // Scene tree: select · inline-rename · hide/show · lock · reorder, synced to the canvas.
                <LayersPanel editor={editor} style={{ height: '100%' }} />
              ) : (
                // Insert tab — always available (not selection-gated). Hosts the browsable palettes
                // whose popovers can't fit the narrow docked panel, rendered in their inline variant.
                <div style={{ padding: '16px 15px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ fontSize: t.font.size.lg, fontWeight: 600, color: t.color.text }}>Insert</div>
                  <p style={{ fontSize: t.font.size.xs, color: t.color.textFaint, lineHeight: 1.5, margin: 0 }}>
                    Open a palette, then drag a tile onto the canvas — or click a tile to drop it at the viewport center.
                  </p>
                  <button
                    type="button"
                    data-testid="insert-describe"
                    onClick={() => setDescribeOpen(true)}
                    style={{ ...c.ghBtn, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, color: t.color.accent, borderColor: t.color.accent }}
                  >
                    ✦ Describe a diagram (AI)
                  </button>
                  <CloudIconPicker editor={editor} catalog={cloudIconCatalog} variant="inline" />
                  <StencilLibrary
                    editor={editor}
                    libraries={[builtinStencils, userLibrary]}
                    onSaveSelection={(s: Stencil) => {
                      setUserLibrary((lib) => ({ ...lib, stencils: [...lib.stencils, s] }));
                    }}
                    variant="inline"
                  />
                </div>
              )}
            </div>
          </div>
          )}
          {codeOpen && (
            <div
              style={{
                width: 'min(430px, 45vw)',
                flexShrink: 0,
                borderLeft: `1px solid ${t.color.border}`,
                background: t.color.glass,
                backdropFilter: `blur(${t.blur}) saturate(1.4)`,
                WebkitBackdropFilter: `blur(${t.blur}) saturate(1.4)`,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                zIndex: 30,
              }}
            >
              <CodePanel editor={editor} style={{ height: '100%', border: 'none', borderRadius: 0, background: 'transparent' }} />
            </div>
          )}
        </div>

        <StatusBar editor={editor} cursor={cursor} nodeCount={nodeCount} selCount={selCount} />

        {/* ===== OVERLAYS ===== */}
        <CommandPalette editor={editor} commands={commands} />
        <ShortcutsDialog editor={editor} open={helpOpen} onClose={() => setHelpOpen(false)} sections={SHORTCUTS} />
        <TemplatesModal editor={editor} open={templatesOpen} onClose={() => setTemplatesOpen(false)} />
        <DescribeDiagram
          editor={editor}
          open={describeOpen}
          onClose={() => setDescribeOpen(false)}
          onGenerated={(records) => runImport(records, 'dagre')}
        />
        <SyncInfra editor={editor} open={syncOpen} onClose={() => setSyncOpen(false)} />
        <ImportEditor
          editor={editor}
          open={importOpen}
          initialFormat={importInitial}
          detect={detectImportFormat}
          analyze={analyzeImport}
          onClose={() => setImportOpen(false)}
          onImport={commitImport}
        />
      </div>
    </UiTokensProvider>
  );
}

injectGlobalStyles();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
