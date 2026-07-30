/**
 * @ahmazin/preset-infra — the infra-architecture preset: six semantic node types, the dark theme,
 * the connector edge, mode adapters, and the `InfraCanvas` facade. Built entirely on `@ahmazin/core`'s
 * public API.
 */

export { darkInfraTheme, infraLightTheme, ACCENTS, ACCENTS_LIGHT, INFRA_TYPES, infraTypeKey, type InfraKind } from './theme.js';
export { classifyCategory } from './classify-category.js';
export { infraNodeUtils } from './nodes.js';
export { infraConnectorUtil } from './edge.js';
export { installInfraPreset } from './install.js';
export {
  freeformMode,
  revealMode,
  stagesMode,
  type RevealController,
  type StagesController,
} from './adapters.js';
export {
  InfraCanvas,
  modelToRecords,
  type InfraModel,
  type InfraNodeSpec,
  type InfraEdgeSpec,
  type InfraMode,
  type InfraCanvasOptions,
  type InfraCanvasHandle,
} from './facade.js';
