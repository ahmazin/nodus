/* Build the self-contained Nodus playground: bundle the engine to an IIFE, then inline it + the
 * wiring into one HTML file with the chrome. Output: examples/output/nodus-playground.html */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// locate an esbuild binary (dependency of tsup/vite) and bundle the engine to an IIFE
function findEsbuild() {
  const base = join(root, 'node_modules', '.pnpm');
  const dir = readdirSync(base).find((d) => d.startsWith('esbuild@') && !d.includes('linux'));
  const bin = dir && join(base, dir, 'node_modules', 'esbuild', 'bin', 'esbuild');
  if (!bin || !existsSync(bin)) throw new Error('esbuild binary not found; run pnpm install');
  return bin;
}
const bundlePath = join(tmpdir(), 'nodus.iife.js');
execFileSync(findEsbuild(), [
  join(root, 'scripts', 'artifact-entry.ts'),
  '--bundle', '--format=iife', '--global-name=Nodus', '--platform=browser',
  '--target=es2020', '--minify', '--legal-comments=none', `--outfile=${bundlePath}`,
], { stdio: 'inherit' });

const esc = (s) => s.replaceAll('</script', '<\\/script');
const bundle = esc(readFileSync(bundlePath, 'utf8'));
const wiring = esc(readFileSync(join(root, 'scripts', 'artifact-wiring.js'), 'utf8'));

const STYLE = `
:root{
  --bg:#060907; --panel:#0a100d; --panel-2:#0d1411; --line:#172019; --line-2:#28322c;
  --text:#e7ece9; --dim:#8b958f; --faint:#556058; --accent:#10b981; --accent-soft:rgba(16,185,129,.13);
  --mono:ui-monospace,"JetBrains Mono","SF Mono",Menlo,Consolas,monospace;
  --sans:system-ui,-apple-system,"Segoe UI",sans-serif;
}
*{box-sizing:border-box}
.app{position:fixed;inset:0;display:flex;flex-direction:column;background:var(--bg);color:var(--text);font-family:var(--mono);font-size:13px;-webkit-font-smoothing:antialiased}
.app.lightcanvas .stage{background:#f6f7f5}
header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 18px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.brand{display:flex;align-items:baseline;gap:12px;min-width:0}
.mark{font-family:var(--sans);font-weight:700;font-size:19px;letter-spacing:-.02em;color:var(--text);display:flex;align-items:center;gap:9px}
.dot{width:9px;height:9px;border-radius:2px;background:var(--accent);box-shadow:0 0 12px -1px var(--accent);transform:rotate(45deg)}
.tag{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint)}
.legend{display:flex;gap:14px;flex-wrap:wrap}
.leg{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dim)}
.leg i{width:20px;height:11px;border-radius:3px;border:1px solid;display:inline-block}
.leg.known i{border-color:var(--accent);box-shadow:0 0 8px -2px var(--accent)}
.leg.neutral i{border-color:#3a423f}
.leg.prev i{border-color:#1c2320;opacity:.55}
.leg.inferred i{border-color:#28322c;border-style:dashed}
.toolbar{display:flex;align-items:center;gap:8px;padding:10px 18px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.seg{display:flex;gap:4px;padding:3px;border:1px solid var(--line);border-radius:9px;background:var(--panel)}
button,select{font-family:var(--mono);font-size:12px;color:var(--text);background:var(--panel-2);border:1px solid var(--line-2);border-radius:7px;padding:6px 11px;cursor:pointer;transition:border-color .12s,color .12s,background .12s}
.seg button{border-color:transparent;background:transparent;padding:5px 11px}
button:hover:not(:disabled){border-color:var(--accent);color:var(--accent)}
.seg button.on{background:var(--accent-soft);border-color:var(--accent);color:var(--accent)}
button:disabled{opacity:.35;cursor:default}
select:hover{border-color:var(--accent)}
.sep{width:1px;height:24px;background:var(--line-2);margin:0 3px}
.spacer{flex:1}
.stat{font-size:11.5px;color:var(--faint);font-variant-numeric:tabular-nums}
.stage{position:relative;flex:1;overflow:hidden;outline:none}
canvas{display:block;touch-action:none}
#edit{position:absolute;display:none;resize:none;border:1px solid var(--accent);border-radius:7px;background:#0c100f;color:#e5e5e5;font-family:var(--mono);font-size:11px;text-align:center;outline:none;padding:0;box-sizing:border-box}
.hint{position:absolute;left:16px;bottom:14px;font-size:11px;color:var(--faint);pointer-events:none;line-height:1.6;max-width:min(560px,60vw)}
.hint b{color:var(--dim);font-weight:500}
#mini{position:absolute;right:14px;bottom:14px;border:1px solid var(--line-2);border-radius:8px;background:#0b110e;cursor:pointer;box-shadow:0 6px 20px -8px rgba(0,0,0,.7)}
.ctxmenu{position:absolute;display:none;min-width:176px;background:#0d1310;border:1px solid var(--line-2);border-radius:9px;padding:5px;box-shadow:0 14px 40px -16px rgba(0,0,0,.8);font-size:12.5px;z-index:20;font-family:var(--mono)}
.ctxmenu .item{padding:7px 10px;border-radius:6px;cursor:pointer;color:#cdd5d0}
.ctxmenu .item:hover{background:var(--accent-soft);color:var(--accent)}
.ctxmenu .item.danger{color:#f87171}
.ctxmenu .item.danger:hover{background:rgba(248,113,113,.12)}
.mmodal{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(3,6,5,.62);z-index:30}
.mmodal.on{display:flex}
.mmbox{width:min(560px,92%);background:var(--panel);border:1px solid var(--line-2);border-radius:12px;padding:16px;box-shadow:0 24px 70px -24px rgba(0,0,0,.85);font-family:var(--mono)}
.mmhead{font-size:13px;color:var(--text);margin-bottom:10px}
.mmsub{color:var(--faint);font-size:11px;margin-left:6px}
#mtext{width:100%;height:190px;resize:vertical;box-sizing:border-box;background:#070b09;color:var(--text);border:1px solid var(--line-2);border-radius:8px;padding:10px;font-family:var(--mono);font-size:12.5px;line-height:1.5}
.mmerr{color:#f87171;font-size:11.5px;min-height:15px;margin:6px 2px}
.mmrow{display:flex;align-items:center;gap:8px;margin-top:6px}
.mmrow .prim{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
@media (max-width:720px){.legend{display:none}.hint{display:none}#mini{display:none}}
`;

