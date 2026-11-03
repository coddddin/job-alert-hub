import test from 'node:test';
import assert from 'node:assert/strict';
import { jobs } from '../data/jobs.js';
import { defaults, matchJob, notificationCandidates } from '../lib/matching.js';
import { initialState, sanitizeState } from '../lib/state.js';
import { normalizeJob } from '../lib/normalize-job.js';

test('서울 신입 목록: 경력무관 포함, 경력·지역·직무·교육은 제외', () => {
  assert.deepEqual(jobs.filter(job => matchJob(job).status === 'match').map(job => job.id), ['sample-1', 'sample-2', 'sample-3', 'sample-7', 'sample-9', 'sample-12']);
  assert.equal(matchJob(jobs[7]).status, 'review');
  for (const id of [4, 5, 6, 10, 11]) assert.equal(matchJob(jobs.find(job => job.id === `sample-${id}`)).status, 'exclude');
});
test('알림에는 기본적으로 경력무관과 미확인 공고가 포함되지 않는다', () => {
  assert.deepEqual(notificationCandidates(jobs, initialState().notifications).map(job => job.id), ['sample-1', 'sample-3', 'sample-7', 'sample-9', 'sample-12']);
});
test('복수 근무지와 경기 필터, 필수 키워드 모두 일치', () => {
  assert.deepEqual(notificationCandidates(jobs, { ...defaults, region: '경기' }).map(job => job.id), ['sample-5', 'sample-7']);
  assert.deepEqual(notificationCandidates(jobs, { ...defaults, keyword: 'react typescript' }).map(job => job.id), ['sample-1']);
});
test('모집 부문 경력 필수와 불명확한 조건을 보수적으로 처리', () => {
  assert.equal(matchJob(jobs[10]).status, 'exclude');
  assert.equal(matchJob({ ...jobs[0], ambiguous: true }).status, 'review');
  assert.equal(matchJob({ ...jobs[0], closed: true }).status, 'exclude');
});
test('목록 필터를 변경해도 알림 규칙은 독립적으로 유지', () => {
  const state = initialState();
  state.filters.role = '게임'; state.filters.keyword = 'hello';
  assert.equal(state.notifications.role, 'all');
  assert.equal(state.notifications.keyword, '');
  assert.equal(notificationCandidates(jobs, state.notifications).length, 5);
});
test('저장 데이터는 왕복 유지되고 잘못된 형태는 기본값으로 복구', () => {
  const state = initialState(); state.bookmarks = ['sample-1']; state.applications['sample-1'] = '지원 완료';
  assert.deepEqual(sanitizeState(JSON.parse(JSON.stringify(state))), state);
  assert.deepEqual(sanitizeState(null), initialState());
  const result = sanitizeState({ version: 1, filters: { role: 'bad', keyword: '<script>' }, bookmarks: ['sample-1', 'sample-1', {}, '__proto__'], applications: { 'sample-1': '지원 완료', '__proto__': '합격' } });
  assert.equal(result.filters.role, 'all'); assert.deepEqual(result.bookmarks, ['sample-1']);
  assert.deepEqual(result.applications, { 'sample-1': '지원 완료' });
});
test('원문 표기를 kr-job-parser로 해석한 값이 손으로 정리했던 샘플 값과 같다', () => {
  // 파서 도입 전 data/jobs.js에 직접 적어 두었던 정규화 값
  const expected = {
    'sample-1': ['new', ['서울'], '성동구', '2026-10-12'], 'sample-2': ['unspecified', ['서울'], '강남구', '2026-10-15'],
    'sample-3': ['new', ['서울'], '마포구', '2026-10-07'], 'sample-4': ['experienced', ['서울'], '구로구', '2026-10-20'],
    'sample-5': ['new', ['경기'], '성남시', '2026-10-18'], 'sample-6': ['new', ['서울'], '중구', '2026-10-16'],
    'sample-7': ['new', ['서울', '경기'], '서초구 · 성남시', null], 'sample-8': ['new', [], '미제공', '2026-10-14'],
    'sample-9': ['new', ['서울'], '금천구', '2026-10-23'], 'sample-10': ['new', ['서울'], '강남구', '2026-10-30'],
    'sample-11': ['experienced', ['서울'], '영등포구', '2026-10-22'], 'sample-12': ['new', ['서울'], '서대문구', '2026-10-09'],
  };
  for (const job of jobs) {
    assert.deepEqual([job.experience, job.locations, job.area, job.deadline], expected[job.id], job.id);
    assert.equal(job.closed, false, job.id);
  }
});
test('숨은 근무지가 있으면 다른 지역 검색에서 확인 필요로 분류', () => {
  const job = normalizeJob({ ...jobs[0], raw: { experience: '신입', location: '부산 외 2곳', deadline: '상시채용' } }, '2026-09-29');
  assert.equal(matchJob(job, { ...defaults, region: '서울' }).status, 'review');
  assert.equal(matchJob(job, { ...defaults, region: 'all' }).status, 'match');
  assert.equal(job.deadlineKind, 'rolling');
});
test('기준일에 이미 지난 마감은 제외', () => {
  const job = normalizeJob({ ...jobs[0], raw: { ...jobs[0].raw, deadline: '2026.09.01' } }, '2026-09-29');
  assert.equal(matchJob(job).status, 'exclude');
  assert.equal(matchJob(job).reason, '마감된 공고');
});
