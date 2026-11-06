// TEMPORARY demo page (interim client update). Serves the demo build of the chat page (ui/dist-demo, built from
// ui/demo by `npm run build`) on its own port, and forwards /bi/* and /auth/* to the main server, so it uses the same
// API and sign-in as the main UI without changing it. Remove: see README.md in this folder.
import { createServer, request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'dist-demo');
const port = Number(process.env.DEMO_PORT ?? 1977);
const api = { host: 'localhost', port: Number(process.env.API_PORT ?? 1976) };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path.startsWith('/bi/') || path.startsWith('/auth/')) {
    // Forward as is; the response (including the answer stream) is passed through as it arrives.
    const upstream = request({ ...api, path: req.url, method: req.method, headers: { ...req.headers, host: `${api.host}:${api.port}` } }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    upstream.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `The main server is not running on port ${api.port}.` }));
    });
    req.pipe(upstream);
    res.on('close', () => upstream.destroy());
    return;
  }
  if (req.method !== 'GET') return res.writeHead(405).end();
  const rel = normalize(path === '/' ? 'index.html' : path).replace(/^([/\\])+/, '');
  if (rel.startsWith('..')) return res.writeHead(404).end();
  try {
    const body = await readFile(join(dist, rel));
    res.writeHead(200, { 'Content-Type': TYPES[extname(rel)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    try {
      res.writeHead(200, { 'Content-Type': TYPES['.html'] }).end(await readFile(join(dist, 'index.html')));
    } catch {
      res.writeHead(503, { 'Content-Type': 'text/plain' }).end('The demo page is not built yet. Run: npm run build');
    }
  }
}).listen(port, () => console.log(`Demo page on http://localhost:${port}`));