const MARKUP = `
<div class="app" id="app">
  <header>
    <div class="brand">
      <span class="mark"><span class="dot"></span>Nodus</span>
      <span class="tag">canvas diagram engine · live &amp; interactive</span>
    </div>
    <div class="legend">
      <span class="leg known"><i></i>known</span>
      <span class="leg neutral"><i></i>neutral</span>
      <span class="leg prev"><i></i>previous</span>
      <span class="leg inferred"><i></i>inferred</span>
    </div>
  </header>
  <div class="toolbar">
    <div class="seg">
      <button id="t-select" class="on">Select</button>
      <button id="t-connect">Connect</button>
      <button id="t-create">Create</button>
    </div>
    <select id="type" title="node type to create"></select>
    <span class="sep"></span>
    <div class="seg" title="draw shapes — R E D T L A">
      <button id="d-rect" title="Rectangle (R)">▭</button>
      <button id="d-ellipse" title="Ellipse (E)">◯</button>
      <button id="d-diamond" title="Diamond (D)">◇</button>
      <button id="d-text" title="Text (T)">T</button>
      <button id="d-line" title="Line (L)">╱</button>
      <button id="d-arrow" title="Arrow (A)">→</button>
    </div>
    <span class="sep"></span>
    <button id="undo">Undo</button>
    <button id="redo">Redo</button>
    <button id="del">Delete</button>
    <button id="dup">Duplicate</button>
    <button id="group">Group</button>
    <button id="ungroup">Ungroup</button>
    <span class="sep"></span>
    <select id="router" title="edge router">
      <option value="orthogonal">orthogonal</option>
      <option value="straight">straight</option>
      <option value="bezier">bezier</option>
    </select>
    <button id="snap" class="on">Snap: On</button>
    <span class="sep"></span>
    <select id="layout-kind" title="layout engine">
      <option value="dagre">dagre</option>
      <option value="tree">tree</option>
      <option value="force">force</option>
    </select>
    <button id="layout">Auto-layout</button>
    <button id="fit">Fit</button>
    <button id="copy" title="copy selection (or all) as a PNG image">Copy PNG</button>
    <button id="mermaid" title="import a Mermaid flowchart / state / ER diagram">⤓ Mermaid</button>
    <button id="flow" title="animate packets flowing along the connections">⇢ Flow</button>
    <button id="live" title="simulate live traffic: packet speed + color track each link's health">📊 Live</button>
    <button id="reset" title="clear + reload the sample">Reset</button>
    <button id="theme">Theme: Infra Dark</button>
    <span class="spacer"></span>
    <span class="stat" id="stat"></span>
  </div>
  <div class="stage" id="stage" tabindex="0">
    <canvas id="c"></canvas>
    <textarea id="edit" spellcheck="false"></textarea>
    <canvas id="mini" width="200" height="130"></canvas>
    <div id="ctx" class="ctxmenu"></div>
    <div id="mmodal" class="mmodal">
      <div class="mmbox">
        <div class="mmhead">Import Mermaid <span class="mmsub">flowchart · stateDiagram · erDiagram → laid out with dagre</span></div>
        <textarea id="mtext" spellcheck="false"></textarea>
        <div id="merr" class="mmerr"></div>
        <div class="mmrow">
          <select id="msample" title="load a sample">
            <option value="flow">Sample: flowchart</option>
            <option value="state">Sample: state</option>
            <option value="er">Sample: ER</option>
          </select>
          <span class="spacer"></span>
          <button id="mx">Cancel</button>
          <button id="mgo" class="prim">Import</button>
        </div>
      </div>
    </div>
    <div class="hint">
      <b>R/E/D/T/L/A</b> draw shapes/text/arrows · <b>drag a handle</b> to resize · <b>right-click</b> → style &amp; z-order · <b>double-click</b> to rename · <b>space</b>/middle-drag to pan · <b>ctrl+scroll</b> to zoom · edits <b>autosave</b> (Reset to restore the sample)
    </div>
  </div>
</div>`;

const html = `<title>Nodus — live diagram engine</title>
<style>${STYLE}</style>
${MARKUP}
<script>${bundle}</script>
<script>${wiring}</script>`;

const outDir = join(root, 'examples', 'output');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'nodus-playground.html');
writeFileSync(outFile, html);
console.log(`wrote ${outFile}  (${(html.length / 1024).toFixed(0)} KB)`);
