export const defaults = Object.freeze({ role: 'all', region: '서울', includeUnspecified: true, keyword: '' });

export function matchJob(job, filters = defaults) {
  if (job.closed) return { status: 'exclude', reason: '마감된 공고' };
  if (job.kind !== 'development') return { status: 'exclude', reason: '개발 채용공고 아님' };
  if (filters.role !== 'all' && job.role !== filters.role) return { status: 'exclude', reason: '선택한 분야 아님' };
  if (job.experience === 'experienced') return { status: 'exclude', reason: '경력 필수' };
  if (job.experience === 'unspecified' && !filters.includeUnspecified) return { status: 'exclude', reason: '경력무관 제외 설정' };
  if (filters.region !== 'all' && job.locations.length && !job.locations.includes(filters.region)) return { status: 'exclude', reason: '선택한 근무지 아님' };
  const words = filters.keyword.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const searchable = [job.title, job.company, ...job.skills].join(' ').toLocaleLowerCase();
  if (!words.every(word => searchable.includes(word))) return { status: 'exclude', reason: '검색어 불일치' };
  if (job.experience === 'unknown' || job.ambiguous || (!job.locations.length && filters.region !== 'all')) {
    return { status: 'review', reason: '근무지 또는 지원 조건 확인 필요' };
  }
  return { status: 'match', reason: `${filters.region === 'all' ? '지역 제한 없음' : filters.region + ' 근무'} · ${job.experience === 'unspecified' ? '경력무관' : '신입 지원 명시'}` };
}

export function notificationCandidates(jobs, filters, bookmarksOnly = null) {
  return jobs.filter(job => matchJob(job, filters).status === 'match' && (!bookmarksOnly || bookmarksOnly.includes(job.id)));
}
