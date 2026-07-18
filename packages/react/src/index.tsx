/**
 * @nodus/react — a thin React binding for the Nodus engine. This module is the package barrel:
 * the `<Nodus>` host lives in `nodus-host.tsx`; panels, the design-system `ui/*` surface, and the
 * clipboard/PNG helpers are re-exported here. No engine logic lives in this package.
 */

import { type Editor, type Id } from '@nodus/core';

// host
export { Nodus, type NodusProps } from './nodus-host.js';

// signal → React bridge
export { useValue } from './use-value.js';

// panels
export { Minimap, type MinimapProps } from './minimap.js';
export { CommandPalette, defaultCommands, type Command, type CommandPaletteProps } from './command-palette.js';
export { NodusContextMenu, contextMenuItems, type MenuItem as ContextMenuItem, type NodusContextMenuProps } from './context-menu.js';
export { Properties, type PropertiesProps } from './properties.js';
export { FlowControls, type FlowControlsProps } from './flow-controls.js';
export { FlowScaleEditor, type FlowScaleEditorProps } from './flow-scale-editor.js';
export { buildRampCss, DEFAULT_FLOW, DEFAULT_SCALE } from './flow-shared.js';
export { showToast, type ToastOptions } from './toast.js';
export { CloudIconPicker, type CloudIconPickerProps } from './cloud-icon-picker.js';
export { filterCatalog, type IconCatalogEntry, type ProviderFilter } from './cloud-icon-catalog.js';

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

export type { Editor, Id };
