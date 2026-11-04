import type { IsoDate } from 'kr-job-parser';
import type { CollectedJob, Snapshot } from './job.js';
import type { FetchLike, Provider } from './providers/provider.js';

/** 수집 시각을 한국 날짜로 바꾼다. 마감 계산은 한국 날짜 기준이어야 자정 전후로 하루가 밀리지 않는다. */
export function koreanDate(now: Date): IsoDate {
  // en-CA 로캘은 YYYY-MM-DD 형식으로 출력한다.
  const formatted = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(formatted)) throw new Error(`예상하지 못한 날짜 형식: ${formatted}`);
  // 바로 위에서 형식을 확인했으므로 템플릿 리터럴 타입으로 좁혀도 안전하다.
  return formatted as IsoDate;
}

/** 수집처를 차례로 돌려 하나의 스냅샷으로 묶는다. 수집처 오류는 그대로 던진다. */
export async function collect(providers: readonly Provider[], fetch: FetchLike, now: Date): Promise<Snapshot> {
  const sources: Snapshot['sources'][number][] = [];
  const jobs: CollectedJob[] = [];
  for (const provider of providers) {
    const result = await provider.collect(fetch);
    sources.push({ name: provider.name, label: provider.label, total: result.total, skipped: result.skipped });
    jobs.push(...result.jobs);
  }
  return { version: 1, collectedAt: now.toISOString(), today: koreanDate(now), sources, jobs };
}
