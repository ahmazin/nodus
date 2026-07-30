'use client';
// ^ Marks this package as a React Server Components boundary module (Next.js App Router). It applies
// directly to the source-first dev loop (Vite serves this file). esbuild STRIPS it when bundling the
// dist ("Module level directives cause errors when bundled"), so tsup.config.ts re-prepends it to the
// built output in an onSuccess hook — see the comment there. Keep this here regardless.

/**
 * @ahmazin/react — a thin React binding for the Nodus engine. This module is the package barrel:
 * the `<Nodus>` host lives in `nodus-host.tsx`; panels, the design-system `ui/*` surface, and the
 * clipboard/PNG helpers are re-exported here. No engine logic lives in this package.
 */

import { type Editor, type Id } from '@ahmazin/core';

// host
export { Nodus, type NodusProps, type NodusHandle } from './nodus-host.js';
// Canvas registry: map an editor → its live <canvas> (e.g. to drive custom export/screenshot flows).
export { getCanvas, registerCanvas } from './canvas-registry.js';

// signal → React bridge
export { useValue } from './use-value.js';
export { useNodusEditor } from './use-nodus-editor.js';

// panels
export { Minimap, type MinimapProps } from './minimap.js';
export { CommandPalette, defaultCommands, OPEN_COMMAND_PALETTE_EVENT, type Command, type CommandPaletteProps } from './command-palette.js';
export { NodusContextMenu, contextMenuItems, type MenuItem as ContextMenuItem, type NodusContextMenuProps } from './context-menu.js';
export { Properties, type PropertiesProps } from './properties.js';
export { FlowControls, type FlowControlsProps } from './flow-controls.js';
export { FlowScaleEditor, type FlowScaleEditorProps } from './flow-scale-editor.js';
export { buildRampCss, DEFAULT_FLOW, DEFAULT_SCALE } from './flow-shared.js';
export { showToast, type ToastOptions } from './toast.js';
export { CloudIconPicker, type CloudIconPickerProps } from './cloud-icon-picker.js';
export { filterCatalog, type IconCatalogEntry, type ProviderFilter } from './cloud-icon-catalog.js';
export { StencilLibrary, type StencilLibraryProps } from './stencil-library.js';
export { TemplatesGallery, type TemplatesGalleryProps } from './templates-gallery.js';

// clipboard / PNG export
export {
  canCopyImage,
  copyImage,
  copyOrDownloadImage,
  downloadImage,
  renderPngBlob,
  type ExportMethod,
  type ExportResult,
  type ImageExportOptions,
} from './clipboard.js';

// animated GIF export (raster fallback for the animated-SVG flow export)
export { exportFlowGIF, type FlowGIFOptions } from './gif.js';

// design system (tokens, primitives, global styles)
export {
  uiTokens,
  uiTokensFor,
  modeOfTheme,
  useUiTokens,
  type UiMode,
  type UiTokens,
} from './ui/tokens.js';
export {
  UiTokensProvider,
  useUiTokensContext,
  Panel,
  Button,
  IconButton,
  Field,
  Row,
  Menu,
  MenuItem,
  Divider,
  type PanelProps,
  type ButtonProps,
  type ButtonVariant,
  type ButtonSize,
  type IconButtonProps,
  type FieldProps,
  type RowProps,
  type MenuProps,
  type MenuItemProps,
  type DividerProps,
} from './ui/primitives.js';
export { injectGlobalStyles } from './ui/global-styles.js';

// product shell (toolbar, tool palette, zoom, theme toggle, undo/redo, shortcuts, icons)
export * from './ui/shell/index.js';

// browser persistence (autosave + open/save `.nodus.json`)
export {
  useAutosave,
  restoreAutosave,
  clearAutosave,
  saveToFile,
  openFromFile,
  parseSnapshot,
  serializeDocument,
  type UseAutosaveOptions,
} from './persistence.js';

// git-native round-trip + PR-review
// Lossless text↔canvas editor and an in-app "branch vs main" diff/review flow, both anchored on
// core's canonical serialization (`toCanonicalString`) as the single source of "same document."
export { CodePanel, type CodePanelProps } from './code-panel.js';
export {
  editorToSource,
  editorToCanonical,
  canonicalOf,
  parseSource,
  sourceMatchesEditor,
  applySource,
  type SourceParse,
} from './round-trip.js';
export {
  unifiedDiff,
  type DiffLineKind,
  type UnifiedDiffLine,
  type UnifiedDiffResult,
} from './unified-diff.js';
export {
  useBranch,
  computeBranch,
  type BranchInfo,
  type BranchComparison,
  type UseBranchOptions,
} from './use-branch.js';
export {
  BranchBar,
  ReviewModal,
  type BranchBarProps,
  type ReviewModalProps,
} from './review-modal.js';

// shareable scene links (encode a diagram into a URL hash, load it back, copy link/SVG, embed)
export {
  encodeScene,
  decodeScene,
  buildShareUrl,
  sceneFromHash,
  loadSceneFromLocation,
  copyShareLink,
  copySvg,
  buildEmbedSnippet,
} from './share.js';

// layers / outline tree (scene panel: select · rename · hide · lock · reorder)
export {
  LayersPanel,
  buildLayerTree,
  type LayersPanelProps,
  type LayerNode,
} from './layers-panel.js';

export type { Editor, Id };
