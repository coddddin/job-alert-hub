import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = path.dirname(fileURLToPath(import.meta.url));
// 워크스페이스 패키지의 빌드 결과물 위치. `pnpm build`로 먼저 만들어 둬야 한다.
const parserDist = path.dirname(fileURLToPath(import.meta.resolve('kr-job-parser')));
const js = 'text/javascript; charset=utf-8';

/** 경로 → [파일, Content-Type]. 정적 사이트 빌드(scripts/build-site.mjs)도 이 표를 그대로 쓴다. */
export const routes = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['public/app.js', js]],
  ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
  ['/lib/matching.js', ['lib/matching.js', js]],
  ['/lib/normalize-job.js', ['lib/normalize-job.js', js]],
  ['/lib/state.js', ['lib/state.js', js]],
  ['/data/jobs.js', ['data/jobs.js', js]],
  ['/lib/load-jobs.js', ['lib/load-jobs.js', js]],
  ['/lib/calendar.js', ['lib/calendar.js', js]],
  ['/lib/site-links.js', ['lib/site-links.js', js]],
  // `pnpm build`가 만드는 북마클릿. 없으면 404이고 웹은 설치 버튼만 숨긴다.
  ['/lib/bookmarklet.js', ['dist/bookmarklet.js', js]],
  // 수집기(apps/collector)가 만든 실데이터. 아직 수집하지 않았으면 404를 돌려 샘플로 넘어간다.
  ['/data/live/snapshot.json', ['data/live/snapshot.json', 'application/json; charset=utf-8']],
  ['/data/live/report.json', ['data/live/report.json', 'application/json; charset=utf-8']],
]);
for (const file of ['index', 'experience', 'location', 'deadline', 'normalize', 'fit']) {
  routes.set(`/vendor/kr-job-parser/${file}.js`, [path.join(parserDist, `${file}.js`), js]);
}

// index.html의 import map은 인라인 스크립트라 CSP에 해시로 허용한다 ('unsafe-inline'을 쓰지 않기 위해).
const html = readFileSync(path.join(root, 'public/index.html'), 'utf8');
const importMap = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
const importMapHash = createHash('sha256').update(importMap).digest('base64');
export const csp = `default-src 'self'; script-src 'self' 'sha256-${importMapHash}'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src https://www.jobkorea.co.kr; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;

export function createServer({ previewSnapshot = null } = {}) {
  // Per-instance routes: preview never changes production files or global routes.
  const activeRoutes = new Map(routes);
  if (previewSnapshot) {
    activeRoutes.set('/', ['public/preview.html', 'text/html; charset=utf-8']);
    activeRoutes.set('/preview.js', ['public/preview.js', js]);
    activeRoutes.set('/preview.css', ['public/preview.css', 'text/css; charset=utf-8']);
    activeRoutes.set('/lib/preview.js', ['lib/preview.js', js]);
    activeRoutes.set('/data/live/snapshot.json', [path.resolve(previewSnapshot), 'application/json; charset=utf-8']);
    activeRoutes.delete('/data/live/report.json');
  }
  return http.createServer(async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return;
    }
    const route = activeRoutes.get(new URL(req.url, 'http://localhost').pathname);
    if (!route) { res.writeHead(404).end('Not found'); return; }
    try {
      const body = await readFile(path.isAbsolute(route[0]) ? route[0] : path.join(root, route[0]));
      res.writeHead(200, {
        'Content-Type': route[1], 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': csp,
        ...(previewSnapshot ? { 'X-Job-Alert-Preview': '1' } : {}),
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      if (error?.code === 'ENOENT') res.writeHead(404).end('Not found');
      else res.writeHead(500).end('Unable to load page');
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, '127.0.0.1', () => console.log(`Job Alert Hub: http://127.0.0.1:${port}`));
}
