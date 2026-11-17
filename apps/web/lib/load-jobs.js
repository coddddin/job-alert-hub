import { normalizeJob } from './normalize-job.js';
import { jobs as sampleJobs, sampleDate } from '../data/jobs.js';

/** 외부 데이터의 링크는 http(s)만 허용한다. `javascript:` 같은 주소가 화면에 들어가지 않게 한다. */
export function safeUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null;
}

/** 매일 수집하므로 36시간이 넘은 출처는 오래된 데이터로 표시한다. */
export const STALE_HOURS = 36;
export function isStale(collectedAt, now = new Date()) {
  const time = Date.parse(collectedAt);
  return !Number.isFinite(time) || now.getTime() - time > STALE_HOURS * 3600_000;
}

/**
 * 수집기가 만든 실데이터 스냅샷(`data/live/snapshot.json`)이 있으면 그것을 쓰고,
 * 없거나 읽을 수 없으면 가상 샘플로 돌아간다. 주소에 `?sample`을 붙이면 샘플을 강제한다.
 *
 * @param {{ fetch?: typeof fetch, search?: string }} [options]
 */
export async function loadJobs({ fetch: fetchImpl = globalThis.fetch, search = '' } = {}) {
  const sample = { mode: 'sample', today: sampleDate, collectedAt: null, sources: [], jobs: sampleJobs };
  if (new URLSearchParams(search).has('sample')) return sample;
  try {
    const response = await fetchImpl('./data/live/snapshot.json', { cache: 'no-store' });
    if (!response.ok) return sample;
    const snapshot = await response.json();
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.jobs)) return sample;
    return {
      mode: 'live',
      today: snapshot.today,
      collectedAt: snapshot.collectedAt,
      // 출처마다 수집 시각이 다를 수 있다. 없으면 스냅샷 전체 수집 시각을 쓴다.
      sources: (Array.isArray(snapshot.sources) ? snapshot.sources : []).map(source => ({ ...source, collectedAt: source.collectedAt ?? snapshot.collectedAt })),
      // 수집기는 원문만 저장한다. 해석은 지금 이 시점의 kr-job-parser로 한다.
      jobs: snapshot.jobs.map(job => normalizeJob({ ...job, url: safeUrl(job.url), applyUrl: safeUrl(job.applyUrl), skills: job.tags ?? [] }, snapshot.today)),
    };
  } catch {
    return sample;
  }
}
