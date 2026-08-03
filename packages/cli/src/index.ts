/** Public API of @nodus-dev/cli — command functions, exported for programmatic use and tests. */
export { fmt, canonicalizeFile, type FmtResult, type CanonicalizeResult } from './commands/fmt.js';
export { render, detectPreset, type RenderOptions, type Preset } from './commands/render.js';
export { diffReport, readSource, type DiffReport } from './commands/diff.js';
export { driftReport, type DriftCliReport } from './commands/drift.js';
export { main } from './main.js';
