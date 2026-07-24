/**
 * Command registry (task A4). register/get/list/execute; unknown id throws NodusError('unknown-command');
 * a disabled command is a no-op; plugins contribute via EngineHost.registerCommand; the default set is
 * installed under builtins. Each `it` fails on the pre-change editor (no command registry).
 */
import { describe, expect, it } from 'vitest';
import { Editor } from '../editor/index.js';
import { isNodusError, type NodusError } from '../errors/index.js';

describe('CommandRegistry', () => {
  it('registers, looks up, lists, executes, and unregisters a command', () => {
    const ed = new Editor({ builtins: false });
    let ran = 0;
    const dispose = ed.registerCommand({ id: 'test', label: 'Test', run: () => void ran++ });
    expect(ed.commands.get('test')?.label).toBe('Test');
    expect(ed.commands.list().map((c) => c.id)).toContain('test');
    ed.execute('test');
    expect(ran).toBe(1);
    dispose();
    expect(ed.commands.get('test')).toBeUndefined();
  });

  it('execute of an unknown id throws NodusError("unknown-command")', () => {
    const ed = new Editor({ builtins: false });
    let err: unknown;
    try {
      ed.execute('does-not-exist');
    } catch (e) {
      err = e;
    }
    expect(isNodusError(err)).toBe(true);
    expect((err as NodusError).code).toBe('unknown-command');
  });

  it('a disabled command is a no-op; isEnabled reflects the gate (and unknown → false, no throw)', () => {
    const ed = new Editor({ builtins: false });
    let ran = 0;
    ed.registerCommand({ id: 'gated', label: 'Gated', run: () => void ran++, enabled: () => false });
    expect(ed.commands.isEnabled('gated', ed)).toBe(false);
    ed.execute('gated'); // disabled → no-op, does NOT throw
    expect(ran).toBe(0);
    expect(ed.commands.isEnabled('unknown', ed)).toBe(false); // unknown id is simply not enabled
  });

  it('a plugin-contributed command appears in list()', () => {
    const ed = new Editor({ builtins: false });
    ed.use({
      id: 'p',
      register: (host) => host.registerCommand({ id: 'plug:hello', label: 'Hello', run: () => {} }),
    });
    expect(ed.commands.list().map((c) => c.id)).toContain('plug:hello');
  });

  it('installs the default command set under builtins, with correct enable gating', () => {
    const ed = new Editor(); // builtins default true → installDefaultCommands
    const ids = ed.commands.list().map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining(['undo', 'redo', 'zoomIn', 'zoomOut', 'zoomToFit', 'selectAll', 'delete', 'duplicate']),
    );
    expect(ed.commands.isEnabled('delete', ed)).toBe(false); // nothing selected
    const a = ed.createNode({ type: 'rect', x: 0, y: 0 });
    ed.select([a]);
    expect(ed.commands.isEnabled('delete', ed)).toBe(true);
    ed.execute('delete');
    expect(ed.store.has(a)).toBe(false); // the delete command removed the selected node
  });

  it('does NOT install default commands when builtins:false', () => {
    const ed = new Editor({ builtins: false });
    expect(ed.commands.list()).toHaveLength(0);
  });
});
