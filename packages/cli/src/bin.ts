#!/usr/bin/env node
/**
 * The `nodus` CLI entry point. In the monorepo run it via `pnpm nodus <cmd>` (tsx); when published
 * it is the `nodus` bin (dist/bin.js). Exit code is nonzero on failure so it works in CI and hooks.
 */
import { fmt } from './commands/fmt.js';
import { render, type Preset } from './commands/render.js';
import { diffReport } from './commands/diff.js';

const VALUE_FLAGS = new Set(['out', 'preset', 'scale', 'theme']);

function parseArgs(args: string[]): { positionals: string[]; flags: Record<string, string | boolean> } {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (VALUE_FLAGS.has(key)) flags[key] = args[++i] ?? '';
      else flags[key] = true;
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

const USAGE = `nodus — git-native diagram toolchain

Usage:
  nodus fmt <file...> [--check]      Canonicalize diagram files (or verify, no writes, with --check)
  nodus render <file> [--out f.png] [--preset infra|draw|diagrams] [--scale n] [--no-bg] [--grid]
  nodus diff <a> <b> [--json]        Semantic diff between two diagram files
`;

async function main(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv);
  const [cmd, ...rest] = positionals;

  switch (cmd) {
    case 'fmt': {
      if (rest.length === 0) {
        console.error('fmt: no files given');
        return 1;
      }
      const check = flags.check === true;
      const results = fmt(rest, { check });
      let failed = false;
      for (const r of results) {
        if (r.dropped > 0) {
          console.warn(`warning: ${r.file}: dropped ${r.dropped} invalid/dangling record(s)`);
          failed = true;
        }
        if (check) {
          if (r.changed) failed = true;
          console.log(`${r.changed ? 'would reformat' : 'ok           '}  ${r.file}`);
        } else {
          console.log(`${r.changed ? 'formatted' : 'unchanged'}  ${r.file}`);
        }
      }
      return failed ? 1 : 0;
    }

    case 'render': {
      const file = rest[0];
      if (!file) {
        console.error('render: no file given');
        return 1;
      }
      const out = await render(file, {
        out: typeof flags.out === 'string' ? flags.out : undefined,
        preset: typeof flags.preset === 'string' ? (flags.preset as Preset) : undefined,
        scale: typeof flags.scale === 'string' ? Number(flags.scale) : undefined,
        background: flags['no-bg'] !== true,
        grid: flags.grid === true,
      });
      console.log(`rendered  ${file} → ${out}`);
      return 0;
    }

    case 'diff': {
      const [a, b] = rest;
      if (!a || !b) {
        console.error('diff: need two files');
        return 1;
      }
      const report = diffReport(a, b);
      console.log(flags.json ? JSON.stringify(report.result, null, 2) : report.text);
      return 0;
    }

    default:
      console.log(USAGE);
      return cmd ? 1 : 0;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
