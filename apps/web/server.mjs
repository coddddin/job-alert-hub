import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const routes = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
  ['/lib/matching.js', ['lib/matching.js', 'text/javascript; charset=utf-8']],
  ['/lib/state.js', ['lib/state.js', 'text/javascript; charset=utf-8']],
  ['/data/jobs.js', ['data/jobs.js', 'text/javascript; charset=utf-8']],
]);
export function createServer() {
  return http.createServer(async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return;
    }
    const route = routes.get(new URL(req.url, 'http://localhost').pathname);
    if (!route) { res.writeHead(404).end('Not found'); return; }
    try {
      const body = await readFile(path.join(root, route[0]));
      res.writeHead(200, {
        'Content-Type': route[1], 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(500).end('Unable to load page'); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, '127.0.0.1', () => console.log(`Job Alert Hub: http://127.0.0.1:${port}`));
}
