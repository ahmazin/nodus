/**
 * The `nodus` CLI dispatcher, extracted from the bin so `main()` is unit-testable (it returns the exit
 * code instead of touching `process.exitCode`). `bin.ts` is the thin entry that runs it.
 *
 * Exit codes (audit F41 §CLI):
 *   0  clean
 *   1  fmt --check: at least one file would be reformatted
 *   2  fmt: a file's canonical form would lose data and was NOT rewritten (pass --force to override)
 *   3  a file was written by a newer Nodus than this CLI understands ("upgrade @nodus-dev/cli")
 */
import { fmt, type FmtResult } from './commands/fmt.js';
import { render, type Preset } from './commands/render.js';
import { diffReport } from './commands/diff.js';
import { driftReport } from './commands/drift.js';
import { isSchemaTooNew } from './load.js';

const VALUE_FLAGS = new Set(['out', 'preset', 'scale', 'theme', 'source']);

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
  nodus fmt <file...> [--check] [--force]
        Canonicalize diagram files in place (--check verifies without writing). Refuses to rewrite a
        file whose canonical form would drop or repair data unless --force. Exit: 0 clean · 1 would
        reformat (--check) · 2 refused, data loss · 3 file needs a newer nodus.
  nodus render <file> [--out f.png] [--preset infra|draw|diagrams] [--scale n] [--no-bg] [--grid]
        Render a diagram to PNG (headless).
  nodus diff <a> <b> [--json]
        Semantic diff. <a>/<b> are files or 'REV:path' git specs
        (e.g. nodus diff HEAD:diagram.nodus.json diagram.nodus.json).
  nodus drift <diagram.nodus.json> <source> [--source terraform|kubernetes|auto] [--json]
        Exit 1 if the diagram no longer matches the source.
  nodus --help
        Show this help.
`;

/** Human summary of what canonicalizing a lossy file would drop/repair, for the refuse/--force notice. */
function describeLoss(r: FmtResult): string {
  const parts: string[] = [];
  if (r.dropped > 0) parts.push(`${r.dropped} record(s) dropped`);
  for (const issue of r.issues) parts.push(`${issue.code}: ${issue.message}`);
  return parts.join('; ');
}

function runFmt(files: string[], flags: Record<string, string | boolean>): number {
  const check = flags['check'] === true;
  const force = flags['force'] === true;
  const results = fmt(files, { check, force });

  let anyTooNew = false;
  let anyRefused = false;
  let anyWouldReformat = false;
  for (const r of results) {
    if (r.tooNew) {
      anyTooNew = true;
      const at = r.fileSchema !== undefined ? ` (schemaVersion ${r.fileSchema})` : '';
      console.error(`error: ${r.file}: written by a newer version of Nodus${at} — upgrade @nodus-dev/cli to read it`);
      continue;
    }
    if (r.lossy && !force) {
      anyRefused = true;
      console.error(`refused: ${r.file}: canonicalizing would lose data (${describeLoss(r)}); pass --force to write anyway`);
      continue;
    }
    if (r.lossy && force) {
      // --force accepted the loss: print exactly what was dropped/stripped so it's on the record.
      console.warn(`warning: ${r.file}: ${check ? 'would lose' : 'wrote with'} data loss (${describeLoss(r)})`);
    }
    if (check) {
      if (r.changed) anyWouldReformat = true;
      console.log(`${r.changed ? 'would reformat' : 'ok           '}  ${r.file}`);
    } else {
      console.log(`${r.wrote ? 'formatted' : 'unchanged'}  ${r.file}`);
    }
  }

  if (anyTooNew) return 3;
  if (anyRefused) return 2;
  if (check && anyWouldReformat) return 1;
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  // No command, or an explicit help request, prints usage and succeeds (formalizes the bin smoke).
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    console.log(USAGE);
    return 0;
  }

  const { positionals, flags } = parseArgs(argv);
  const [cmd, ...rest] = positionals;

  try {
    switch (cmd) {
      case 'fmt': {
        if (rest.length === 0) {
          console.error('fmt: no files given');
          return 1;
        }
        return runFmt(rest, flags);
      }

      case 'render': {
        const file = rest[0];
        if (!file) {
          console.error('render: no file given');
          return 1;
        }
        const out = await render(file, {
          out: typeof flags['out'] === 'string' ? flags['out'] : undefined,
          preset: typeof flags['preset'] === 'string' ? (flags['preset'] as Preset) : undefined,
          scale: typeof flags['scale'] === 'string' ? Number(flags['scale']) : undefined,
          background: flags['no-bg'] !== true,
          grid: flags['grid'] === true,
          onWarn: (m) => console.error(m),
        });
        console.log(`rendered  ${file} → ${out}`);
        return 0;
      }

      case 'diff': {
        const [a, b] = rest;
        if (!a || !b) {
          console.error('diff: need two files (or REV:path git specs)');
          return 1;
        }
        const report = diffReport(a, b);
        for (const w of report.loadWarnings) console.error(w);
        console.log(flags['json'] ? JSON.stringify(report.result, null, 2) : report.text);
        return 0;
      }

      case 'drift': {
        const [diagram, src] = rest;
        if (!diagram || !src) {
          console.error('drift: need a diagram file and a source file');
          return 1;
        }
        const source = typeof flags['source'] === 'string' ? (flags['source'] as 'terraform' | 'kubernetes' | 'auto') : undefined;
        const report = driftReport(diagram, src, { source });
        for (const w of report.loadWarnings) console.error(w);
        console.log(flags['json'] ? JSON.stringify(report.result, null, 2) : report.text);
        return report.drifted ? 1 : 0;
      }

      default:
        console.log(USAGE);
        return cmd ? 1 : 0;
    }
  } catch (err) {
    // A file written by a newer Nodus is a distinct, actionable failure — its own exit code and a
    // message that points at upgrading the CLI (the loader already labelled it with the file).
    if (isSchemaTooNew(err)) {
      console.error(`error: ${err.message}`);
      return 3;
    }
    throw err;
  }
}
