// Bundle entry for the self-contained interactive artifact. Exposes the engine + infra preset +
// dagre layout as a single global (`Nodus`) via esbuild IIFE.
export * from '@nodus/core';
export {
  InfraCanvas,
  installInfraPreset,
  darkInfraTheme,
  modelToRecords,
  infraNodeUtils,
  INFRA_TYPES,
  ACCENTS,
} from '@nodus/preset-infra';
export { dagreLayout } from '@nodus/layout-dagre';
export { treeLayout } from '@nodus/layout-tree';
export { forceLayout } from '@nodus/layout-force';
export { installDrawTools, drawShortcut } from '@nodus/preset-draw';
export { LocalDocStore, autosave, loadDoc } from '@nodus/persistence';
export { installDiagrams, diagramsTheme } from '@nodus/preset-diagrams';
export { importMermaid, fromMermaid } from '@nodus/from-mermaid';
