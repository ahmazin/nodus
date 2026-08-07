/**
 * i18n foundation (PRR P3). Nodus ships English message tables as plain data. Every user-visible string
 * the engine owns lives in {@link CoreMessages}; a host localizes by passing a {@link DeepPartial}
 * override to `new Editor({ messages })`, which is deep-merged over {@link defaultCoreMessages} — no
 * code change, no rebuild. `@nodus-dev/react` layers its own chrome table on top (see the react
 * `useMessages` hook) and reuses {@link mergeMessages}/{@link fmt}/{@link DeepPartial} exported here.
 *
 * Values are JSON-serializable strings with `{placeholder}` tokens (interpolate via {@link fmt}) so a
 * locale can be contributed as a data object, never functions.
 */

/** The engine-owned message table: command-palette/menu labels + built-in on-canvas defaults. */
export interface CoreMessages {
  /** Labels for the built-in commands installed by `installDefaultCommands`. */
  commands: {
    undo: string;
    redo: string;
    zoomIn: string;
    zoomOut: string;
    zoomToFit: string;
    selectAll: string;
    delete: string;
    duplicate: string;
  };
  /** On-canvas defaults for built-in node types. */
  builtins: {
    /** Default label for a built-in group node (currently applied via `labelOverride`; see NodeUtil). */
    group: string;
  };
}

/** Recursive partial: every nested field of a message table is individually overridable. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/** The English defaults. A locale copies this shape, translates the values, and passes it back. */
export const defaultCoreMessages: CoreMessages = {
  commands: {
    undo: 'Undo',
    redo: 'Redo',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    zoomToFit: 'Zoom to fit',
    selectAll: 'Select all',
    delete: 'Delete',
    duplicate: 'Duplicate',
  },
  builtins: {
    group: 'Group',
  },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Deep-merge `override` onto `base`, returning a new table. Nested plain objects merge recursively;
 * scalars and arrays replace wholesale; `undefined` override values are ignored (they keep the base).
 * `base` is never mutated. Shared by core and `@nodus-dev/react` so both message layers merge alike.
 */
export function mergeMessages<T>(base: T, override?: DeepPartial<T>): T {
  if (override === undefined || !isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : (override as unknown as T);
  }
  const ov = override as Record<string, unknown>;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const k of Object.keys(ov)) {
    const o = ov[k];
    if (o === undefined) continue;
    const b = out[k];
    out[k] =
      isPlainObject(b) && isPlainObject(o)
        ? mergeMessages(b, o as DeepPartial<Record<string, unknown>>)
        : o;
  }
  return out as T;
}

/**
 * Interpolate `{name}` placeholders in a message template with `params`. An unmatched placeholder is
 * left verbatim (so a missing param is visible, not silently blank). Linear scan — no ReDoS surface.
 * Used by both the core and react message layers for count/label-parameterized strings.
 */
export function fmt(tpl: string, params?: Record<string, string | number>): string {
  if (!params) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}
