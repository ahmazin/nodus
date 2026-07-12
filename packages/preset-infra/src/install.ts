import type { Editor } from '@nodus/core';
import { infraNodeUtils } from './nodes.js';
import { infraConnectorUtil } from './edge.js';
import { darkInfraTheme } from './theme.js';

/** Register the six infra node types, the connector edge, and the dark theme on an editor. */
export function installInfraPreset(editor: Editor): void {
  for (const util of infraNodeUtils) editor.nodes.register(util);
  editor.edges.register(infraConnectorUtil);
  editor.sceneIndex.rebuild(editor.store.allRecords());
  editor.setTheme(darkInfraTheme);
}
