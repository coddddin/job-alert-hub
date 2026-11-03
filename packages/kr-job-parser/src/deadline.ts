import type { Fit } from './fit.js';

/** `YYYY-MM-DD` 형식의 날짜. 시간대 문제를 피하려고 `Date` 대신 달력 날짜 문자열을 쓴다. */
export type IsoDate = `${number}-${number}-${number}`;

/** `HH:mm` 형식의 시각. */
export type Time = `${number}:${number}`;

export type Deadline =
  /** 마감 날짜가 정해져 있다. `time`은 원문에 시각이 있을 때만 있다. */
  | { readonly kind: 'date'; readonly date: IsoDate; readonly time?: Time }
  /** 상시·수시 채용. 정해진 마감이 없다. */
  | { readonly kind: 'rolling' }
  /** 채용되면 마감한다. 언제 닫힐지 알 수 없다. */
  | { readonly kind: 'until-filled' }
  /** 해석하지 못했다. */
  | { readonly kind: 'unknown'; readonly raw: string };

export type DeadlineKind = Deadline['kind'];

export interface DeadlineOptions {
  /**
   * 기준 날짜. 연도가 없는 표기(`~11/14`)와 상대 표기(`내일 마감`, `D-3`)를 계산할 때 쓴다.
   * 함수가 현재 시각에 기대지 않도록 호출하는 쪽이 넘긴다.
   */
  readonly today: IsoDate;
}

const MS_PER_DAY = 86_400_000;

interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function isValid({ year, month, day }: CalendarDate): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function toEpochDay({ year, month, day }: CalendarDate): number {
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

function fromEpochDay(epochDay: number): CalendarDate {
  const date = new Date(epochDay * MS_PER_DAY);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

const pad = (value: number): string => String(value).padStart(2, '0');

function format({ year, month, day }: CalendarDate): IsoDate {
  return `${String(year)}-${pad(month)}-${pad(day)}` as IsoDate;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/u;

function parseToday(today: IsoDate): CalendarDate {
  const match = ISO.exec(today);
  const date = match && { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (!date || !isValid(date)) {
    throw new RangeError(`today는 YYYY-MM-DD 형식의 올바른 날짜여야 합니다: ${today}`);
  }
  return date;
}

const FULL_DATE = /(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/u;
const SHORT_YEAR_DATE = /(?<!\d)(\d{2})\.(\d{1,2})\.(\d{1,2})(?!\d)/u;
const MONTH_DAY = /(?<![\d:])(\d{1,2})\s*[./월]\s*(\d{1,2})(?![\d:])/u;
const TIME = /(\d{1,2}):(\d{2})/u;
const TODAY = /오늘\s*마감|금일\s*마감|D-?day/iu;
const TOMORROW = /내일\s*마감/u;
const D_MINUS = /D\s*-\s*(\d+)/iu;
const ROLLING = /상시|수시/u;
const UNTIL_FILLED = /채용\s*시|충원\s*시|마감\s*시\s*까지|인원\s*충족\s*시/u;

/** 연도가 없는 날짜의 연도를 정한다. 기준일보다 30일 넘게 지난 날짜면 다음 해로 본다. */
function inferYear(month: number, day: number, today: CalendarDate): CalendarDate {
  const sameYear = { year: today.year, month, day };
  if (isValid(sameYear) && toEpochDay(sameYear) >= toEpochDay(today) - 30) return sameYear;
  return { year: today.year + 1, month, day };
}

function readDate(text: string, today: CalendarDate): CalendarDate | null {
  if (TODAY.test(text)) return today;
  if (TOMORROW.test(text)) return fromEpochDay(toEpochDay(today) + 1);

  const dMinus = D_MINUS.exec(text);
  if (dMinus?.[1] !== undefined) return fromEpochDay(toEpochDay(today) + Number(dMinus[1]));

  const full = FULL_DATE.exec(text);
  if (full) return { year: Number(full[1]), month: Number(full[2]), day: Number(full[3]) };

  const short = SHORT_YEAR_DATE.exec(text);
  if (short) return { year: 2000 + Number(short[1]), month: Number(short[2]), day: Number(short[3]) };

  const monthDay = MONTH_DAY.exec(text);
  if (monthDay) return inferYear(Number(monthDay[1]), Number(monthDay[2]), today);

  return null;
}

function readTime(text: string): Time | undefined {
  const match = TIME.exec(text);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 24 || minute > 59) return undefined;
  return `${pad(hour)}:${pad(minute)}` as Time;
}

/**
 * 채용공고의 마감 표기를 해석한다.
 *
 * 날짜가 함께 적혀 있으면 `채용 시 마감` 같은 문구보다 날짜를 우선한다.
 * 입력 문자열 때문에 예외를 던지지는 않지만, `today`가 잘못되면 `RangeError`를 던진다.
 * 앞의 것은 데이터 문제이고 뒤의 것은 호출하는 코드의 실수이기 때문이다.
 *
 * @example
 * parseDeadline('~11/14(금)', { today: '2026-11-03' });
 * // { kind: 'date', date: '2026-11-14' }
 *
 * parseDeadline('채용시 마감', { today: '2026-11-03' });
 * // { kind: 'until-filled' }
 */
export function parseDeadline(raw: string, { today }: DeadlineOptions): Deadline {
  const base = parseToday(today);
  const text = raw.normalize('NFKC').trim();

  const date = readDate(text, base);
  if (date && isValid(date)) {
    const time = readTime(text);
    return time ? { kind: 'date', date: format(date), time } : { kind: 'date', date: format(date) };
  }
  if (UNTIL_FILLED.test(text)) return { kind: 'until-filled' };
  if (ROLLING.test(text)) return { kind: 'rolling' };
  return { kind: 'unknown', raw };
}

/**
 * 기준일에 아직 지원할 수 있는지 판단한다. 마감일 당일은 열려 있는 것으로 본다.
 * 상시 채용과 채용 시 마감은 공고가 내려가기 전까지 열려 있는 것으로 본다.
 */
export function isOpen(deadline: Deadline, today: IsoDate): Fit {
  const base = parseToday(today);
  switch (deadline.kind) {
    case 'date':
      return deadline.date >= format(base) ? 'yes' : 'no';
    case 'rolling':
    case 'until-filled':
      return 'yes';
    case 'unknown':
      return 'unknown';
  }
}
