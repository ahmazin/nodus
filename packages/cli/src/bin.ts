#!/usr/bin/env node
/**
 * The `nodus` CLI entry point. In the monorepo run it via `pnpm nodus <cmd>` (tsx); when published
 * it is the `nodus` bin (dist/bin.js). The dispatcher lives in `main.ts` (unit-testable, returns the
 * exit code); this file just wires it to `process.exitCode` so it works in CI and pre-commit hooks.
 */
import { main } from './main.js';

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
