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
  /** Source / code panel — the editable document-JSON view. */
  codePanel: {
    /** aria-label on the panel region. */
    regionLabel: string;
    /** Panel heading / tab title. */
    title: string;
    /** aria-label on the JSON `<textarea>`. */
    editorLabel: string;
    /** Parse-error banner with a line number. Token: `{line}`. */
    parseErrorLine: string;
    /** Parse-error banner without a line number. */
    parseError: string;
    /** Status pill while the user is editing (unsynced). */
    statusEditing: string;
    /** Status pill when the editor matches the document. */
    statusSynced: string;
  };
  /** Minimap overview control. */
  minimap: {
    /** aria-label on the minimap. */
    label: string;
  };
  /** Template gallery (new-document starting points). */
  templates: {
    /** The empty-canvas / no-template option. */
    blank: string;
    /** Empty-state when no templates are registered. */
    empty: string;
  };
  /** Cloud-icon picker (AWS/Azure/GCP service glyphs). */
  cloudIcons: {
    /** aria-label on the picker trigger. */
    triggerLabel: string;
    /** Visible label on the picker trigger. */
    trigger: string;
    /** Search input placeholder. */
    searchPlaceholder: string;
    /** aria-label on the clear-search button. */
    clearSearch: string;
    /** Result count. Token: `{count}`. */
    servicesCount: string;
    /** Recently-used section heading. */
    recent: string;
    /** Empty-results text. Tokens: `{provider}`, `{query}`. */
    empty: string;
    /** Footer help / keyboard hint. Tokens: `{count}`, `{total}`. */
    footerHelp: string;
  };
  /** Stencil picker (reusable saved selections + built-in shapes). */
  stencils: {
    /** Visible label on the picker trigger. */
    trigger: string;
    /** Search input placeholder. */
    searchPlaceholder: string;
    /** aria-label on the clear-search button. */
    clearSearch: string;
    /** Save-hint when nothing is selected on the canvas. */
    saveHintEmpty: string;
    /** Save-hint for the current selection. Token: `{count}`. */
    saveHint: string;
    /** Save-selection button label. */
    saveButton: string;
    /** Empty-results text for a search. Token: `{query}`. */
    emptyQuery: string;
    /** Empty-state when no stencils exist. */
    empty: string;
    /** Recently-used section heading. */
    recent: string;
    /** aria-label on the recent-stencils region. */
    recentLabel: string;
    /** Footer help/keyboard hint. Tokens: `{count}`, `{total}`. */
    footerHelp: string;
    /** `window.prompt` title shown when saving the current selection as a new stencil. */
    namePrompt: string;
    /** Default stencil name pre-filled in the save prompt. */
    nameDefault: string;
  };
  /** Git-review / version-history chrome (in-app diff & merge). */
  review: {
    /** title on the in-memory branch chip. */
    branchChipTitle: string;
    /** title on the pending-changes pill. Tokens: `{adds}`, `{dels}`. */
    pillTitle: string;
    /** title on the save-version button. */
    saveVersionTitle: string;
    /** Save-version button label. */
    saveVersion: string;
    /** title on the history button. */
    historyTitle: string;
    /** History button label. */
    history: string;
    /** Review button label. */
    review: string;
    /** aria-label on the review dialog. Token: `{branch}`. */
    dialogLabel: string;
    /** Review-dialog heading. */
    heading: string;
    /** Change summary. Tokens: `{added}`, `{removed}`, `{changed}`. */
    summary: string;
    /** aria-label on the close-review button. */
    closeReview: string;
    /** No-changes empty-state. Token: `{branch}`. */
    noChanges: string;
    /** title on the discard button before confirmation. */
    confirmDiscard: string;
    /** Discard button label. */
    discard: string;
    /** Close button label. */
    close: string;
    /** Approve-and-merge button label. */
    approveMerge: string;
    /** aria-label on the history dialog. Token: `{branch}`. */
    historyDialogLabel: string;
    /** Back-navigation label. */
    back: string;
    /** Version-to-current diff label. Token: `{label}`. */
    versionToCurrent: string;
    /** History-dialog heading. */
    versionHistory: string;
    /** Saved-version count. Token: `{count}`. */
    versionCount: string;
    /** aria-label on the close-history button. */
    closeHistory: string;
    /** No-differences empty-state for a version diff. */
    noDifferences: string;
    /** No-versions empty-state. Token: `{branch}`. */
    noVersions: string;
    /** View-diff action label. */
    viewDiff: string;
    /** Restore action label. */
    restore: string;
    /** title on the restore button. */
    restoreThis: string;
  };
  /** Properties / style inspector panel. */
  properties: {
    /** Duplicate action label. */
    actionDuplicate: string;
    /** Bring-to-front action label. */
    actionBringToFront: string;
    /** Send-to-back action label. */
    actionSendToBack: string;
    /** Lock action label. */
    actionLock: string;
    /** Unlock action label. */
    actionUnlock: string;
    /** Delete action label. */
    actionDelete: string;
    /** aria-label on a color swatch. Tokens: `{name}`, `{color}`. */
    swatchLabel: string;
    /** aria-label on a custom-color input. Token: `{name}`. */
    customColor: string;
    /** aria-label on the X-position input. */
    posX: string;
    /** aria-label on the Y-position input. */
    posY: string;
    /** Width field label. */
    width: string;
    /** Height field label. */
    height: string;
    /** aria-label on the panel region. */
    regionLabel: string;
    /** Position section heading. */
    position: string;
    /** Fill field label. */
    fill: string;
    /** Stroke field label. */
    stroke: string;
    /** Stroke-width field label. */
    strokeWidth: string;
    /** Opacity field label. */
    opacity: string;
    /** Stroke-style field label. */
    strokeStyle: string;
    /** Roughness field label. */
    roughness: string;
    /** aria-label on the roughness control. */
    roughnessLabel: string;
    /** Text field label. */
    text: string;
    /** Text-color field label. */
    textColor: string;
    /** State field label. */
    state: string;
    /** aria-label on the state control. */
    stateLabel: string;
    /** Multi-selection heading. Token: `{count}`. */
    multiSelect: string;
    /** Clear-style button label (resets an element's style to the theme default). */
    clearStyle: string;
  };
  /** Flow / animated-edge controls. */
  flow: {
    /** Panel heading. Token: `{count}`. */
    heading: string;
    /** Animate toggle label. */
    animate: string;
    /** Style field label. */
    style: string;
    /** Speed field label. */
    speed: string;
    /** Size field label. */
    size: string;
    /** Count field label. */
    count: string;
    /** Reverse toggle label. */
    reverse: string;
    /** Rate field label. */
    rate: string;
    /** Rate input placeholder. */
    ratePlaceholder: string;
    /** Color field label. */
    color: string;
    /** title on the reset-color button. */
    resetColorTitle: string;
    /** Reset-color button label. */
    reset: string;
    /** Advanced / data-driven section heading. */
    advanced: string;
    /** Flow-off state label. */
    off: string;
    /** Color-stops section heading. */
    colorStops: string;
    /** Remove-stop button label. */
    removeStop: string;
    /** aria-label on a remove-stop button. Token: `{n}`. */
    removeStopN: string;
    /** Add-stop button label. */
    addStop: string;
    /** Metric field label. */
    metric: string;
    /** Data-driven scale toggle row label. */
    dataDriven: string;
    /** Domain (min/max) row label. */
    domain: string;
    /** Gradient toggle row label. */
    gradient: string;
  };
  /** Zoom controls group. */
  zoom: {
    /** aria-label on the group. */
    groupLabel: string;
    /** Zoom-out button label. */
    out: string;
    /** aria-label on the zoom-level reset button. Token: `{pct}`. */
    resetLabel: string;
    /** title on the zoom-level reset button. */
    resetTitle: string;
    /** Zoom-in button label. */
    in: string;
    /** Fit-to-content button label. */
    fit: string;
  };
  /** Undo/redo controls group. */
  history: {
    /** aria-label on the group. */
    groupLabel: string;
    /** Undo button label. */
    undo: string;
    /** title on the undo button. */
    undoTitle: string;
    /** Redo button label. */
    redo: string;
    /** title on the redo button. */
    redoTitle: string;
  };
  /** Theme toggle. */
  theme: {
    /** aria-label when the current theme is dark (action switches to light). */
    toLight: string;
    /** aria-label when the current theme is light (action switches to dark). */
    toDark: string;
    /** title when the current theme is dark. */
    lightTitle: string;
    /** title when the current theme is light. */
    darkTitle: string;
  };
  /** Tool palette (drawing/selection tools). */
  toolPalette: {
    /** aria-label on the palette. */
    label: string;
  };
  /** Main toolbar. */
  toolbar: {
    /** aria-label on the toolbar. */
    label: string;
  };
  /** Keyboard-shortcuts dialog. */
  shortcuts: {
    /** Dialog heading. */
    title: string;
    /** Close button label. */
    close: string;
    /** aria-label on the open button. */
    buttonLabel: string;
    /** title on the open button. */
    buttonTitle: string;
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
  codePanel: {
    regionLabel: 'Document source (JSON)',
    title: 'Source',
    editorLabel: 'Editable document JSON',
    parseErrorLine: 'Parse error · line {line}',
    parseError: 'Parse error',
    statusEditing: 'Editing…',
    statusSynced: 'Synced',
  },
  minimap: {
    label: 'Minimap — drag to pan the viewport',
  },
  templates: {
    blank: 'Blank canvas',
    empty: 'No templates available',
  },
  cloudIcons: {
    triggerLabel: 'Cloud icons',
    trigger: 'Cloud icons',
    searchPlaceholder: 'Search services… (lambda, database, gcp)',
    clearSearch: 'Clear search',
    servicesCount: '{count} services',
    recent: 'Recent',
    empty: 'No {provider}services match "{query}"',
    footerHelp: '{count} of {total} · ↑↓←→ to move · Enter to add · drag to place',
  },
  stencils: {
    trigger: 'Stencils',
    searchPlaceholder: 'Search stencils… (box, note, flowchart)',
    clearSearch: 'Clear search',
    saveHintEmpty: 'Select something on the canvas first',
    saveHint: 'Save {count} selected as a stencil',
    saveButton: 'Save selection as stencil',
    emptyQuery: 'No stencils match "{query}"',
    empty: 'No stencils available',
    recent: 'Recent',
    recentLabel: 'Recent stencils',
    footerHelp: '{count} of {total} · ↑↓←→ to move · Enter to add · drag to place',
    namePrompt: 'Name this stencil',
    nameDefault: 'My stencil',
  },
  review: {
    branchChipTitle: 'In-memory main branch',
    pillTitle: '{adds} added, {dels} removed line(s) — open review',
    saveVersionTitle: 'Save the current document as a version',
    saveVersion: 'Save version',
    historyTitle: 'Browse and restore saved versions',
    history: 'History',
    review: 'Review',
    dialogLabel: 'Review changes against {branch}',
    heading: 'Review changes',
    summary: '{added} added · {removed} removed · {changed} changed',
    closeReview: 'Close review',
    noChanges: 'No changes — working tree matches {branch}.',
    confirmDiscard: 'Confirm discard',
    discard: 'Discard',
    close: 'Close',
    approveMerge: 'Approve & merge',
    historyDialogLabel: 'Version history for {branch}',
    back: '← Back',
    versionToCurrent: '{label} → current',
    versionHistory: 'Version history',
    versionCount: '{count} versions',
    closeHistory: 'Close history',
    noDifferences: 'No differences — this version matches the current document.',
    noVersions: 'No saved versions yet — Save version, or Approve & merge to snapshot {branch}.',
    viewDiff: 'View diff',
    restore: 'Restore',
    restoreThis: 'Restore this version',
  },
  properties: {
    actionDuplicate: 'Duplicate',
    actionBringToFront: 'Bring to front',
    actionSendToBack: 'Send to back',
    actionLock: 'Lock',
    actionUnlock: 'Unlock',
    actionDelete: 'Delete',
    swatchLabel: '{name} {color}',
    customColor: 'Custom {name} color',
    posX: 'X position',
    posY: 'Y position',
    width: 'Width',
    height: 'Height',
    regionLabel: 'Element style properties',
    position: 'Position',
    fill: 'Fill',
    stroke: 'Stroke',
    strokeWidth: 'Stroke width',
    opacity: 'Opacity',
    strokeStyle: 'Stroke style',
    roughness: 'Roughness',
    roughnessLabel: 'Roughness (hand-drawn style)',
    text: 'Text',
    textColor: 'Text color',
    state: 'State',
    stateLabel: 'Node visual state',
    multiSelect: '{count} selected',
    clearStyle: 'Clear style',
  },
  flow: {
    heading: 'Flow · {count} edges',
    animate: 'Animate',
    style: 'Style',
    speed: 'Speed',
    size: 'Size',
    count: 'Count',
    reverse: 'Reverse',
    rate: 'Rate',
    ratePlaceholder: 'e.g. 350 req/s',
    color: 'Color',
    resetColorTitle: 'Reset to edge stroke',
    reset: 'reset',
    advanced: 'Advanced · data-driven',
    off: 'flow off',
    colorStops: 'Color stops',
    removeStop: 'Remove stop',
    removeStopN: 'Remove color stop {n}',
    addStop: '+ Add stop',
    metric: 'Metric',
    dataDriven: 'Data-driven',
    domain: 'Domain',
    gradient: 'Gradient',
  },
  zoom: {
    groupLabel: 'Zoom',
    out: 'Zoom out',
    resetLabel: 'Zoom {pct}% — reset to 100%',
    resetTitle: 'Reset zoom to 100%',
    in: 'Zoom in',
    fit: 'Fit to content',
  },
  history: {
    groupLabel: 'History',
    undo: 'Undo',
    undoTitle: 'Undo (⌘Z)',
    redo: 'Redo',
    redoTitle: 'Redo (⇧⌘Z)',
  },
  theme: {
    toLight: 'Switch to light theme',
    toDark: 'Switch to dark theme',
    lightTitle: 'Light theme',
    darkTitle: 'Dark theme',
  },
  toolPalette: {
    label: 'Tools',
  },
  toolbar: {
    label: 'Main toolbar',
  },
  shortcuts: {
    title: 'Keyboard shortcuts',
    close: 'Close',
    buttonLabel: 'Keyboard shortcuts',
    buttonTitle: 'Keyboard shortcuts (?)',
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
