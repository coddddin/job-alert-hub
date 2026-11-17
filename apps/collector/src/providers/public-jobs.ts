import type { CollectedJob } from '../job.js';
import type { Provider } from './provider.js';

export const publicFields = ['company', 'title', 'location', 'experience', 'deadline'] as const;
export type PublicField = typeof publicFields[number];
export interface ExtractedField {
  readonly value: string | null;
  readonly status: 'extracted' | 'missing' | 'conflict';
  readonly evidence: string | null;
}
export interface PublicJobObservation {
  readonly externalId: string;
  readonly url: string;
  readonly observedAt: string;
  readonly extractorVersion: string;
  readonly fields: Readonly<Record<PublicField, ExtractedField>>;
  readonly warnings: readonly string[];
}
export interface PublicJobBatch {
  readonly version: 1;
  readonly source: 'jobkorea';
  readonly jobs: readonly PublicJobObservation[];
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 4000;
}

function field(value: unknown): value is ExtractedField {
  if (!object(value)) return false;
  if (value['status'] === 'extracted') return nonempty(value['value']) && nonempty(value['evidence']);
  return (value['status'] === 'missing' || value['status'] === 'conflict') && value['value'] === null && value['evidence'] === null;
}

function observation(value: unknown): value is PublicJobObservation {
  if (!object(value)) return false;
  if (typeof value['externalId'] !== 'string' || !/^\d+$/u.test(value['externalId'])) return false;
  if (value['url'] !== `https://www.jobkorea.co.kr/Recruit/GI_Read/${value['externalId']}`) return false;
  if (typeof value['observedAt'] !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|\+00:00)$/u.test(value['observedAt']) || !Number.isFinite(Date.parse(value['observedAt']))) return false;
  if (new Date(value['observedAt']).toISOString().slice(0, 10) !== value['observedAt'].slice(0, 10)) return false;
  if (value['extractorVersion'] !== 'jobkorea-detail/1') return false;
  const fields = value['fields'];
  return object(fields) && publicFields.every(name => field(fields[name])) &&
    Array.isArray(value['warnings']) && value['warnings'].every(nonempty);
}

/** Validate untrusted Python JSON at the language boundary, without coercion. */
export function readPublicBatch(input: unknown): { batch: PublicJobBatch; invalid: number } {
  if (!object(input) || input['version'] !== 1 || input['source'] !== 'jobkorea' || !Array.isArray(input['jobs'])) {
    throw new Error('Unsupported public job batch');
  }
  const jobs = input['jobs'].filter(observation);
  return { batch: { version: 1, source: 'jobkorea', jobs }, invalid: input['jobs'].length - jobs.length };
}

function toJob(item: PublicJobObservation): CollectedJob | null {
  const { company, title, location, experience, deadline } = item.fields;
  if (!company.value || !title.value) return null;
  return {
    id: `jobkorea:${item.externalId}`, source: 'jobkorea', company: company.value, title: title.value,
    url: item.url, applyUrl: item.url,
    raw: { location: location.value ?? '', experience: experience.value ?? '', deadline: deadline.value ?? '' },
    // No invented job classification, company homepage, education or requirements.
    kind: 'other', role: '', employment: '', tags: [], description: '', details: null,
  };
}

/** Opt-in, offline Provider. Never fetches, launches Python, or changes ALIO. */
export function publicJobs(input: unknown): Provider {
  const { batch, invalid } = readPublicBatch(input);
  const groups = new Map<string, PublicJobObservation[]>();
  for (const item of batch.jobs) groups.set(item.externalId, [...(groups.get(item.externalId) ?? []), item]);
  const jobs: CollectedJob[] = [];
  let skipped = invalid;
  for (const group of groups.values()) {
    // Even valid duplicate records may disagree. Quarantine the entire identity
    // rather than let file order decide which conditions reach the user.
    if (group.length !== 1) { skipped += group.length; continue; }
    for (const item of group) {
      const job = toJob(item);
      if (job) jobs.push(job);
      else skipped += 1;
    }
  }
  return {
    name: 'jobkorea', label: '잡코리아 (공개 페이지 실험)',
    collect: () => Promise.resolve({ jobs, skipped, total: batch.jobs.length + invalid }),
  };
}
