import { describe, expect, expectTypeOf, it } from 'vitest';
import { matchesRegion, parseLocation, SIDO, type Place, type Sido } from '../src/index.js';

const placesOf = (raw: string): readonly Place[] => parseLocation(raw).places;

describe('parseLocation', () => {
  describe('시·도 표기 정규화', () => {
    it.each([
      ['서울', '서울'],
      ['서울특별시', '서울'],
      ['서울시', '서울'],
      ['부산광역시', '부산'],
      ['광주광역시', '광주'],
      ['세종특별자치시', '세종'],
      ['경기도', '경기'],
      ['강원특별자치도', '강원'],
      ['강원도', '강원'],
      ['충청북도', '충북'],
      ['전북특별자치도', '전북'],
      ['전라북도', '전북'],
      ['경상남도', '경남'],
      ['제주특별자치도', '제주'],
    ] as const)('%s → %s', (raw, sido) => {
      expect(placesOf(raw)).toEqual([{ sido }]);
    });
  });

  describe('시·군·구', () => {
    it.each([
      ['서울 강남구', { sido: '서울', sigungu: '강남구' }],
      ['서울특별시 강남구 테헤란로 123', { sido: '서울', sigungu: '강남구' }],
      ['서울강남구', { sido: '서울', sigungu: '강남구' }],
      ['경기 성남시 분당구', { sido: '경기', sigungu: '성남시 분당구' }],
      ['경기 광주시', { sido: '경기', sigungu: '광주시' }],
      ['광주 광산구', { sido: '광주', sigungu: '광산구' }],
      ['제주 제주시', { sido: '제주', sigungu: '제주시' }],
      ['충남 홍성군', { sido: '충남', sigungu: '홍성군' }],
      ['서울 전지역', { sido: '서울' }],
    ] as const)('%s', (raw, place) => {
      expect(placesOf(raw)).toEqual([place]);
    });
  });

  describe('여러 근무지', () => {
    it.each(['서울·경기', '서울, 경기', '서울/경기', '서울 및 경기', '서울 또는 경기'])('%s', (raw) => {
      expect(placesOf(raw)).toEqual([{ sido: '서울' }, { sido: '경기' }]);
    });

    it('시·군·구가 섞인 목록', () => {
      expect(placesOf('서울 강남구, 경기 성남시 분당구')).toEqual([
        { sido: '서울', sigungu: '강남구' },
        { sido: '경기', sigungu: '성남시 분당구' },
      ]);
    });

    it('같은 근무지는 한 번만 남긴다', () => {
      expect(placesOf('서울 강남구, 서울특별시 강남구')).toEqual([{ sido: '서울', sigungu: '강남구' }]);
    });
  });

  describe('외 N곳', () => {
    it.each([
      ['서울 강남구 외 2곳', 2],
      ['서울 외2곳', 2],
      ['부산 외 3개 지역', 3],
      ['대전 외 1개소', 1],
    ] as const)('%s → %d', (raw, count) => {
      expect(parseLocation(raw).others).toBe(count);
    });

    it('수를 알 수 없는 경우', () => {
      expect(parseLocation('서울 외 다수').others).toBe('unknown');
    });

    it('표기가 없으면 0', () => {
      expect(parseLocation('서울').others).toBe(0);
    });
  });

  describe('전국과 재택', () => {
    it('전국', () => {
      expect(parseLocation('전국')).toEqual({
        places: [],
        nationwide: true,
        remote: 'none',
        others: 0,
        unparsed: [],
      });
    });

    it.each([
      ['재택근무', 'full'],
      ['원격근무', 'full'],
      ['리모트', 'full'],
      ['Remote', 'full'],
      ['서울 강남구 (재택 병행)', 'partial'],
      ['재택근무 가능', 'partial'],
      ['하이브리드', 'partial'],
      ['주 2회 재택', 'partial'],
      ['서울', 'none'],
    ] as const)('%s → %s', (raw, remote) => {
      expect(parseLocation(raw).remote).toBe(remote);
    });

    it('재택 표기는 근무지 목록에 섞이지 않는다', () => {
      expect(parseLocation('서울 강남구 (재택 병행)')).toEqual({
        places: [{ sido: '서울', sigungu: '강남구' }],
        nationwide: false,
        remote: 'partial',
        others: 0,
        unparsed: [],
      });
    });
  });

  describe('해석하지 못한 조각', () => {
    it.each([
      ['해외', ['해외']],
      ['강남구', ['강남구']],
      ['광주시', ['광주시']],
      ['서울, 싱가포르', ['싱가포르']],
      ['', []],
    ] as const)('%s', (raw, unparsed) => {
      expect(parseLocation(raw).unparsed).toEqual(unparsed);
    });
  });
});

describe('matchesRegion', () => {
  it.each([
    ['서울 강남구', '서울', 'yes'],
    ['서울 강남구', '경기', 'no'],
    ['서울·경기', '경기', 'yes'],
    ['전국', '제주', 'yes'],
    ['재택근무', '부산', 'yes'],
    ['서울 강남구 (재택 병행)', '부산', 'no'],
    ['서울 외 2곳', '서울', 'yes'],
    ['서울 외 2곳', '부산', 'unknown'],
    ['서울 외 다수', '부산', 'unknown'],
    ['해외', '서울', 'unknown'],
  ] as const)('"%s"에서 %s 근무 → %s', (raw, sido, expected) => {
    expect(matchesRegion(parseLocation(raw), sido)).toBe(expected);
  });
});

describe('타입', () => {
  it('Sido는 17개 시·도의 리터럴 유니온이다', () => {
    expect(SIDO).toHaveLength(17);
    expectTypeOf<Sido>().toEqualTypeOf<(typeof SIDO)[number]>();
    expectTypeOf<'서울'>().toExtend<Sido>();
    expectTypeOf<'서울특별시'>().not.toExtend<Sido>();
  });
});
