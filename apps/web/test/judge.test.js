import test from 'node:test';
import assert from 'node:assert/strict';
import { conditionsFromJobkoreaUrl, judge, pickJobkoreaFields } from '../lib/judge.js';

const today = '2026-11-05';
const seoul = { regions: ['서울'], includeUnspecified: true };
const raw = (experience, location, deadline) => ({ experience, location, deadline });

// 2026-11 잡코리아 검색 목록에서 실제로 본 표기들
test('잡코리아 목록 표기를 판정한다', () => {
  assert.equal(judge(raw('신입·경력1년↑', '서울 금천구', '12/04(금) 마감'), seoul, today).status, 'match');
  assert.equal(judge(raw('신입', '서울 성동구', '상시채용'), seoul, today).status, 'match');
  assert.equal(judge(raw('경력무관', '서울 마포구', '12/04(금) 마감'), seoul, today).status, 'match');
  assert.equal(judge(raw('경력3년↑', '서울 마포구', '12/04(금) 마감'), seoul, today).status, 'exclude');
});

test('"외 1"은 숨은 근무지가 있어 다른 지역(부산)으로 걸러도 제외하지 않고 확인 필요로 둔다', () => {
  const verdict = judge(raw('경력무관', '서울 구로구 외 1', '12/04(금) 마감'), { regions: ['부산'], includeUnspecified: true }, today);
  assert.equal(verdict.status, 'review');
  assert.deepEqual(verdict.reasons, ['근무지 확인 필요']);
  assert.equal(verdict.fields[1].reading, '서울 구로구 · 외 1곳');
});

test('경력무관 제외, 다른 지역, 마감은 제외 사유로 모두 알려 준다', () => {
  const verdict = judge(raw('경력무관', '부산 해운대구', '~11/01(일)'), { regions: ['서울'], includeUnspecified: false }, today);
  assert.equal(verdict.status, 'exclude');
  assert.deepEqual(verdict.reasons, ['경력무관 제외 설정', '선택한 근무지 아님', '마감됨']);
});

test('해석하지 못한 항목은 버리지 않고 확인 필요로 남긴다', () => {
  const verdict = judge(raw('', '서울 강남구', '12/04(금) 마감'), seoul, today);
  assert.equal(verdict.status, 'review');
  assert.equal(verdict.fields[0].ok, null);
});

test('여러 지역 중 하나라도 맞으면 맞춤이고, 지역 조건이 없으면 근무지를 보지 않는다', () => {
  const both = { regions: ['광주', '전남'], includeUnspecified: true };
  assert.equal(judge(raw('신입', '전남 나주시', '상시채용'), both, today).status, 'match');
  assert.equal(judge(raw('신입', '제주 제주시', '상시채용'), { regions: [], includeUnspecified: true }, today).status, 'match');
});

test('잡코리아 주소에서 조건을 되읽는다', () => {
  assert.deepEqual(conditionsFromJobkoreaUrl('https://www.jobkorea.co.kr/Search/?local=I000&careerType=1,4'), { regions: ['서울'], includeUnspecified: true });
  assert.deepEqual(conditionsFromJobkoreaUrl('https://www.jobkorea.co.kr/Search/?local=L000&careerType=1'), { regions: ['광주', '전남'], includeUnspecified: false });
  assert.deepEqual(conditionsFromJobkoreaUrl('https://www.jobkorea.co.kr/Search/?local=ZZZ,B000'), { regions: ['경기'], includeUnspecified: true });
  assert.deepEqual(conditionsFromJobkoreaUrl('not a url'), { regions: [], includeUnspecified: true });
});

test('카드 글자 조각에서 경력·마감 표기만 고른다', () => {
  const texts = ['신입 지원 가능', '[신입/경력] AI 플랫폼 개발자', '㈜예시', '서울 금천구', '백엔드개발자', '신입·경력1년↑', '9시간 전 등록', '•', '12/04(금) 마감'];
  assert.deepEqual(pickJobkoreaFields(texts), { experience: '신입·경력1년↑', location: '서울 금천구', deadline: '12/04(금) 마감' });
  assert.deepEqual(pickJobkoreaFields(['인턴 채용 진행중', '서울신용보증재단', '충남 외 1', '경력무관', '상시채용']), { experience: '경력무관', location: '충남 외 1', deadline: '상시채용' });
  assert.deepEqual(pickJobkoreaFields(['오늘마감', '전국']), { experience: '', location: '전국', deadline: '오늘마감' });
});
