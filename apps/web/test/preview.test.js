import test from 'node:test';
import assert from 'node:assert/strict';
import { previewJobs, filterPreview, mergePreviewSnapshots, sourceUrl, experienceSummary } from '../lib/preview.js';
import { createServer, routes } from '../server.mjs';
import { fileURLToPath } from 'node:url';

const job = (id, raw = {}) => ({ id, source: id.split(':')[0], company: '예시 회사', title: '개발자 모집', kind: 'other', raw: { experience: '경력무관', location: '서울', deadline: '상시채용', ...raw } });
const batch = jobs => ({ version: 1, today: '2026-11-15', jobs });

test('경력 해석에 연차 조건을 표시한다', () => {
  const jobs = previewJobs(batch([job('jobkorea:1', { experience: '경력3년↑' })]));
  assert.equal(experienceSummary(jobs[0].parsed.experience), '경력 · 3년 이상');
});

test('다른 출처와 미분류 직무도 처음에는 모두 표시한다', () => {
  const merged = mergePreviewSnapshots(batch([job('alio:1')]), batch([job('jobkorea:2')]));
  const jobs = previewJobs(merged);
  assert.equal(filterPreview(jobs).length, 2);
  assert.equal(filterPreview(jobs, { source: 'alio' })[0].id, 'alio:1');
  assert.throws(() => mergePreviewSnapshots(batch([job('alio:1')]), batch([job('alio:1')])));
  assert.throws(() => mergePreviewSnapshots({ ...batch([]), today: '2026-11-14' }, batch([])));
});
test('검색·경력·지역·마감 필터는 원문 해석을 사용하고 미상 지역을 보존한다', () => {
  const jobs = previewJobs(batch([job('jobkorea:1'), job('jobkorea:2', { experience: '경력3년↑', location: '부산', deadline: '2026.11.14' }), job('alio:1', { location: '' })]));
  assert.equal(filterPreview(jobs, { keyword: '없는말' }).length, 0);
  assert.equal(filterPreview(jobs, { keyword: '예시 개발자', region: '서울' }).length, 2);
  assert.equal(filterPreview(jobs, { experience: 'experienced' }).length, 1);
  assert.equal(filterPreview(jobs, { includeClosed: false }).length, 2);
});
test('잘못된 입력과 위험한 링크는 거부한다', () => {
  for (const value of [null, {}, batch([{}]), batch([job('a:1'), job('a:1')])]) assert.throws(() => previewJobs(value));
  for (const value of ['javascript:alert(1)', 'file:///x', 'https://user:pass@example.com', null]) assert.equal(sourceUrl(value), null);
  assert.equal(sourceUrl('https://example.com/job'), 'https://example.com/job');
});
test('미리보기 라우트가 기본 서버나 임의 로컬 파일을 노출하지 않는다', async t => {
  const snapshot = fileURLToPath(new URL('./fixtures/preview-snapshot.json', import.meta.url));
  const servers = [createServer({ previewSnapshot: snapshot }), createServer()];
  for (const server of servers) {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
  }
  const [preview, normal] = servers.map(server => `http://127.0.0.1:${server.address().port}`);
  assert.match(await (await fetch(preview)).text(), /수집한 공고/);
  assert.match(await (await fetch(normal)).text(), /지금 지원할 공고/);
  assert.equal((await fetch(`${preview}/data/live/snapshot.json`)).status, 200);
  assert.equal((await fetch(`${normal}/preview.js`)).status, 404);
  assert.equal((await fetch(`${preview}/data/live/report.json`)).status, 404);
  assert.equal((await fetch(`${preview}/.scrapling-local/batch.json`)).status, 404);
  assert.equal(routes.has('/preview.js'), false);
});
