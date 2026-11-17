import { matchesRegion } from 'kr-job-parser';
import { normalizeJob } from './normalize-job.js';

export function previewJobs(snapshot) {
  if (snapshot?.version !== 1 || !Array.isArray(snapshot.jobs) || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.today)) {
    throw new Error('올바른 미리보기 스냅샷이 아닙니다.');
  }
  const ids = new Set();
  return snapshot.jobs.map(job => {
    if (!job || !['id', 'source', 'company', 'title'].every(key => typeof job[key] === 'string' && job[key].trim()) ||
        !job.raw || !['location', 'experience', 'deadline'].every(key => typeof job.raw[key] === 'string') || ids.has(job.id)) {
      throw new Error('공고 형식 또는 중복 ID를 확인해주세요.');
    }
    ids.add(job.id);
    return normalizeJob(job, snapshot.today);
  });
}

export function mergePreviewSnapshots(base, incoming) {
  previewJobs(base); previewJobs(incoming);
  if (base.today !== incoming.today) throw new Error('같은 기준일의 스냅샷만 합칠 수 있습니다.');
  const merged = { ...incoming, jobs: [...base.jobs, ...incoming.jobs], sources: [...(base.sources ?? []), ...(incoming.sources ?? [])] };
  previewJobs(merged);
  return merged;
}

export function sourceUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function experienceSummary(experience) {
  const label = { new: '신입', 'new-or-experienced': '신입·경력', experienced: '경력', any: '경력무관', unknown: '확인 필요' }[experience.kind];
  const bounds = [];
  if (experience.range?.min) bounds.push(`${experience.range.min.years}년 ${experience.range.min.inclusive ? '이상' : '초과'}`);
  if (experience.range?.max) bounds.push(`${experience.range.max.years}년 ${experience.range.max.inclusive ? '이하' : '미만'}`);
  return [label, ...bounds].join(' · ');
}

export function filterPreview(jobs, { keyword = '', region = 'all', experience = 'all', source = 'all', includeClosed = true } = {}) {
  const words = keyword.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return jobs.filter(job => {
    if (!includeClosed && job.closed) return false;
    if (source !== 'all' && job.source !== source) return false;
    if (experience !== 'all' && job.parsed.experience.kind !== experience) return false;
    // Unknown regions remain visible for review, as in the existing matching logic.
    if (region !== 'all' && matchesRegion(job.location, region) === 'no') return false;
    return words.every(word => `${job.company} ${job.title} ${job.raw.location}`.toLocaleLowerCase().includes(word));
  });
}
