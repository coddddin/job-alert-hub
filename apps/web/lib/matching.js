import { matchesRegion, SIDO } from 'kr-job-parser';

export const ROLES = Object.freeze(['all', '프론트엔드', '백엔드', '풀스택', '모바일', '게임', '데이터·AI', '임베디드', '전산·IT']);
/** 시·도 목록은 파서가 아는 값을 그대로 쓴다. 필터와 해석 규칙이 어긋나지 않게 하려고. */
export const REGIONS = Object.freeze(['all', ...SIDO]);

export const defaults = Object.freeze({ role: 'all', region: '서울', includeUnspecified: true, keyword: '' });

export function matchesCatalogFilters(job, filters) {
  if (filters.role !== 'all' && job.role !== filters.role) return false;
  if (!filters.includeUnspecified && job.experience === 'unspecified') return false;
  if (filters.region !== 'all' && matchesRegion(job.location, filters.region) === 'no') return false;
  const searchable = [job.title, job.company, ...job.skills].join(' ').toLocaleLowerCase();
  return filters.keyword.trim().toLocaleLowerCase().split(/\s+/).every(word => searchable.includes(word));
}

export function matchJob(job, filters = defaults) {
  if (job.closed) return { status: 'exclude', reason: '마감된 공고' };
  if (job.id?.startsWith('jobkorea:') && !job.role) return { status: 'exclude', reason: '직무 분류 대기 중' };
  if (job.kind !== 'development') return { status: 'exclude', reason: '개발 채용공고 아님' };
  if (filters.role !== 'all' && job.role !== filters.role) return { status: 'exclude', reason: '선택한 분야 아님' };
  if (job.experience === 'experienced') return { status: 'exclude', reason: '경력 필수' };
  if (job.experience === 'unspecified' && !filters.includeUnspecified) return { status: 'exclude', reason: '경력무관 제외 설정' };
  // 근무지 판단은 kr-job-parser에 맡긴다. "외 2곳"처럼 숨은 근무지가 있으면 'unknown'이 된다.
  const region = filters.region === 'all' ? 'yes' : matchesRegion(job.location, filters.region);
  if (region === 'no') return { status: 'exclude', reason: '선택한 근무지 아님' };
  const words = filters.keyword.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const searchable = [job.title, job.company, ...job.skills].join(' ').toLocaleLowerCase();
  if (!words.every(word => searchable.includes(word))) return { status: 'exclude', reason: '검색어 불일치' };
  if (job.experience === 'unknown' || job.ambiguous || region === 'unknown') {
    return { status: 'review', reason: '근무지 또는 지원 조건 확인 필요' };
  }
  return { status: 'match', reason: `${filters.region === 'all' ? '지역 제한 없음' : filters.region + ' 근무'} · ${job.experience === 'unspecified' ? '경력무관' : '신입 지원 명시'}` };
}

export function notificationCandidates(jobs, filters, bookmarksOnly = null) {
  return jobs.filter(job => matchJob(job, filters).status === 'match' && (!bookmarksOnly || bookmarksOnly.includes(job.id)));
}
