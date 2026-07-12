/* Serve the self-contained Nodus playground on the local network (no deps).
 * Usage: node scripts/serve-playground.mjs  (PORT/HOST env optional) */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'examples', 'output', 'nodus-playground.html');
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';

const server = createServer((_req, res) => {
  try {
    const html = readFileSync(file); // re-read each request so rebuilds show up
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(e));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Nodus playground serving on:`);
  console.log(`  http://192.168.1.218:${PORT}/   (LAN)`);
  console.log(`  http://localhost:${PORT}/        (this host)`);
  console.log(`bound ${HOST}:${PORT} — Ctrl-C to stop`);
});
