'use client';
/**
 * i18n for the `@nodus-dev/react` chrome (PRR P3). This layers a React-side message table on top of
 * core's engine-owned {@link CoreMessages}: the panels/host own their own visible strings here, while
 * command-palette/menu command labels still come from `editor.messages` (so both layers stay in one
 * source of truth). A host localizes by:
 *
 *   - `new Editor({ messages })` — engine strings (command labels, on-canvas defaults), OR
 *   - `<MessagesProvider messages={…}>` around the tree — react chrome strings for every descendant, OR
 *   - a per-panel `messages` prop — react chrome strings for one panel (wins over the provider).
 *
 * All three are {@link DeepPartial} overrides deep-merged over {@link defaultReactMessages}; a locale is
 * contributed as a plain data object (copy the defaults, translate the values), never as code. Values
 * are strings with `{placeholder}` tokens interpolated by core's {@link fmt}.
 */
import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from 'react';
import { mergeMessages, type DeepPartial, type Editor } from '@nodus-dev/core';

/**
 * The React-chrome message table. Every user-visible string a Nodus panel or the `<Nodus>` host owns
 * lives here. Command-palette/context-menu *command* labels are NOT here — those come from
 * `editor.messages.commands` so the engine and chrome share one set.
 */
export interface ReactMessages {
  /** `<Nodus>` host: canvas labels + the aria-live selection announcer. */
  host: {
    /** aria-label on the canvas host `<div role="application">`. */
    canvasLabel: string;
    /** aria-label on the inline label editor `<textarea>`. */
    editLabel: string;
    /** aria-live announcement for a single selected object. Tokens: `{label}`, `{i}`, `{n}`. */
    selectionAnnounce: string;
    /** aria-live announcement for a multi-selection. Token: `{count}`. */
    selectionMulti: string;
    /** aria-live announcement while connecting from a node (keyboard authoring). Token: `{label}`. */
    connectPrompt: string;
  };
  /** Layers / outline panel. */
  layers: {
    title: string;
    empty: string;
    expandGroup: string;
    collapseGroup: string;
    rename: string;
    show: string;
    hide: string;
    lock: string;
    unlock: string;
    bringForward: string;
    sendBackward: string;
  };
  /** Right-click context menu (only the container aria-label; item labels are action-derived). */
  contextMenu: {
    actions: string;
  };
  /** Command palette (⌘K). */
  palette: {
    /** aria-label on the palette dialog. */
    label: string;
    /** Search input placeholder. */
    placeholder: string;
    /** Search input aria-label. */
    searchLabel: string;
    /** Results list aria-label. */
    listLabel: string;
    /** Empty-results text. */
    empty: string;
  };
}

/** The English defaults. A locale copies this shape, translates the values, and passes it back. */
export const defaultReactMessages: ReactMessages = {
  host: {
    canvasLabel: 'Diagram canvas — Tab to move between nodes, arrow keys to nudge, Escape to leave the canvas',
    editLabel: 'Edit label',
    selectionAnnounce: '{label} — {i} of {n}',
    selectionMulti: '{count} objects selected',
    connectPrompt: 'Connecting from {label} — Tab to choose a target, Enter to connect',
  },
  layers: {
    title: 'Layers',
    empty: 'No objects yet',
    expandGroup: 'Expand group',
    collapseGroup: 'Collapse group',
    rename: 'Rename layer',
    show: 'Show',
    hide: 'Hide',
    lock: 'Lock',
    unlock: 'Unlock',
    bringForward: 'Bring forward',
    sendBackward: 'Send backward',
  },
  contextMenu: {
    actions: 'Actions',
  },
  palette: {
    label: 'Command palette',
    placeholder: 'Type a command…',
    searchLabel: 'Search commands',
    listLabel: 'Commands',
    empty: 'No matching commands',
  },
};

const MessagesContext = createContext<DeepPartial<ReactMessages> | undefined>(undefined);

/**
 * Provide react-chrome string overrides to every Nodus panel/host beneath it. A per-panel `messages`
 * prop still wins over what this provides. Overrides are {@link DeepPartial} — supply only the strings
 * you translate; the rest fall back to {@link defaultReactMessages}.
 */
export function MessagesProvider({
  messages,
  children,
}: {
  messages?: DeepPartial<ReactMessages>;
  children?: ReactNode;
}): ReactElement {
  return <MessagesContext.Provider value={messages}>{children}</MessagesContext.Provider>;
}

/**
 * Resolve the effective react-chrome messages for a panel: {@link defaultReactMessages} < the nearest
 * {@link MessagesProvider} < the panel's own `override`. `editor` is accepted so a caller can read
 * engine-owned command labels off `editor.messages` alongside the chrome table (kept in the signature
 * for a stable, forward-compatible hook contract).
 */
export function useMessages(editor: Editor, override?: DeepPartial<ReactMessages>): ReactMessages {
  void editor; // reserved: command labels are read from editor.messages by the caller when needed
  const fromContext = useContext(MessagesContext);
  return useMemo(() => {
    let m = defaultReactMessages;
    if (fromContext) m = mergeMessages(m, fromContext);
    if (override) m = mergeMessages(m, override);
    return m;
  }, [fromContext, override]);
}
