// Bundle entry for the self-contained interactive artifact. Exposes the engine + infra preset +
// dagre layout as a single global (`Nodus`) via esbuild IIFE.
export * from '@nodus-dev/core';
export {
  InfraCanvas,
  installInfraPreset,
  darkInfraTheme,
  modelToRecords,
  infraNodeUtils,
  INFRA_TYPES,
  ACCENTS,
} from '@nodus-dev/preset-infra';
export { dagreLayout } from '@nodus-dev/layout-dagre';
export { treeLayout } from '@nodus-dev/layout-tree';
export { forceLayout } from '@nodus-dev/layout-force';
export { installDrawTools, drawShortcut } from '@nodus-dev/preset-draw';
export { LocalDocStore, autosave, loadDoc } from '@nodus-dev/persistence';
export { installDiagrams, diagramsTheme } from '@nodus-dev/preset-diagrams';
export { importMermaid, fromMermaid } from '@nodus-dev/from-mermaid';
