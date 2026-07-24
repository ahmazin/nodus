// Documentation-drift guard (F19). Each documented "core quickstart" code block is lifted VERBATIM
// into this file: the code is compiled by `pnpm typecheck` and executed by vitest, and a drift test
// reads the source doc and asserts the fenced block still matches the copy here. So a change on either
// side — the doc or the API — fails CI: edit the API and the executed copy stops compiling; edit the
// doc block and the drift assertion fails until this file is updated to match.
//
// Sources covered: README.md (§ Headless) and apps/site/src/pages/docs/index.md (§ Headless /
// framework-agnostic). headless.md's toPNG recipe is NOT yet covered — its cast forms
// (`GlobalFonts.loadSystemFonts()` and `as ReturnType<CreateCanvas>`) do not typecheck; once corrected
// to the CLI's proven form they should be added here.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Editor } from '@nodus/core';
import { installInfraPreset } from '@nodus/preset-infra';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');

/** Extract the first ```ts fenced block that appears after `heading` in a markdown string. */
function tsBlockUnder(md: string, heading: string): string {
  const from = md.indexOf(heading);
  if (from < 0) throw new Error(`heading not found: ${heading}`);
  const fenceOpen = md.indexOf('```ts', from);
  if (fenceOpen < 0) throw new Error(`no ts block after: ${heading}`);
  const bodyStart = md.indexOf('\n', fenceOpen) + 1;
  const fenceClose = md.indexOf('```', bodyStart);
  return md.slice(bodyStart, fenceClose).trim();
}

// ── README.md § Headless (Node / any bundler) ──────────────────────────────────────────────────
// Verbatim copy of the fenced block; the drift test below asserts README.md still contains exactly it.
const README_HEADLESS = `import { Editor } from '@nodus/core';
import { installInfraPreset } from '@nodus/preset-infra';

const editor = new Editor({ viewport: { w: 1200, h: 700 } });
installInfraPreset(editor);

const a = editor.createNode({ type: 'infra.service', label: 'API', x: 0, y: 0 });
const b = editor.createNode({ type: 'infra.db', label: 'Postgres', x: 300, y: 0 });
editor.connect({ kind: 'node', nodeId: a, portId: 'out' }, { kind: 'node', nodeId: b, portId: 'in' });

const json = editor.toJSON(); // canonical, diff-friendly snapshot`;

// ── docs/index.md § Headless / framework-agnostic ──────────────────────────────────────────────
const DOCS_INDEX_HEADLESS = `import { Editor } from '@nodus/core';
import { installInfraPreset } from '@nodus/preset-infra';

const editor = new Editor({ viewport: { w: 1200, h: 700 } });
installInfraPreset(editor);

// mutate through the one channel (undo + scene index + events stay in sync)
editor.createNode({ type: 'lambda', label: 'Auth', props: { x: 120, y: 80 } });

// paint to any Ctx2D surface (DOM canvas or Skia) via editor.paintRegion(...)`;

describe('doc snippets — drift guard (F19)', () => {
  it('README.md § Headless block still matches the verbatim copy', () => {
    expect(tsBlockUnder(read('README.md'), '### Headless (Node / any bundler)')).toBe(README_HEADLESS);
  });

  it('docs/index.md § Headless block still matches the verbatim copy', () => {
    expect(tsBlockUnder(read('apps/site/src/pages/docs/index.md'), '## Headless / framework-agnostic')).toBe(
      DOCS_INDEX_HEADLESS,
    );
  });
});

describe('doc snippets — compile + run (F19)', () => {
  it('README.md § Headless quickstart compiles and produces the diagram it claims', () => {
    // FROM: README.md § Headless (Node / any bundler) — mirrors README_HEADLESS (imports hoisted above).
    const editor = new Editor({ viewport: { w: 1200, h: 700 } });
    installInfraPreset(editor);

    const a = editor.createNode({ type: 'infra.service', label: 'API', x: 0, y: 0 });
    const b = editor.createNode({ type: 'infra.db', label: 'Postgres', x: 300, y: 0 });
    editor.connect({ kind: 'node', nodeId: a, portId: 'out' }, { kind: 'node', nodeId: b, portId: 'in' });

    const json = editor.toJSON(); // canonical, diff-friendly snapshot

    const records = json.document.records;
    expect(records.filter((r) => r.typeName === 'node')).toHaveLength(2);
    expect(records.filter((r) => r.typeName === 'edge')).toHaveLength(1);
  });

  it('docs/index.md § Headless quickstart compiles and runs', () => {
    // FROM: docs/index.md § Headless / framework-agnostic — mirrors DOCS_INDEX_HEADLESS.
    const editor = new Editor({ viewport: { w: 1200, h: 700 } });
    installInfraPreset(editor);

    // mutate through the one channel (undo + scene index + events stay in sync)
    editor.createNode({ type: 'lambda', label: 'Auth', props: { x: 120, y: 80 } });

    expect(editor.store.nodes()).toHaveLength(1);
  });
});
