import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarUrl } from '../lib/calendar.js';

test('공채달력 주소는 잡코리아 안내의 https 주소를 따른다', () => {
  assert.equal(calendarUrl(), 'https://www.jobkorea.co.kr/Starter/calendar/sub/month');
  assert.equal(calendarUrl({ period: 'week', edu: '5' }), 'https://www.jobkorea.co.kr/Starter/calendar/sub/week?edu=5');
  assert.equal(calendarUrl({ period: 'month', edu: '3' }), 'https://www.jobkorea.co.kr/Starter/calendar/sub/month?edu=3');
});

test('허용하지 않은 값은 기본값으로 바꿔 주소를 조작할 수 없다', () => {
  assert.equal(calendarUrl({ period: '../../evil', edu: '5' }), 'https://www.jobkorea.co.kr/Starter/calendar/sub/month?edu=5');
  assert.equal(calendarUrl({ period: 'week', edu: '1&x=y' }), 'https://www.jobkorea.co.kr/Starter/calendar/sub/week');
});
