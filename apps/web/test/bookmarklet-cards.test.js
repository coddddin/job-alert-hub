import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { ATTR, findCards } from '../bookmarklet/cards.js';
import { judge } from '../lib/judge.js';

const html = await readFile(new URL('./fixtures/jobkorea-search.html', import.meta.url), 'utf8');
const load = () => parseHTML(html).document;

test('공고 번호마다 카드 하나를 찾고 경력·근무지·마감 표기를 읽는다', () => {
  const cards = findCards(load());
  assert.deepEqual(cards.map(card => card.id), ['10000001', '10000002', '10000003', '10000004']);
  assert.deepEqual(cards.map(card => card.raw), [
    { experience: '신입·경력1년↑', location: '서울 금천구', deadline: '12/04(금) 마감' },
    { experience: '경력무관', location: '서울 구로구 외 1', deadline: '상시채용' },
    { experience: '경력6년↑', location: '서울 종로구', deadline: '오늘마감' },
    { experience: '경력무관', location: '부산', deadline: '상시채용' },
  ]);
});

test('제목은 공고 링크 중 글자가 가장 긴 것이다 (로고·회사명 링크가 아님)', () => {
  const titles = findCards(load()).map(card => card.title.textContent.trim());
  assert.deepEqual(titles, ['[신입/경력] 예시 플랫폼 백엔드 개발자 채용', '[재택근무] 예시 튜터 모집 (풀스택)', '예시 SM 시니어 개발자', '[예시]물류 시스템 운영']);
});

test('카드는 다른 공고를 포함하지 않는다', () => {
  for (const { id, card } of findCards(load())) {
    const ids = new Set([...card.querySelectorAll('a[href*="GI_Read"]')].map(a => /GI_Read\/(\d+)/.exec(a.getAttribute('href'))[1]));
    assert.deepEqual([...ids], [id]);
  }
});

test('북마클릿이 붙인 요소는 다시 읽지 않는다', () => {
  const document = load();
  const [first] = findCards(document);
  const badge = document.createElement('button');
  badge.setAttribute(ATTR, '');
  badge.textContent = '경력10년↑';
  first.title.parentElement.insertBefore(badge, first.title);
  assert.equal(findCards(document)[0].raw.experience, '신입·경력1년↑');
});

test('읽은 표기로 판정까지 이어진다', () => {
  const conditions = { regions: ['서울'], includeUnspecified: true };
  const statuses = findCards(load()).map(card => judge(card.raw, conditions, '2026-11-05').status);
  assert.deepEqual(statuses, ['match', 'match', 'exclude', 'exclude']);
});
