import { matchesRegion, SIDO } from 'kr-job-parser';
import { FAMILY_IDS, familyLabel, IT_ROLES } from './taxonomy.js';

/** IT·개발의 세부 직무 필터. 다른 직무군에는 적용하지 않는다. */
export const ROLES = Object.freeze(['all', ...IT_ROLES]);
/** 시·도 목록은 파서가 아는 값을 그대로 쓴다. 필터와 해석 규칙이 어긋나지 않게 하려고. */
export const REGIONS = Object.freeze(['all', ...SIDO]);
/** 직무군 필터: 내 관심 직무(첫 방문 때 고른 것), 전체, 또는 직무군 하나. */
export const FAMILY_FILTERS = Object.freeze(['mine', 'all', ...FAMILY_IDS]);
/** 경력 단계: 신입(경력 필수 제외), 경력(신입 전용 제외), 상관없음. */
export const CAREERS = Object.freeze(['new', 'experienced', 'any']);

// 첫 방문 질문에 답하지 않은 사람은 예전처럼 IT·개발 신입 기준으로 본다.
export const defaults = Object.freeze({ family: 'it', families: Object.freeze([]), role: 'all', region: '서울', career: 'new', includeUnspecified: true, keyword: '' });

/** 공고의 직무군. 예전 스냅샷은 개발 공고만 알 수 있다. 모르면 빈 목록. */
export function familiesOf(job) {
  return job.families ?? (job.kind === 'development' ? ['it'] : []);
}

/** 선택한 직무군에 드는지: 'yes' | 'no' | 'unknown'(분류 대기). */
export function familyFit(job, filters) {
  const choice = filters.family ?? defaults.family;
  const wanted = choice === 'mine' ? (filters.families ?? []) : choice === 'all' ? [] : [choice];
  if (!wanted.length) return 'yes';
  const families = familiesOf(job);
  if (!families.length) return 'unknown';
  return families.some(family => wanted.includes(family)) ? 'yes' : 'no';
}

function keywordFit(job, keyword) {
  const searchable = [job.title, job.company, ...job.skills].join(' ').toLocaleLowerCase();
  return keyword.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).every(word => searchable.includes(word));
}

/** 전체 탭: 지원 가능 여부는 따지지 않고 직무·지역·검색어로만 거른다. */
export function matchesCatalogFilters(job, filters) {
  if (familyFit(job, filters) === 'no') return false;
  if (filters.role !== 'all' && job.role !== filters.role) return false;
  if (!filters.includeUnspecified && job.experience === 'unspecified') return false;
  if (filters.region !== 'all' && matchesRegion(job.location, filters.region) === 'no') return false;
  return keywordFit(job, filters.keyword);
}

const careerLabel = { new: '신입 지원 가능', experienced: '경력 지원 가능', any: '경력 조건 무관' };

/** 맞춤 탭과 알림: 내 직무·경력·지역에서 지금 지원할 수 있는지. */
export function matchJob(job, filters = defaults) {
  if (job.closed) return { status: 'exclude', reason: '마감된 공고' };
  if (job.kind === 'training' || job.classification?.nonHiring) return { status: 'exclude', reason: '채용공고 아님(교육·광고)' };
  const family = familyFit(job, filters);
  if (family === 'no') return { status: 'exclude', reason: '관심 직무 아님' };
  if (filters.role !== 'all' && job.role !== filters.role) return { status: 'exclude', reason: '선택한 세부 직무 아님' };
  const career = filters.career ?? 'new';
  if (career === 'new' && job.experience === 'experienced') return { status: 'exclude', reason: '경력 필수' };
  if (career === 'experienced' && job.parsed?.experience?.kind === 'new') return { status: 'exclude', reason: '신입 대상' };
  if (job.experience === 'unspecified' && !filters.includeUnspecified) return { status: 'exclude', reason: '경력무관 제외 설정' };
  // 근무지 판단은 kr-job-parser에 맡긴다. "외 2곳"처럼 숨은 근무지가 있으면 'unknown'이 된다.
  const region = filters.region === 'all' ? 'yes' : matchesRegion(job.location, filters.region);
  if (region === 'no') return { status: 'exclude', reason: '선택한 근무지 아님' };
  if (!keywordFit(job, filters.keyword)) return { status: 'exclude', reason: '검색어 불일치' };
  // 직무를 모르는 공고는 버리지 않고 확인 필요로 둔다. 알림에는 넣지 않는다.
  if (family === 'unknown') return { status: 'review', reason: '직무 분류 대기 · 원문에서 직무 확인' };
  if (job.experience === 'unknown' || job.ambiguous || region === 'unknown') {
    return { status: 'review', reason: '근무지 또는 지원 조건 확인 필요' };
  }
  const families = familiesOf(job).map(familyLabel).join('·');
  return { status: 'match', reason: `${families} · ${filters.region === 'all' ? '지역 제한 없음' : filters.region + ' 근무'} · ${job.experience === 'unspecified' ? '경력무관' : careerLabel[career]}` };
}

export function notificationCandidates(jobs, filters, bookmarksOnly = null) {
  return jobs.filter(job => matchJob(job, filters).status === 'match' && (!bookmarksOnly || bookmarksOnly.includes(job.id)));
}
