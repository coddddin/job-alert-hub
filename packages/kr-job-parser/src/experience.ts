import type { Fit } from './fit.js';
import { normalize } from './normalize.js';

/** 연차 경계 하나. `inclusive`가 `false`면 `미만`·`초과`처럼 경계값을 포함하지 않는다. */
export interface YearBound {
  readonly years: number;
  readonly inclusive: boolean;
}

/** 연차 범위. 경계가 없으면 그 방향으로 제한이 없다는 뜻이다. */
export interface YearRange {
  readonly min?: YearBound;
  readonly max?: YearBound;
}

/**
 * 채용공고의 경력 요건.
 *
 * `kind`로 구분되는 discriminated union이라, `switch (experience.kind)`에서
 * 모든 경우를 처리하지 않으면 컴파일러와 린트가 알려준다.
 */
export type Experience =
  /** 신입만 모집한다. */
  | { readonly kind: 'new' }
  /** 경력자만 모집한다. 연차 조건이 없으면 `range`가 빈 객체다. */
  | { readonly kind: 'experienced'; readonly range: YearRange }
  /** 신입과 경력을 함께 모집한다. `range`는 경력 지원자에게 적용되는 조건이다. */
  | { readonly kind: 'new-or-experienced'; readonly range: YearRange }
  /** 경력을 묻지 않는다. */
  | { readonly kind: 'any' }
  /** 해석하지 못했다. 원문을 그대로 남겨 사람이 확인할 수 있게 한다. */
  | { readonly kind: 'unknown'; readonly raw: string };

export type ExperienceKind = Experience['kind'];

const ANY = /경력(?:무관|불문|상관없음|관계없음)/u;
const NEW_EXCLUDED = /신입(?:지원)?(?:불가|제외)/u;
const EXPERIENCED = /경력|년차/u;

const NUMBER = String.raw`(\d+(?:\.\d+)?)`;
const UNIT = String.raw`(년|개월)`;
const RANGE = new RegExp(`${NUMBER}${UNIT}?차?~${NUMBER}${UNIT}차?`, 'u');
const LOWER = new RegExp(`${NUMBER}${UNIT}차?(이상|초과)`, 'u');
const UPPER = new RegExp(`${NUMBER}${UNIT}차?(이하|미만)`, 'u');
const BARE = new RegExp(`경력${NUMBER}${UNIT}`, 'u');

function toYears(value: string, unit: string | undefined): number {
  const amount = Number(value);
  return unit === '개월' ? Math.round((amount / 12) * 100) / 100 : amount;
}

function readRange(text: string): YearRange {
  const range = RANGE.exec(text);
  if (range) {
    const [, from, fromUnit, to, toUnit] = range;
    if (from !== undefined && to !== undefined) {
      return {
        min: { years: toYears(from, fromUnit ?? toUnit), inclusive: true },
        max: { years: toYears(to, toUnit), inclusive: true },
      };
    }
  }

  const lower = LOWER.exec(text);
  const upper = UPPER.exec(text);
  // 방향 표시가 하나라도 있으면 "경력 N년"을 하한으로 따로 읽지 않는다 ("경력 5년 이하" 등).
  const bare = lower || upper ? null : BARE.exec(text);

  let min: YearBound | undefined;
  if (lower?.[1] !== undefined) {
    min = { years: toYears(lower[1], lower[2]), inclusive: lower[3] === '이상' };
  } else if (bare?.[1] !== undefined) {
    // "경력 3년"처럼 방향 표시가 없으면 관례대로 "3년 이상"으로 읽는다.
    min = { years: toYears(bare[1], bare[2]), inclusive: true };
  }

  let max: YearBound | undefined;
  if (upper?.[1] !== undefined) {
    max = { years: toYears(upper[1], upper[2]), inclusive: upper[3] === '이하' };
  }

  return { ...(min && { min }), ...(max && { max }) };
}

function hasBound(range: YearRange): boolean {
  return range.min !== undefined || range.max !== undefined;
}

/**
 * 채용공고의 경력 표기를 해석한다.
 *
 * 해석할 수 없는 입력에도 예외를 던지지 않고 `{ kind: 'unknown', raw }`를 돌려준다.
 * 공고 하나를 해석하지 못했다고 수집 전체가 멈추면 안 되기 때문이다.
 *
 * @example
 * parseExperience('경력 3년↑');
 * // { kind: 'experienced', range: { min: { years: 3, inclusive: true } } }
 *
 * parseExperience('신입·경력');
 * // { kind: 'new-or-experienced', range: {} }
 */
export function parseExperience(raw: string): Experience {
  const text = normalize(raw);

  if (ANY.test(text)) return { kind: 'any' };

  const range = readRange(text);
  const mentionsNew = text.includes('신입') && !NEW_EXCLUDED.test(text);
  const mentionsExperienced = EXPERIENCED.test(text) || hasBound(range);

  if (mentionsNew && mentionsExperienced) return { kind: 'new-or-experienced', range };
  if (mentionsNew) return { kind: 'new' };
  if (mentionsExperienced) return { kind: 'experienced', range };
  return { kind: 'unknown', raw };
}

function withinRange(range: YearRange, years: number): boolean {
  const { min, max } = range;
  if (min && (min.inclusive ? years < min.years : years <= min.years)) return false;
  if (max && (max.inclusive ? years > max.years : years >= max.years)) return false;
  return true;
}

/**
 * 해당 연차의 지원자가 이 경력 요건에 맞는지 판단한다.
 *
 * - 신입은 경력 1년 미만으로 본다.
 * - 연차 조건이 없는 `experienced`는 경력이 조금이라도 있으면 맞는 것으로 본다.
 */
export function fitsYears(experience: Experience, years: number): Fit {
  switch (experience.kind) {
    case 'any':
      return 'yes';
    case 'new':
      return years < 1 ? 'yes' : 'no';
    case 'experienced':
      return years > 0 && withinRange(experience.range, years) ? 'yes' : 'no';
    case 'new-or-experienced':
      return years < 1 || withinRange(experience.range, years) ? 'yes' : 'no';
    case 'unknown':
      return 'unknown';
  }
}

/** 신입(경력 0년)이 지원할 수 있는지 판단한다. `fitsYears(experience, 0)`과 같다. */
export function acceptsNewcomer(experience: Experience): Fit {
  return fitsYears(experience, 0);
}
