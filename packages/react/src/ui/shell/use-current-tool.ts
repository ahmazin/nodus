/**
 * Track the editor's active tool id reactively. `editor.currentToolId` is a plain getter (not a
 * signal), and tool changes are announced on the event bus as `{ type: 'tool', id }` — including
 * changes made by keyboard shortcuts or the command palette, not just the palette. This hook
 * mirrors that so any shell control (e.g. the tool palette) can highlight the current tool no
 * matter who switched it.
 */

import { useEffect, useState } from 'react';
import type { Editor } from '@ahmazin/core';

export function useCurrentTool(editor: Editor): string {
  const [id, setId] = useState(() => editor.currentToolId);
  useEffect(() => {
    // Resync in case the tool changed between the initial render and this effect running.
    setId(editor.currentToolId);
    return editor.events.on('tool', (e) => setId((e as { id: string }).id));
  }, [editor]);
  return id;
}
