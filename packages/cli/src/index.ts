/** Public API of @nodus/cli — command functions, exported for programmatic use and tests. */
export { fmt, canonicalizeFile, type FmtResult } from './commands/fmt.js';
export { render, detectPreset, type RenderOptions, type Preset } from './commands/render.js';
export { diffReport, type DiffReport } from './commands/diff.js';
