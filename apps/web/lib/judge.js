/**
 * 다른 사이트 화면에서 읽은 표기 하나를 판정한다. 북마클릿이 쓴다.
 * 분야·검색어는 그 사이트 검색 조건이 이미 걸러 주므로 여기서는 경력·근무지·마감만 본다.
 */
import { matchesRegion } from 'kr-job-parser';
import { normalizeJob } from './normalize-job.js';
import { JOBKOREA_REGION } from './site-links.js';
import { REGIONS } from './matching.js';
import { SIDO } from 'kr-job-parser';

/**
 * @typedef {{ regions: string[], includeUnspecified: boolean }} Conditions
 *   regions가 비어 있으면 지역 제한 없음.
 * @typedef {{ status: 'match' | 'review' | 'exclude', reasons: string[], fields: { label: string, raw: string, reading: string, ok: boolean | null }[] }} Verdict
 */

const EXPERIENCE_READING = {
  new: '신입 지원 가능',
  unspecified: '경력무관',
  experienced: '경력자만',
  unknown: '해석 불가',
};

function locationReading(location) {
  const places = location.places.map(place => [place.sido, place.sigungu].filter(Boolean).join(' '));
  const extras = [
    location.nationwide && '전국',
    location.remote === 'full' && '재택',
    location.remote === 'partial' && '재택 병행',
    location.others && `외 ${location.others === 'unknown' ? '다수' : location.others + '곳'}`,
  ].filter(Boolean);
  return [...places, ...extras].join(' · ') || '해석 불가';
}

function deadlineReading(job) {
  if (job.deadlineKind === 'date') return job.deadline;
  return { rolling: '상시채용', 'until-filled': '채용 시 마감', unknown: '해석 불가' }[job.deadlineKind] ?? '해석 불가';
}

/** 여러 지역 중 하나라도 되면 yes, 모두 아니면 no, 그 밖에는 unknown. */
function regionFit(location, regions) {
  if (regions.length === 0) return 'yes';
  const fits = regions.map(region => matchesRegion(location, region));
  if (fits.includes('yes')) return 'yes';
  return fits.every(fit => fit === 'no') ? 'no' : 'unknown';
}

/**
 * @param {{ experience: string, location: string, deadline: string }} raw
 * @param {Conditions} conditions
 * @param {string} today YYYY-MM-DD
 * @returns {Verdict}
 */
export function judge(raw, conditions, today) {
  const job = normalizeJob({ raw }, today);
  const region = regionFit(job.location, conditions.regions);
  const experienceOk = job.experience === 'new' || (job.experience === 'unspecified' && conditions.includeUnspecified);

  const fields = [
    { label: '경력', raw: raw.experience, reading: EXPERIENCE_READING[job.experience], ok: job.experience === 'unknown' ? null : experienceOk },
    { label: '근무지', raw: raw.location, reading: locationReading(job.location), ok: region === 'unknown' ? null : region === 'yes' },
    { label: '마감', raw: raw.deadline, reading: deadlineReading(job), ok: job.deadlineKind === 'unknown' ? null : !job.closed },
  ];

  const excluded = [];
  if (job.experience === 'experienced') excluded.push('경력자만 지원');
  if (job.experience === 'unspecified' && !conditions.includeUnspecified) excluded.push('경력무관 제외 설정');
  if (region === 'no') excluded.push('선택한 근무지 아님');
  if (job.closed) excluded.push('마감됨');
  if (excluded.length) return { status: 'exclude', reasons: excluded, fields };

  const unsure = fields.filter(field => field.ok === null).map(field => `${field.label} 확인 필요`);
  if (unsure.length) return { status: 'review', reasons: unsure, fields };
  return { status: 'match', reasons: ['신입 지원 가능 · 조건 일치'], fields };
}

const SIDO_BY_JOBKOREA = new Map();
for (const [sido, code] of Object.entries(JOBKOREA_REGION)) {
  SIDO_BY_JOBKOREA.set(code, [...(SIDO_BY_JOBKOREA.get(code) ?? []), sido]);
}

/**
 * 잡코리아 검색 주소에서 판정 조건을 되읽는다.
 * 우리 사이트 바로가기로 넘어왔든 잡코리아 화면에서 필터를 바꿨든 주소가 곧 조건이다.
 * @param {string} href
 * @returns {Conditions}
 */
export function conditionsFromJobkoreaUrl(href) {
  let params;
  try { params = new URL(href).searchParams; } catch { return { regions: [], includeUnspecified: true }; }
  const split = name => (params.get(name) ?? '').split(',').map(value => value.trim()).filter(Boolean);
  const regions = [...new Set(split('local').flatMap(code => SIDO_BY_JOBKOREA.get(code) ?? []))]
    .filter(region => REGIONS.includes(region));
  const career = split('careerType');
  // 경력 조건을 걸지 않았거나 경력무관(4)을 포함했으면 경력무관 공고도 맞춤으로 본다.
  const includeUnspecified = career.length === 0 || career.includes('4');
  return { regions, includeUnspecified };
}

// "서울 금천구", "충남 외 1", "전국"처럼 시·도 이름으로 시작하고 바로 띄어 쓰거나 끝나는 짧은 조각.
// "서울신용보증재단" 같은 회사명은 띄어쓰기가 없어 걸리지 않는다.
const LOCATION_TEXT = new RegExp(`^(?:${[...SIDO, '전국', '전남광주'].join('|')})(?:\\s|$)`, 'u');

/**
 * 잡코리아 공고 카드 안의 짧은 글자 조각에서 경력·근무지·마감 표기를 고른다.
 * 클래스명은 자주 바뀌므로 글자 모양으로만 찾는다.
 * @param {string[]} texts 카드 안 말단 요소들의 글자 (화면 순서)
 * @returns {{ experience: string, location: string, deadline: string }}
 */
export function pickJobkoreaFields(texts) {
  const clean = texts.map(text => text.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const short = max => text => text.length <= max;
  const experience = clean.find(text => /^(?:신입|경력|인턴)/u.test(text) && !/지원\s*가능|채용\s*진행/u.test(text) && short(20)(text)) ?? '';
  const location = clean.find(text => LOCATION_TEXT.test(text) && short(25)(text)) ?? '';
  const deadline = clean.find(text => /(?:마감|상시\s*채용|채용\s*시)$|^~\s*\d/u.test(text) && !/등록$/u.test(text) && short(20)(text)) ?? '';
  return { experience, location, deadline };
}
