import test from 'node:test';
import assert from 'node:assert/strict';
import { jobs } from '../data/jobs.js';
import { defaults, matchJob, notificationCandidates } from '../lib/matching.js';
import { initialState, sanitizeState } from '../lib/state.js';

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
