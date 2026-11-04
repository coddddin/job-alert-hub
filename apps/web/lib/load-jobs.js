import { normalizeJob } from './normalize-job.js';
import { jobs as sampleJobs, sampleDate } from '../data/jobs.js';

/** 외부 데이터의 링크는 http(s)만 허용한다. `javascript:` 같은 주소가 화면에 들어가지 않게 한다. */
export function safeUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null;
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
      sources: snapshot.sources,
      // 수집기는 원문만 저장한다. 해석은 지금 이 시점의 kr-job-parser로 한다.
      jobs: snapshot.jobs.map(job => normalizeJob({ ...job, url: safeUrl(job.url), applyUrl: safeUrl(job.applyUrl), skills: job.tags ?? [] }, snapshot.today)),
    };
  } catch {
    return sample;
  }
}
