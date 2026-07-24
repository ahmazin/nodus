/**
 * Command registry (extensibility, task A4). A `Command` is a named, optionally-guarded action over an
 * `Editor`; the registry is the single place a UI (command palette, menus, keymap) discovers and runs
 * them. Plugins contribute commands through `EngineHost.registerCommand`; the core installs a default
 * set (undo/redo/zoom/selection/delete/duplicate) unless `builtins` is disabled.
 */

import type { Editor } from '../editor/index.js';
import type { Dispose } from '../signals/index.js';
import { NodusError } from '../errors/index.js';

export interface Command<A = unknown> {
  /** Stable, unique id (the key a keymap / palette references). */
  id: string;
  /** Human-readable label for menus and the command palette. */
  label: string;
  /** Perform the action. May be async (e.g. a command that runs a layout). */
  run(editor: Editor, args?: A): void | Promise<void>;
  /** Optional gate — when it returns `false` the command is disabled (menus grey it out; `execute`
   *  becomes a no-op). Absent means always enabled. */
  enabled?(editor: Editor): boolean;
}

export class CommandRegistry {
  private readonly map = new Map<string, Command>();

  /** Register a command under its id (overwriting any prior with that id). Returns a disposer that
   *  unregisters exactly this command (a no-op if it was already replaced). */
  register(cmd: Command): Dispose {
    this.map.set(cmd.id, cmd);
    return () => {
      if (this.map.get(cmd.id) === cmd) this.map.delete(cmd.id);
    };
  }

  get(id: string): Command | undefined {
    return this.map.get(id);
  }

  list(): Command[] {
    return [...this.map.values()];
  }

  /** Whether `id` exists AND its `enabled` gate (if any) currently passes. An unknown id is not
   *  enabled (there is nothing to enable) — this never throws, so a UI can poll it freely. */
  isEnabled(id: string, editor: Editor): boolean {
    const cmd = this.map.get(id);
    if (!cmd) return false;
    return cmd.enabled ? cmd.enabled(editor) : true;
  }

  /** Run a command. An unknown id is a programmer error → throws `NodusError('unknown-command')`. A
   *  known-but-disabled command is a benign no-op (a keymap firing while nothing is selected). */
  execute(id: string, editor: Editor, args?: unknown): void | Promise<void> {
    const cmd = this.map.get(id);
    if (!cmd) {
      throw new NodusError('unknown-command', `No command registered with id "${id}".`, { context: { id } });
    }
    if (cmd.enabled && !cmd.enabled(editor)) return; // disabled → no-op
    return cmd.run(editor, args);
  }
}

/**
 * Install the built-in editor commands. Semantics mirror the host keymap (undo/redo, zoom, select-all,
 * delete, duplicate). Auto-installed by the `Editor` unless `EditorOptions.builtins === false`.
 */
export function installDefaultCommands(editor: Editor): void {
  const commands: Command[] = [
    { id: 'undo', label: 'Undo', run: (e) => e.undo(), enabled: (e) => e.history.canUndo() },
    { id: 'redo', label: 'Redo', run: (e) => e.redo(), enabled: (e) => e.history.canRedo() },
    { id: 'zoomIn', label: 'Zoom in', run: (e) => e.zoomBy(1.2) },
    { id: 'zoomOut', label: 'Zoom out', run: (e) => e.zoomBy(1 / 1.2) },
    { id: 'zoomToFit', label: 'Zoom to fit', run: (e) => e.zoomToFit() },
    { id: 'selectAll', label: 'Select all', run: (e) => e.selectAll() },
    {
      id: 'delete',
      label: 'Delete',
      run: (e) => e.deleteRecords(e.selectedIdsArray()),
      enabled: (e) => e.selectedIdsArray().length > 0,
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      run: (e) => {
        e.duplicate();
      },
      enabled: (e) => e.selectedIdsArray().length > 0,
    },
  ];
  for (const c of commands) editor.commands.register(c);
}
