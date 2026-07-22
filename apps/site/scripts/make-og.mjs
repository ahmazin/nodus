// Generate ../public/og-image.png (1200x630) — branded social card for Nodus.
// Run:  node apps/site/scripts/make-og.mjs   (uses @napi-rs/canvas from the workspace root)
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

GlobalFonts.loadSystemFonts?.();
const fams = GlobalFonts.families?.map((f) => f.family) ?? [];
const pick = (res, fb) => fams.find((f) => res.some((r) => new RegExp(r, 'i').test(f))) ?? fb;
// Prefer the brand faces if installed; otherwise fall back to whatever sans/mono the OS has.
const SANS = pick(['^Space Grotesk$', 'DejaVu Sans$', 'Liberation Sans', '^Noto Sans$', 'Arial', 'sans'], 'sans-serif');
const MONO = pick(['JetBrains Mono', 'DejaVu Sans Mono', 'Liberation Mono', 'Noto Sans Mono', 'monospace'], 'monospace');

const W = 1200, H = 630;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');

const ACCENT = '#c4f24e', FG = '#e9e9ee', FG2 = '#9fa2ad', FG3 = '#676a76', BG = '#0a0b0e';

ctx.fillStyle = BG;
ctx.fillRect(0, 0, W, H);

ctx.fillStyle = 'rgba(255,255,255,0.05)';
for (let y = 20; y < H; y += 26) for (let x = 20; x < W; x += 26) { ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill(); }

const glow = ctx.createRadialGradient(1010, 40, 0, 1010, 40, 520);
glow.addColorStop(0, 'rgba(196,242,78,0.20)');
glow.addColorStop(1, 'rgba(196,242,78,0)');
ctx.fillStyle = glow;
ctx.fillRect(0, 0, W, H);

// Nodus node-mark (24x24 viewBox), scaled by k.
function mark(ox, oy, k) {
  const P = (x, y) => [ox + x * k, oy + y * k];
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth = 1.4 * k;
  const seg = (a, b, c, d) => { ctx.beginPath(); ctx.moveTo(...P(a, b)); ctx.lineTo(...P(c, d)); ctx.stroke(); };
  seg(6.7, 8, 10.6, 15.8); seg(17, 8, 13.3, 15.8); seg(7.4, 6.4, 16.2, 6);
  ctx.fillStyle = ACCENT;
  ctx.beginPath(); ctx.arc(...P(5, 6.5), 2.5 * k, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = FG; ctx.lineWidth = 1.6 * k;
  ctx.beginPath(); ctx.arc(...P(18.5, 6), 2.3 * k, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(...P(12, 18), 2.5 * k, 0, Math.PI * 2); ctx.stroke();
}
mark(84, 78, 1.7);

ctx.textBaseline = 'alphabetic';
ctx.fillStyle = FG;
ctx.font = `600 40px ${SANS}`;
ctx.fillText('Nodus', 150, 122);

ctx.fillStyle = FG;
ctx.font = `600 104px ${SANS}`;
ctx.fillText('Git-native', 84, 320);
ctx.fillText('diagrams.', 84, 428);

ctx.fillStyle = FG2;
ctx.font = `400 30px ${SANS}`;
ctx.fillText('The headless, extensible diagram engine for TypeScript.', 88, 496);

ctx.fillStyle = ACCENT;
ctx.fillRect(88, 556, 12, 12);
ctx.fillStyle = FG3;
ctx.font = `500 22px ${MONO}`;
ctx.fillText('MIT  ·  framework-agnostic  ·  deterministic .nodus.json', 112, 567);

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'og-image.png');
writeFileSync(out, canvas.toBuffer('image/png'));
console.log('wrote', out, '(fonts:', SANS, '/', MONO + ')');
