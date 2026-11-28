import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultSort, experienceRank, nextSort, sanitizeSort, sortJobs, STATUS_RANK } from '../lib/sort.js';
import { initialState, sanitizeState } from '../lib/state.js';

const items = [
  { id: 'a', days: 5, title: '나', experience: 3.05, location: '서울 강남구', status: STATUS_RANK.review },
  { id: 'b', days: null, title: '가', experience: 0, location: '부산', status: STATUS_RANK.match },
  { id: 'c', days: 1, title: '다', experience: null, location: null, status: STATUS_RANK.exclude },
  { id: 'e', days: null, title: '아', experience: 2, location: '서울 강남구', status: STATUS_RANK.match },
  { id: 'd', days: 5, title: '라', experience: 0, location: '경기 성남시', status: STATUS_RANK.match },
];
const ids = sort => sortJobs(items, sort, x => x).map(x => x.id).join('');

test('기본 정렬은 마감 임박순이고, 마감일 없는 공고는 오름·내림 모두 맨 뒤', () => {
  assert.equal(ids(defaultSort), 'cadbe');
  assert.equal(ids({ key: 'deadline', dir: 'desc' }), 'adcbe');
});
test('공고명은 가나다순으로만 정렬하고 다시 누르면 뒤집힌다', () => {
  assert.equal(ids({ key: 'title', dir: 'asc' }), 'bacde');
  assert.equal(ids({ key: 'title', dir: 'desc' }), 'edcab');
});
test('경력·근무지는 값이 없는 공고를 맨 뒤에 두고, 같은 값끼리는 마감 임박순', () => {
  assert.equal(ids({ key: 'experience', dir: 'asc' }), 'dbeac'); // 신입 d(5일)·b(상시) → 무관 e → 경력 3년 a → 모름 c
  assert.equal(ids({ key: 'experience', dir: 'desc' }), 'aedbc');
  assert.equal(ids({ key: 'location', dir: 'asc' }), 'dbaec'); // 경기 → 부산 → 서울(a 5일, e 상시) → 없음
});
test('판정은 지원 가능 → 확인 필요 → 제외 순', () => {
  assert.equal(ids({ key: 'status', dir: 'asc' }), 'dbeac');
  assert.equal(ids({ key: 'status', dir: 'desc' }), 'cadbe');
});
test('경력 순위: 신입 → 신입·경력 → 무관 → 경력(연차 적은 순), 모르면 null', () => {
  const ranks = [{ kind: 'new' }, { kind: 'new-or-experienced' }, { kind: 'any' }, { kind: 'experienced', range: { min: { years: 2 } } }, { kind: 'experienced', range: { min: { years: 10 } } }, { kind: 'experienced' }].map(experienceRank);
  assert.deepEqual(ranks, [0, 1, 2, 3.02, 3.1, 3]);
  assert.equal(experienceRank({ kind: 'unknown' }), null);
  assert.equal(experienceRank(undefined), null);
});
test('원본 배열을 바꾸지 않는다', () => {
  const before = items.map(x => x.id).join('');
  ids({ key: 'title', dir: 'desc' });
  assert.equal(items.map(x => x.id).join(''), before);
});
test('같은 항목을 다시 누르면 방향이 바뀌고 다른 항목은 오름차순으로 시작', () => {
  assert.deepEqual(nextSort({ key: 'deadline', dir: 'asc' }, 'deadline'), { key: 'deadline', dir: 'desc' });
  assert.deepEqual(nextSort({ key: 'deadline', dir: 'desc' }, 'deadline'), { key: 'deadline', dir: 'asc' });
  assert.deepEqual(nextSort({ key: 'deadline', dir: 'desc' }, 'title'), { key: 'title', dir: 'asc' });
});
test('잘못된 저장값(예전 회사·출처 정렬 포함)은 기본값으로 정리', () => {
  assert.deepEqual(sanitizeSort({ key: 'location', dir: 'desc' }), { key: 'location', dir: 'desc' });
  for (const bad of [null, undefined, 'x', { key: 'company', dir: 'asc' }, { key: 'title', dir: 'up' }]) assert.deepEqual(sanitizeSort(bad), defaultSort);
  assert.deepEqual(sanitizeState({ version: 1, sort: { key: 'status', dir: 'desc' } }).sort, { key: 'status', dir: 'desc' });
  assert.deepEqual(sanitizeState({ version: 1, sort: { key: '__proto__' } }).sort, initialState().sort);
});
