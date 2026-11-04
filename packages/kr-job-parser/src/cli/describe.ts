import type { Deadline } from '../deadline.js';
import type { Experience, YearBound, YearRange } from '../experience.js';
import type { WorkLocation } from '../location.js';

/** 사람이 읽는 출력용 설명. 라이브러리 결과를 바꾸지 않고 문장으로만 옮긴다. */

function years(value: number): string {
  // `6개월`처럼 1년이 안 되는 경계는 파서가 0.5년으로 바꾼다. 출력은 원래 단위로 되돌린다.
  return Number.isInteger(value) ? `${String(value)}년` : `${String(Math.round(value * 12))}개월`;
}

const lower = ({ years: value, inclusive }: YearBound): string => `${years(value)} ${inclusive ? '이상' : '초과'}`;
const upper = ({ years: value, inclusive }: YearBound): string => `${years(value)} ${inclusive ? '이하' : '미만'}`;

function range({ min, max }: YearRange): string {
  if (min && max) return ` ${lower(min)} ${upper(max)}`;
  if (min) return ` ${lower(min)}`;
  if (max) return ` ${upper(max)}`;
  return '';
}

export function describeExperience(experience: Experience): string {
  switch (experience.kind) {
    case 'new':
      return '신입';
    case 'any':
      return '경력무관';
    case 'experienced':
      return `경력${range(experience.range)}`;
    case 'new-or-experienced':
      return `신입 또는 경력${range(experience.range)}`;
    case 'unknown':
      return '해석하지 못함';
  }
}

export function describeLocation(location: WorkLocation): string {
  const parts = location.places.map(({ sido, sigungu }) => (sigungu ? `${sido} ${sigungu}` : sido));
  if (location.nationwide) parts.unshift('전국');
  if (location.others === 'unknown') parts.push('외 다수');
  else if (location.others > 0) parts.push(`외 ${String(location.others)}곳`);
  if (location.remote === 'full') parts.push('재택');
  if (location.remote === 'partial') parts.push('재택 병행');
  const text = parts.length > 0 ? parts.join(' · ') : '근무지 없음';
  return location.unparsed.length > 0 ? `${text} (해석하지 못함: ${location.unparsed.join(', ')})` : text;
}

const WEEKDAYS = '일월화수목금토';

export function describeDeadline(deadline: Deadline): string {
  switch (deadline.kind) {
    case 'date': {
      // 달력 날짜만 필요하므로 UTC 자정으로 만들어 실행 환경의 시간대 영향을 받지 않게 한다.
      const weekday = WEEKDAYS[new Date(`${deadline.date}T00:00:00Z`).getUTCDay()] ?? '';
      return `${deadline.date} (${weekday})${deadline.time ? ` ${deadline.time}` : ''} 마감`;
    }
    case 'rolling':
      return '상시 채용';
    case 'until-filled':
      return '채용 시 마감';
    case 'unknown':
      return '해석하지 못함';
  }
}
