import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  acceptsNewcomer,
  fitsYears,
  parseExperience,
  type Experience,
  type ExperienceKind,
} from '../src/index.js';

const atLeast = (years: number) => ({ min: { years, inclusive: true } });
const between = (from: number, to: number) => ({
  min: { years: from, inclusive: true },
  max: { years: to, inclusive: true },
});

describe('parseExperience', () => {
  describe('신입', () => {
    it.each(['신입', '신입사원', ' 신입 ', '신입 가능', '중고신입', '학력무관, 신입'])('%s', (raw) => {
      expect(parseExperience(raw)).toEqual({ kind: 'new' });
    });
  });

  describe('경력무관', () => {
    it.each(['경력무관', '경력 무관', '경력불문', '경력 상관없음', '경력 관계없음', '신입/경력무관'])(
      '%s',
      (raw) => {
        expect(parseExperience(raw)).toEqual({ kind: 'any' });
      },
    );
  });

  describe('경력 (연차 하한)', () => {
    it.each([
      ['경력 3년 이상', 3],
      ['경력3년↑', 3],
      ['경력 3년+', 3],
      ['3년 이상', 3],
      ['경력 3년차 이상', 3],
      ['경력(3년 이상)', 3],
      ['경력 ３년 이상', 3],
      ['경력 3년', 3],
      ['경력 6개월 이상', 0.5],
      ['경력 1.5년 이상', 1.5],
    ] as const)('%s → %d년 이상', (raw, years) => {
      expect(parseExperience(raw)).toEqual({ kind: 'experienced', range: atLeast(years) });
    });

    it('초과는 경계값을 포함하지 않는다', () => {
      expect(parseExperience('경력 2년 초과')).toEqual({
        kind: 'experienced',
        range: { min: { years: 2, inclusive: false } },
      });
    });
  });

  describe('경력 (연차 범위)', () => {
    it.each([
      ['경력 2~5년', 2, 5],
      ['경력 2-5년', 2, 5],
      ['경력 2∼5년', 2, 5],
      ['2년~5년', 2, 5],
      ['경력 3~7년차', 3, 7],
      ['경력 2년 이상 5년 이하', 2, 5],
    ] as const)('%s → %d~%d년', (raw, from, to) => {
      expect(parseExperience(raw)).toEqual({ kind: 'experienced', range: between(from, to) });
    });

    it('상한만 있는 경우', () => {
      expect(parseExperience('경력 5년 이하')).toEqual({
        kind: 'experienced',
        range: { max: { years: 5, inclusive: true } },
      });
      expect(parseExperience('경력 3년 미만')).toEqual({
        kind: 'experienced',
        range: { max: { years: 3, inclusive: false } },
      });
    });

    it('연차 조건이 없는 경력', () => {
      expect(parseExperience('경력')).toEqual({ kind: 'experienced', range: {} });
      expect(parseExperience('경력직')).toEqual({ kind: 'experienced', range: {} });
    });
  });

  describe('신입·경력', () => {
    it.each(['신입·경력', '신입/경력', '신입 및 경력', '신입 또는 경력', '신입(경력자 우대)'])('%s', (raw) => {
      expect(parseExperience(raw)).toEqual({ kind: 'new-or-experienced', range: {} });
    });

    it('경력 조건과 신입 허용이 함께 있는 경우', () => {
      expect(parseExperience('경력 1년 이상 (신입 가능)')).toEqual({
        kind: 'new-or-experienced',
        range: atLeast(1),
      });
    });
  });

  describe('신입 제외 표기', () => {
    it.each(['경력 3년 이상 (신입 지원 불가)', '경력 3년 이상, 신입 제외'])('%s', (raw) => {
      expect(parseExperience(raw)).toEqual({ kind: 'experienced', range: atLeast(3) });
    });
  });

  describe('해석하지 못한 표기', () => {
    it.each(['', '인턴', '정규직', '협의', '???'])('"%s"는 원문을 남긴다', (raw) => {
      expect(parseExperience(raw)).toEqual({ kind: 'unknown', raw });
    });
  });
});

describe('fitsYears', () => {
  const cases: readonly [string, number, ReturnType<typeof fitsYears>][] = [
    ['신입', 0, 'yes'],
    ['신입', 2, 'no'],
    ['경력무관', 10, 'yes'],
    ['경력', 0, 'no'],
    ['경력', 1, 'yes'],
    ['경력 3년 이상', 2, 'no'],
    ['경력 3년 이상', 3, 'yes'],
    ['경력 2년 초과', 2, 'no'],
    ['경력 2~5년', 5, 'yes'],
    ['경력 2~5년', 6, 'no'],
    ['경력 3년 미만', 3, 'no'],
    ['경력 3년 미만', 2, 'yes'],
    ['신입·경력 3년 이상', 0, 'yes'],
    ['신입·경력 3년 이상', 1, 'no'],
    ['신입·경력 3년 이상', 4, 'yes'],
    ['인턴', 0, 'unknown'],
  ];

  it.each(cases)('"%s" / %d년 → %s', (raw, years, expected) => {
    expect(fitsYears(parseExperience(raw), years)).toBe(expected);
  });
});

describe('acceptsNewcomer', () => {
  it.each([
    ['신입', 'yes'],
    ['경력무관', 'yes'],
    ['신입·경력', 'yes'],
    ['경력 3년 이상', 'no'],
    ['협의', 'unknown'],
  ] as const)('%s → %s', (raw, expected) => {
    expect(acceptsNewcomer(parseExperience(raw))).toBe(expected);
  });
});

describe('타입', () => {
  it('kind로 좁히면 해당 필드에 접근할 수 있다', () => {
    const experience = parseExperience('경력 3년 이상');
    expectTypeOf<ExperienceKind>().toEqualTypeOf<
      'new' | 'experienced' | 'new-or-experienced' | 'any' | 'unknown'
    >();
    if (experience.kind === 'experienced') {
      expectTypeOf(experience.range.min).toEqualTypeOf<
        { readonly years: number; readonly inclusive: boolean } | undefined
      >();
    }
    if (experience.kind === 'unknown') {
      expectTypeOf(experience.raw).toBeString();
    }
    expectTypeOf(experience).toEqualTypeOf<Experience>();
  });
});
