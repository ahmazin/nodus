// Render a Nodus diagram to a PNG headlessly (native Skia via @napi-rs/canvas) — no browser.
// Mirrors the recipe in the docs: https://nodus.dev/docs/headless
import { writeFileSync } from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { Editor, type CreateCanvas } from '@nodus/core';
import { installInfraPreset } from '@nodus/preset-infra';

// 1. Load system fonts BEFORE painting, or text renders blank. (@napi-rs/canvas's types omit
//    loadSystemFonts, so we reach it through a narrow cast — the same as the `nodus` CLI does.)
(GlobalFonts as { loadSystemFonts?: () => number }).loadSystemFonts?.();

// 2. Register the node/edge types the document uses (unregistered types draw as nothing).
const editor = new Editor();
installInfraPreset(editor);
const api = editor.createNode({ type: 'infra.service', label: 'API', x: 0, y: 0 });
const db = editor.createNode({ type: 'infra.db', label: 'Postgres', x: 300, y: 0 });
editor.connect({ kind: 'node', nodeId: api, portId: 'out' }, { kind: 'node', nodeId: db, portId: 'in' });

// 3. Inject the canvas factory (Nodus never imports a canvas backend itself) and export.
const create: CreateCanvas = (w, h) => createCanvas(w, h) as unknown as ReturnType<CreateCanvas>;
const png = await editor.toPNG(create, { pixelRatio: 2, background: true });

writeFileSync('diagram.png', png);
console.log(`wrote diagram.png (${png.byteLength} bytes)`);
