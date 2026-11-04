import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJobs, safeUrl } from '../lib/load-jobs.js';
import { matchJob } from '../lib/matching.js';

const snapshot = {
  version: 1,
  collectedAt: '2026-11-02T21:17:00.000Z',
  today: '2026-11-03',
  sources: [{ name: 'alio', label: '잡알리오 (공공데이터포털)', total: 2, skipped: 0 }],
  jobs: [
    { id: 'alio:1', source: '잡알리오', company: '한국테스트공사', title: '전산직 채용', url: 'https://example.com', applyUrl: 'https://job.alio.go.kr/recruitview.do?idx=1', raw: { experience: '신입+경력', location: '서울,전남광주', deadline: '20261117' }, kind: 'development', role: '전산·IT', employment: '정규직', tags: ['정보통신'], description: '' },
    { id: 'alio:2', source: '잡알리오', company: '한국테스트공단', title: '사무직 채용', url: 'javascript:alert(1)', raw: { experience: '경력', location: '해외', deadline: '20261101' }, kind: 'other', role: '경영.회계.사무', employment: '정규직', tags: [], description: '' },
  ],
};
const respond = (body, status = 200) => async () => new Response(JSON.stringify(body), { status });

test('실데이터 스냅샷이 있으면 원문을 해석해 쓴다', async () => {
  const data = await loadJobs({ fetch: respond(snapshot) });
  assert.equal(data.mode, 'live');
  assert.equal(data.today, '2026-11-03');
  const [it, office] = data.jobs;
  assert.equal(it.experience, 'new');
  assert.deepEqual(it.locations, ['서울', '광주', '전남']);
  assert.equal(it.deadline, '2026-11-17');
  assert.deepEqual(it.skills, ['정보통신']);
  assert.equal(matchJob(it, { role: 'all', region: '광주', includeUnspecified: true, keyword: '' }).status, 'match');
  assert.equal(office.closed, true, '기준일보다 지난 마감은 닫힌 공고');
});

test('http(s)가 아닌 원문 링크는 버린다', async () => {
  const data = await loadJobs({ fetch: respond(snapshot) });
  assert.equal(data.jobs[1].url, null);
  assert.equal(data.jobs[0].applyUrl, 'https://job.alio.go.kr/recruitview.do?idx=1');
  assert.equal(data.jobs[1].applyUrl, null, '없는 값도 null로 맞춘다');
  assert.equal(safeUrl('HTTPS://example.com'), 'HTTPS://example.com');
  assert.equal(safeUrl(undefined), null);
});

test('스냅샷이 없거나 형식이 다르면 샘플로 돌아간다', async () => {
  for (const fetch of [respond({}, 404), respond({ version: 2, jobs: [] }), async () => { throw new Error('offline'); }]) {
    const data = await loadJobs({ fetch });
    assert.equal(data.mode, 'sample');
    assert.equal(data.jobs.length, 12);
  }
});

test('?sample이면 요청하지 않고 샘플을 쓴다', async () => {
  let called = false;
  const data = await loadJobs({ fetch: async () => { called = true; return new Response('{}'); }, search: '?sample' });
  assert.equal(data.mode, 'sample');
  assert.equal(called, false);
});
