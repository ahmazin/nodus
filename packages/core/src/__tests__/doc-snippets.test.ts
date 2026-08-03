// Documentation-drift guard (F19). Each documented "core quickstart" code block is lifted VERBATIM
// into this file: the code is compiled by `pnpm typecheck` and executed by vitest, and a drift test
// reads the source doc and asserts the fenced block still matches the copy here. So a change on either
// side — the doc or the API — fails CI: edit the API and the executed copy stops compiling or throws;
// edit the doc block and the drift assertion fails until this file is updated to match.
//
// Sources covered:
//   • README.md § Headless (Node / any bundler)
//   • apps/site/src/pages/docs/index.md § Headless / framework-agnostic
//   • apps/site/src/pages/docs/headless.md § Render a diagram to PNG
//
// Wiring these up already earned its keep: it caught that docs/index.md's quickstart THREW
// (`createNode({ type: 'lambda' })` — createNode refuses unregistered types since #33/#36) and that
// headless.md's toPNG recipe did not typecheck (`GlobalFonts.loadSystemFonts()` and a bare
// `as ReturnType<CreateCanvas>` cast). Both are fixed; this test now pins them so they can't regress.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { Editor, type CreateCanvas } from '@nodus-dev/core';
import { installInfraPreset } from '@nodus-dev/preset-infra';

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

// Verbatim copies of the doc blocks; the drift tests assert each doc still contains exactly these.
const README_HEADLESS = `import { Editor } from '@nodus-dev/core';
import { installInfraPreset } from '@nodus-dev/preset-infra';

const editor = new Editor({ viewport: { w: 1200, h: 700 } });
installInfraPreset(editor);

const a = editor.createNode({ type: 'infra.service', label: 'API', x: 0, y: 0 });
const b = editor.createNode({ type: 'infra.db', label: 'Postgres', x: 300, y: 0 });
editor.connect({ kind: 'node', nodeId: a, portId: 'out' }, { kind: 'node', nodeId: b, portId: 'in' });

const json = editor.toJSON(); // canonical, diff-friendly snapshot`;

const DOCS_INDEX_HEADLESS = `import { Editor } from '@nodus-dev/core';
import { installInfraPreset } from '@nodus-dev/preset-infra';

const editor = new Editor({ viewport: { w: 1200, h: 700 } });
installInfraPreset(editor);

// mutate through the one channel (undo + scene index + events stay in sync)
editor.createNode({ type: 'infra.service', label: 'Auth', x: 120, y: 80 });

// paint to any Ctx2D surface (DOM canvas or Skia) via editor.paintRegion(...)`;

const HEADLESS_TOPNG = `import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { Editor, type CreateCanvas } from '@nodus-dev/core';
import { installInfraPreset } from '@nodus-dev/preset-infra';

// 1. Load system fonts BEFORE painting (see the prerequisite below). @napi-rs/canvas's types omit
//    loadSystemFonts, so reach it through a narrow cast — the same as the \`nodus\` CLI does.
(GlobalFonts as { loadSystemFonts?: () => number }).loadSystemFonts?.();

// 2. Register the node/edge types the document uses.
const editor = new Editor();
installInfraPreset(editor);
editor.createNode({ type: 'infra.service', label: 'API', x: 0, y: 0 });

// 3. Inject the canvas factory and export.
const create: CreateCanvas = (w, h) => createCanvas(w, h) as unknown as ReturnType<CreateCanvas>;
const png: Uint8Array = await editor.toPNG(create, { pixelRatio: 2, background: true });`;

describe('doc snippets — drift guard (F19)', () => {
  it('README.md § Headless matches the verbatim copy', () => {
    expect(tsBlockUnder(read('README.md'), '### Headless (Node / any bundler)')).toBe(README_HEADLESS);
  });

  it('docs/index.md § Headless matches the verbatim copy', () => {
    expect(tsBlockUnder(read('apps/site/src/pages/docs/index.md'), '## Headless / framework-agnostic')).toBe(
      DOCS_INDEX_HEADLESS,
    );
  });

  it('headless.md § Render a diagram to PNG matches the verbatim copy', () => {
    expect(tsBlockUnder(read('apps/site/src/pages/docs/headless.md'), '## Render a diagram to PNG')).toBe(
      HEADLESS_TOPNG,
    );
  });
});

describe('doc snippets — compile + run (F19)', () => {
  it('README.md § Headless quickstart produces the diagram it claims', () => {
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

  it('docs/index.md § Headless quickstart creates a positioned node', () => {
    // FROM: docs/index.md § Headless / framework-agnostic — mirrors DOCS_INDEX_HEADLESS.
    const editor = new Editor({ viewport: { w: 1200, h: 700 } });
    installInfraPreset(editor);

    // mutate through the one channel (undo + scene index + events stay in sync)
    editor.createNode({ type: 'infra.service', label: 'Auth', x: 120, y: 80 });

    const [node] = editor.store.nodes();
    expect(node).toBeDefined();
    expect([node!.x, node!.y]).toEqual([120, 80]); // guards against the props:{x,y} regression
  });

  it('headless.md § toPNG recipe renders a PNG', async () => {
    // FROM: headless.md § Render a diagram to PNG — mirrors HEADLESS_TOPNG (imports hoisted above).
    (GlobalFonts as { loadSystemFonts?: () => number }).loadSystemFonts?.();

    const editor = new Editor();
    installInfraPreset(editor);
    editor.createNode({ type: 'infra.service', label: 'API', x: 0, y: 0 });

    const create: CreateCanvas = (w, h) => createCanvas(w, h) as unknown as ReturnType<CreateCanvas>;
    const png: Uint8Array = await editor.toPNG(create, { pixelRatio: 2, background: true });

    expect(png.byteLength).toBeGreaterThan(0);
  });
});
