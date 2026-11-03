import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from '../server.mjs';

test('서버는 공개 화면만 제공하고 저장소 및 파일 경로를 노출하지 않는다', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/', '/app.js', '/styles.css', '/lib/matching.js', '/lib/normalize-job.js', '/lib/state.js', '/data/jobs.js', '/vendor/kr-job-parser/index.js', '/vendor/kr-job-parser/location.js']) {
    const response = await fetch(base + route); assert.equal(response.status, 200, route);
    assert.ok(response.headers.get('content-security-policy'));
    assert.ok((await response.text()).length > 0);
  }
  for (const route of ['/.git/config', '/README.md', '/.env', '/server.mjs', '/missing', '/vendor/kr-job-parser/index.js.map', '/vendor/kr-job-parser/../package.json']) assert.equal((await fetch(base + route)).status, 404);
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  assert.equal(await (await fetch(base, { method: 'HEAD' })).text(), '');
});

test('import map은 CSP 해시로만 허용하고 unsafe-inline은 쓰지 않는다', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
  const csp = response.headers.get('content-security-policy');
  const html = await response.text();
  const importMap = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1];
  const hash = createHash('sha256').update(importMap).digest('base64');
  assert.ok(csp.includes(`'sha256-${hash}'`));
  assert.ok(!csp.includes('unsafe-inline'));
  assert.deepEqual(JSON.parse(importMap).imports, { 'kr-job-parser': './vendor/kr-job-parser/index.js' });
});

test('실데이터 파일이 없으면 500이 아니라 404로 알려 샘플로 넘어가게 한다', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/lib/load-jobs.js`)).status, 200);
  const live = await fetch(`${base}/data/live/snapshot.json`);
  assert.ok([200, 404].includes(live.status));
  if (live.status === 200) assert.match(live.headers.get('content-type'), /application\/json/);
});

test('정적 사이트 빌드는 서버와 같은 파일을 내보내고 CSP를 meta로 넣는다', async t => {
  const { buildSite } = await import('../scripts/build-site.mjs');
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const out = await mkdtemp(`${tmpdir()}/site-`);
  t.after(() => rm(out, { recursive: true, force: true }));
  const written = await buildSite(out);
  for (const file of ['/', '/app.js', '/lib/load-jobs.js', '/vendor/kr-job-parser/location.js']) assert.ok(written.includes(file), file);
  const html = await readFile(`${out}/index.html`, 'utf8');
  assert.match(html, /http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'sha256-/);
  assert.doesNotMatch(html, /frame-ancestors/);
});
