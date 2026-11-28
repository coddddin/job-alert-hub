import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultSort, nextSort, sanitizeSort, sortJobs } from '../lib/sort.js';
import { initialState, sanitizeState } from '../lib/state.js';

const items = [
  { id: 'a', days: 5, title: '나', company: 'B사', source: '사람인' },
  { id: 'b', days: null, title: '가', company: 'A사', source: '공공기관' },
  { id: 'c', days: 1, title: '다', company: 'C사', source: '원티드' },
  { id: 'e', days: null, title: '아', company: 'D사', source: '잡코리아' },
  { id: 'd', days: 5, title: '라', company: 'A사', source: '공공기관' },
];
const ids = sort => sortJobs(items, sort, x => x).map(x => x.id).join('');

test('기본 정렬은 마감 임박순이고 마감일 없는 공고는 맨 뒤', () => {
  assert.equal(ids(defaultSort), 'cadbe');
});
test('마감일 내림차순에서도 마감일 없는 공고는 맨 뒤', () => {
  assert.equal(ids({ key: 'deadline', dir: 'desc' }), 'adcbe');
});
test('공고명·회사·출처 정렬은 오름·내림이 뒤집히고 마감일 없는 공고는 뒤', () => {
  assert.equal(ids({ key: 'title', dir: 'asc' }), 'acdbe');
  assert.equal(ids({ key: 'title', dir: 'desc' }), 'dcaeb');
  assert.equal(ids({ key: 'company', dir: 'asc' }), 'dacbe');
  assert.equal(ids({ key: 'source', dir: 'asc' }), 'dacbe');
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
test('잘못된 저장값은 기본값으로 정리', () => {
  assert.deepEqual(sanitizeSort({ key: 'title', dir: 'desc' }), { key: 'title', dir: 'desc' });
  for (const bad of [null, undefined, 'x', { key: 'bad', dir: 'asc' }, { key: 'title', dir: 'up' }]) assert.deepEqual(sanitizeSort(bad), defaultSort);
  assert.deepEqual(sanitizeState({ version: 1, sort: { key: 'company', dir: 'desc' } }).sort, { key: 'company', dir: 'desc' });
  assert.deepEqual(sanitizeState({ version: 1, sort: { key: '__proto__' } }).sort, initialState().sort);
});
