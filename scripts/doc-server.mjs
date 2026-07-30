/**
 * Nodus doc server — persists diagram JSON to a git-tracked directory. Pair with @ahmazin/persistence's
 * HttpDocStore. No deps.
 *
 *   node scripts/doc-server.mjs
 *   HOST=100.126.63.89 PORT=8090 GIT_COMMIT=1 node scripts/doc-server.mjs   # expose on the tailnet + auto-commit
 *
 * SECURITY: binds to 127.0.0.1 by default (no network exposure). Set HOST to your Tailscale IP to
 * reach it across the tailnet — do NOT bind 0.0.0.0 on an untrusted LAN; there is no auth here.
 * CORS is an ORIGIN ALLOWLIST (loopback + the bound HOST + $ALLOW_ORIGIN), never '*', so a website
 * you happen to visit cannot reach through the browser to read/overwrite/delete your local diagrams.
 */
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = process.env.NODUS_DOCS ?? join(root, 'docs-data');
mkdirSync(DIR, { recursive: true });
const PORT = Number(process.env.PORT ?? 8090);
const HOST = process.env.HOST ?? '127.0.0.1';
const GIT = process.env.GIT_COMMIT === '1';

const MAX_BODY = 8 * 1024 * 1024; // 8 MB cap — a diagram JSON is far smaller; blocks OOM via a giant PUT
// CORS is an ORIGIN ALLOWLIST, not '*'. A wildcard would let any page you visit read/overwrite/delete
// your local diagrams through the browser. Loopback + the bound HOST + $ALLOW_ORIGIN are trusted.
const ALLOW = (process.env.ALLOW_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const originOk = (o) => {
  if (!o) return true; // non-browser (curl, server-to-server) or same-origin — no CORS needed
  if (ALLOW.includes(o)) return true;
  try {
    return LOOPBACK.has(new URL(o).hostname) || new URL(o).hostname === HOST;
  } catch {
    return false;
  }
};
const nameOk = (n) => /^[\w .-]{1,64}$/.test(n);
const file = (n) => join(DIR, `${n}.json`);

function list() {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const name = f.slice(0, -5);
      let nodes = 0;
      let edges = 0;
      try {
        const recs = JSON.parse(readFileSync(join(DIR, f), 'utf8')).document?.records ?? [];
        nodes = recs.filter((r) => r.typeName === 'node').length;
        edges = recs.filter((r) => r.typeName === 'edge').length;
      } catch {
        /* skip corrupt */
      }
      return { name, updated: statSync(join(DIR, f)).mtimeMs, nodes, edges };
    })
    .sort((a, b) => b.updated - a.updated);
}

function gitCommit(name) {
  if (!GIT) return;
  try {
    execFileSync('git', ['-C', DIR, 'add', '-A']);
    execFileSync('git', ['-C', DIR, 'commit', '-m', `autosave ${name}`, '--quiet']);
  } catch {
    /* not a git repo / nothing to commit — ignore */
  }
}

createServer((req, res) => {
  const origin = req.headers.origin;
  const allowed = originOk(origin);
  const send = (code, body, type = 'application/json') => {
    const headers = { 'content-type': type, vary: 'Origin' };
    if (origin && allowed) {
      headers['access-control-allow-origin'] = origin; // reflect the specific trusted origin, never '*'
      headers['access-control-allow-methods'] = 'GET,PUT,DELETE,OPTIONS';
      headers['access-control-allow-headers'] = 'content-type';
    }
    res.writeHead(code, headers).end(body);
  };

  // Reject browser requests from a non-allowlisted origin outright. CORS alone does NOT stop a
  // cross-origin "simple" GET/PUT from executing — only from being read — so we refuse to process it.
  if (origin && !allowed) return send(403, JSON.stringify({ error: 'forbidden origin' }));
  if (req.method === 'OPTIONS') return send(204, '');

  const parts = new URL(req.url, 'http://x').pathname.split('/').filter(Boolean);
  if (parts[0] !== 'docs') return send(404, JSON.stringify({ error: 'not found' }));
  const name = parts[1] ? decodeURIComponent(parts[1]) : null;

  if (!name) return send(200, JSON.stringify(list()));
  if (!nameOk(name)) return send(400, JSON.stringify({ error: 'bad name' }));

  if (req.method === 'GET') {
    if (!existsSync(file(name))) return send(404, JSON.stringify({ error: 'not found' }));
    return send(200, readFileSync(file(name), 'utf8'));
  }
  if (req.method === 'PUT') {
    let body = '';
    let size = 0;
    let aborted = false;
    req.on('data', (c) => {
      if (aborted) return;
      size += c.length;
      if (size > MAX_BODY) {
        aborted = true;
        send(413, JSON.stringify({ error: 'too large' }));
        req.destroy();
        return;
      }
      body += c;
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        JSON.parse(body);
      } catch {
        return send(400, JSON.stringify({ error: 'bad json' }));
      }
      writeFileSync(file(name), body);
      gitCommit(name);
      send(200, JSON.stringify({ ok: true }));
    });
    return;
  }
  if (req.method === 'DELETE') {
    if (existsSync(file(name))) unlinkSync(file(name));
    gitCommit(name);
    return send(200, JSON.stringify({ ok: true }));
  }
  send(405, JSON.stringify({ error: 'method not allowed' }));
}).listen(PORT, HOST, () => {
  console.log(`Nodus doc server → http://${HOST}:${PORT}/docs`);
  console.log(`  dir: ${DIR}   git-commit: ${GIT}   cors: loopback+${HOST}${ALLOW.length ? '+' + ALLOW.join(',') : ''}`);
});
