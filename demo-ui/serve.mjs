// TEMPORARY demo page (interim client update). Delete the whole demo-ui folder and the lines marked DEMO-UI in
// run.mjs when it is no longer needed; nothing else depends on it.
// Serves the page on its own port and forwards /bi/* and /auth/* to the main server, so it uses the same API and
// sign-in as the main UI without changing it.
import { createServer, request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.DEMO_PORT ?? 1977);
const api = { host: 'localhost', port: Number(process.env.API_PORT ?? 1976) };
const FILES = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

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
  const file = FILES[path];
  if (!file || req.method !== 'GET') {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)], 'Cache-Control': 'no-store' });
  res.end(await readFile(join(here, file)));
}).listen(port, () => console.log(`Demo page on http://localhost:${port}`));
