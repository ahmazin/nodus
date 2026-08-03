/**
 * `nodus render` — render a diagram file to a PNG, headless (native Skia via @napi-rs/canvas).
 * Two gotchas this handles: (1) system fonts must be loaded before painting or text renders blank;
 * (2) the node/edge TYPES in the file must be registered by a preset or they draw as nothing — so we
 * auto-detect the preset from the record `type` prefixes (overridable with `--preset`).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { Editor, type CreateCanvas, type NodusRecord, type Snapshot } from '@nodus-dev/core';
import { diagramsTheme, installDiagrams } from '@nodus-dev/preset-diagrams';
import { installInfraPreset } from '@nodus-dev/preset-infra';
import { installDrawTools } from '@nodus-dev/preset-draw';
import { restoreLabeled } from '../load.js';

export type Preset = 'diagrams' | 'infra' | 'draw';

/** Pick a preset from record type prefixes: `infra.*` → infra, `draw.*` → draw, else diagrams.
 *  Registries overwrite silently on duplicate types, so a wrong guess degrades gracefully. */
export function detectPreset(records: NodusRecord[]): Preset {
  let infra = false;
  let draw = false;
  for (const r of records) {
    const t = (r as { type?: string }).type ?? '';
    if (t.startsWith('infra.')) infra = true;
    else if (t.startsWith('draw.')) draw = true;
  }
  if (infra) return 'infra';
  if (draw) return 'draw';
  return 'diagrams';
}

export interface RenderOptions {
  out?: string;
  preset?: Preset;
  scale?: number;
  background?: boolean;
  grid?: boolean;
  /** Sink for a non-fatal load-diagnostics summary (dropped edges / repairs); the bin passes console.error. */
  onWarn?: (message: string) => void;
}

/**
 * Render `file` to a PNG. Returns the output path written. Throws `NodusError('schema-too-new')` (via
 * the shared loader) when the file was written by a newer Nodus, so the bin maps it to the "newer
 * file" exit code instead of rendering a mangled diagram.
 */
export async function render(file: string, opts: RenderOptions = {}): Promise<string> {
  const snap = JSON.parse(readFileSync(file, 'utf8')) as Snapshot;
  const loaded = restoreLabeled(snap, file);
  if (loaded.warning) opts.onWarn?.(loaded.warning);
  const preset = opts.preset ?? detectPreset(loaded.records);

  // Headless text renders blank unless the process loads system fonts first.
  (GlobalFonts as { loadSystemFonts?: () => number }).loadSystemFonts?.();

  const ed = new Editor();
  if (preset === 'infra') installInfraPreset(ed);
  else if (preset === 'draw') installDrawTools(ed);
  else {
    installDiagrams(ed);
    ed.setTheme(diagramsTheme);
  }
  ed.loadSnapshot(snap, { fit: true });

  if (!ed.sceneIndex.contentBounds()) throw new Error(`nothing to render — ${file} has no visible content`);

  const create: CreateCanvas = (w, h) => createCanvas(w, h) as unknown as ReturnType<CreateCanvas>;
  const png = await ed.toPNG(create, {
    pixelRatio: opts.scale ?? 2,
    background: opts.background !== false,
    grid: opts.grid === true,
    padding: 40,
  });

  const out = opts.out ?? defaultOut(file);
  writeFileSync(out, png);
  return out;
}

function defaultOut(file: string): string {
  return `${file.replace(/\.(nodus\.json|json)$/i, '')}.png`;
}
