/**
 * Nodus typed errors — the single error class every synchronous programmer-fault throw uses.
 *
 * The façade convention (see the package README): a synchronous programmer error (unknown
 * registered type, invalid util, use-after-dispose) THROWS a `NodusError`; an expected empty
 * outcome (a stale or missing id) RETURNS `boolean`/`null`; an async or third-party fault
 * (listener, plugin, flow poll, paint/effect throw) is ROUTED to the `error` event, never thrown.
 */

/**
 * Closed union of first-party engine error codes carried by a {@link NodusError}. Codes raised by
 * other `@ahmazin/*` packages use a slash namespace (e.g. `'persistence/load-failed'`), so the brand
 * — not this union — is the cross-package discriminant.
 */
export type NodusErrorCode =
  | 'unknown-node-type'
  | 'unknown-edge-type'
  | 'unknown-layout'
  | 'unknown-command'
  | 'invalid-util'
  | 'invalid-migrations'
  | 'invalid-props'
  | 'schema-too-new'
  | 'invalid-snapshot'
  | 'editor-disposed'
  | 'plugin-install-failed'
  | 'reentrant-apply'
  | 'apply-in-transaction';

/** The brand string stamped on every NodusError, whatever build produced it. */
const NODUS_ERROR_BRAND = '@ahmazin/core:NodusError';

/**
 * A typed engine error. Carries a stable machine-readable {@link code} and optional structured
 * {@link context} so callers branch on `err.code` rather than parsing the message.
 *
 * **Never test membership with `instanceof`.** When `@ahmazin/core` is loaded twice in one process
 * (an ESM build and a CJS build — the dual-package hazard) there are two distinct `NodusError`
 * classes and `instanceof` fails across the seam. Use {@link isNodusError}, which matches the
 * {@link brand} string instead.
 */
export class NodusError<C extends string = NodusErrorCode> extends Error {
  /** Dual-package-safe discriminant — match this, never `instanceof`. */
  readonly brand: typeof NODUS_ERROR_BRAND = NODUS_ERROR_BRAND;
  readonly code: C;
  // `declare` so ES2022 class-field semantics don't stamp a phantom `context: undefined` own-key;
  // it becomes an own property only when actually supplied.
  declare readonly context?: Record<string, unknown>;

  constructor(code: C, message: string, opts?: { context?: Record<string, unknown>; cause?: unknown }) {
    super(message, opts?.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'NodusError';
    this.code = code;
    if (opts?.context !== undefined) this.context = opts.context;
  }
}

/**
 * Structural type guard for a {@link NodusError} produced by ANY copy of `@ahmazin/core`. Matches on
 * the brand string plus a string `code` — deliberately NOT `instanceof` (see {@link NodusError}).
 * Narrows to `NodusError<string>` because a foreign-copy error may carry a code outside this
 * build's {@link NodusErrorCode} union.
 */
export function isNodusError(e: unknown): e is NodusError<string> {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { brand?: unknown }).brand === NODUS_ERROR_BRAND &&
    typeof (e as { code?: unknown }).code === 'string'
  );
}
