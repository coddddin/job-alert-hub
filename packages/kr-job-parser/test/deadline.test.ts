import { describe, expect, expectTypeOf, it } from 'vitest';
import { isOpen, parseDeadline, type Deadline, type IsoDate } from '../src/index.js';

const today: IsoDate = '2026-11-03';
const parse = (raw: string): Deadline => parseDeadline(raw, { today });

describe('parseDeadline', () => {
  describe('연도가 있는 날짜', () => {
    it.each([
      ['2026-11-14', '2026-11-14'],
      ['2026.11.14', '2026-11-14'],
      ['2026/11/14', '2026-11-14'],
      ['~2026.11.14(금)', '2026-11-14'],
      ['2026년 11월 14일까지', '2026-11-14'],
      ['26.11.14', '2026-11-14'],
      ['2027.1.5', '2027-01-05'],
    ] as const)('%s → %s', (raw, date) => {
      expect(parse(raw)).toEqual({ kind: 'date', date });
    });
  });

  describe('연도가 없는 날짜', () => {
    it.each([
      ['~11/14(금)', '2026-11-14'],
      ['11.14', '2026-11-14'],
      ['11월 14일까지', '2026-11-14'],
      ['~1/10', '2027-01-10'],
      ['10/20', '2026-10-20'],
    ] as const)('%s → %s (기준일 %s)', (raw, date) => {
      expect(parse(raw)).toEqual({ kind: 'date', date });
    });

    it('기준일보다 30일 넘게 지난 날짜는 다음 해로 본다', () => {
      expect(parse('~9/1')).toEqual({ kind: 'date', date: '2027-09-01' });
    });

    it('연말에 올라온 공고의 1월 마감', () => {
      expect(parseDeadline('~1/5', { today: '2026-12-20' })).toEqual({ kind: 'date', date: '2027-01-05' });
    });
  });

  describe('시각', () => {
    it.each([
      ['~11/14 18:00', '2026-11-14', '18:00'],
      ['2026.11.14 9:30 마감', '2026-11-14', '09:30'],
    ] as const)('%s', (raw, date, time) => {
      expect(parse(raw)).toEqual({ kind: 'date', date, time });
    });

    it('시각은 날짜로 오인하지 않는다', () => {
      expect(parse('11/14 18:00')).toEqual({ kind: 'date', date: '2026-11-14', time: '18:00' });
    });

    it('범위를 벗어난 시각은 무시한다', () => {
      expect(parse('11/14 25:99')).toEqual({ kind: 'date', date: '2026-11-14' });
    });
  });

  describe('상대 표기', () => {
    it.each([
      ['오늘마감', '2026-11-03'],
      ['금일 마감', '2026-11-03'],
      ['D-day', '2026-11-03'],
      ['내일마감', '2026-11-04'],
      ['D-3', '2026-11-06'],
      ['D - 30', '2026-12-03'],
    ] as const)('%s → %s', (raw, date) => {
      expect(parse(raw)).toEqual({ kind: 'date', date });
    });
  });

  describe('마감일이 없는 표기', () => {
    it.each(['상시채용', '상시 채용', '수시채용'])('%s → rolling', (raw) => {
      expect(parse(raw)).toEqual({ kind: 'rolling' });
    });

    it.each(['채용시 마감', '채용 시 마감', '충원 시 마감', '인원 충족 시 마감'])('%s → until-filled', (raw) => {
      expect(parse(raw)).toEqual({ kind: 'until-filled' });
    });

    it('날짜가 함께 있으면 날짜를 우선한다', () => {
      expect(parse('~12/31 (채용 시 조기 마감)')).toEqual({ kind: 'date', date: '2026-12-31' });
    });
  });

  describe('해석하지 못한 표기', () => {
    it.each(['', '협의', '2/30', '2026.13.01'])('"%s"', (raw) => {
      expect(parse(raw)).toEqual({ kind: 'unknown', raw });
    });
  });

  it('기준일이 잘못되면 RangeError를 던진다', () => {
    expect(() => parseDeadline('11/14', { today: '2026-02-30' })).toThrow(RangeError);
    expect(() => parseDeadline('11/14', { today: '20261103' as IsoDate })).toThrow(RangeError);
  });
});

describe('isOpen', () => {
  it.each([
    ['2026-11-14', 'yes'],
    ['2026-11-03', 'yes'],
    ['2026-11-02', 'no'],
    ['상시채용', 'yes'],
    ['채용시 마감', 'yes'],
    ['협의', 'unknown'],
  ] as const)('%s → %s', (raw, expected) => {
    expect(isOpen(parse(raw), today)).toBe(expected);
  });
});

describe('타입', () => {
  it('날짜는 템플릿 리터럴 타입이다', () => {
    const deadline = parse('2026-11-14');
    if (deadline.kind === 'date') {
      expectTypeOf(deadline.date).toEqualTypeOf<IsoDate>();
    }
    expectTypeOf<'2026-11-14'>().toExtend<IsoDate>();
    expectTypeOf<'내일'>().not.toExtend<IsoDate>();
  });
});
