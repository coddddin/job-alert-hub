/**
 * 잡코리아가 다른 사이트에 넣어 쓰도록 공식 제공하는 신입 공채달력(iframe) 주소.
 * 화면에 그대로 보여주기만 하고, 내용을 읽어 오거나 해석하지 않는다.
 * https://www.jobkorea.co.kr/service/api 안내의 Iframe 소스를 따른다.
 */
export const CALENDAR_ORIGIN = 'https://www.jobkorea.co.kr';

/** 학력 구분. 잡코리아 안내의 edu 값 그대로다. */
export const EDUCATION = Object.freeze([
  { value: 'all', label: '공채 전체' },
  { value: '3', label: '고졸' },
  { value: '4', label: '초대졸' },
  { value: '5', label: '대졸' },
]);

export const PERIODS = Object.freeze([
  { value: 'month', label: '월간' },
  { value: 'week', label: '주간' },
]);

/** 허용한 값만 주소에 넣는다. 그 밖의 값은 기본값(월간·공채 전체)으로 바꾼다. */
export function calendarUrl({ period = 'month', edu = 'all' } = {}) {
  const safePeriod = PERIODS.some(option => option.value === period) ? period : 'month';
  const url = new URL(`/Starter/calendar/sub/${safePeriod}`, CALENDAR_ORIGIN);
  if (edu !== 'all' && EDUCATION.some(option => option.value === edu)) url.searchParams.set('edu', edu);
  return url.href;
}
