import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';

test('서버는 공개 화면만 제공하고 저장소 및 파일 경로를 노출하지 않는다', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/', '/app.js', '/styles.css', '/lib/matching.js', '/lib/state.js', '/data/jobs.js']) {
    const response = await fetch(base + route); assert.equal(response.status, 200, route);
    assert.ok(response.headers.get('content-security-policy'));
    assert.ok((await response.text()).length > 0);
  }
  for (const route of ['/.git/config', '/README.md', '/.env', '/server.mjs', '/missing']) assert.equal((await fetch(base + route)).status, 404);
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  assert.equal(await (await fetch(base, { method: 'HEAD' })).text(), '');
});
