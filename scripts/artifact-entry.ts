// Bundle entry for the self-contained interactive artifact. Exposes the engine + infra preset +
// dagre layout as a single global (`Nodus`) via esbuild IIFE.
export * from '@ahmazin/core';
export {
  InfraCanvas,
  installInfraPreset,
  darkInfraTheme,
  modelToRecords,
  infraNodeUtils,
  INFRA_TYPES,
  ACCENTS,
} from '@ahmazin/preset-infra';
export { dagreLayout } from '@ahmazin/layout-dagre';
export { treeLayout } from '@ahmazin/layout-tree';
export { forceLayout } from '@ahmazin/layout-force';
export { installDrawTools, drawShortcut } from '@ahmazin/preset-draw';
export { LocalDocStore, autosave, loadDoc } from '@ahmazin/persistence';
export { installDiagrams, diagramsTheme } from '@ahmazin/preset-diagrams';
export { importMermaid, fromMermaid } from '@ahmazin/from-mermaid';
