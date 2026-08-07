import { describe, expect, it } from 'vitest';
import { Editor, defaultCoreMessages, fmt, mergeMessages, type CoreMessages } from '../index.js';

/**
 * i18n foundation (PRR P3). Message tables are data: a host localizes by deep-merging a partial
 * override over the English defaults — no code change. This is the canonical "swapped message" proof.
 */
describe('core messages', () => {
  it('ships English defaults', () => {
    expect(defaultCoreMessages.commands.undo).toBe('Undo');
    expect(defaultCoreMessages.builtins.group).toBe('Group');
  });

  it('mergeMessages deep-overrides only the provided keys and never mutates the base', () => {
    const merged = mergeMessages(defaultCoreMessages, { commands: { undo: 'Rückgängig' } });
    expect(merged.commands.undo).toBe('Rückgängig');
    expect(merged.commands.redo).toBe('Redo'); // sibling untouched
    expect(merged.builtins.group).toBe('Group'); // sibling namespace untouched
    // base is not mutated
    expect(defaultCoreMessages.commands.undo).toBe('Undo');
  });

  it('mergeMessages(base, undefined) returns the base unchanged', () => {
    expect(mergeMessages(defaultCoreMessages, undefined)).toBe(defaultCoreMessages);
  });

  it('fmt interpolates {placeholders} and leaves unmatched ones verbatim', () => {
    expect(fmt('{n} of {total}', { n: 1, total: 5 })).toBe('1 of 5');
    expect(fmt('{missing} item', {})).toBe('{missing} item');
    expect(fmt('no params')).toBe('no params');
  });

  it('Editor.messages resolves the override and command labels reflect it', () => {
    const ed = new Editor({ messages: { commands: { undo: 'Rückgängig' } } });
    expect(ed.messages.commands.undo).toBe('Rückgängig');
    expect(ed.messages.commands.redo).toBe('Redo'); // untouched default
    // the default command registry snapshots labels from the table at install time
    expect(ed.commands.get('undo')?.label).toBe('Rückgängig');
    expect(ed.commands.get('redo')?.label).toBe('Redo');
  });

  it('a default Editor exposes the English table', () => {
    const ed = new Editor();
    const m: CoreMessages = ed.messages;
    expect(m.commands.delete).toBe('Delete');
  });
});
