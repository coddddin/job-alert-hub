import type { CollectedJob } from '../job.js';
import type { Provider } from './provider.js';
import { classifyKeywords, type JobSignals } from '../classify/index.js';

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
  /** `jobkorea-detail/2`부터. 추출기는 분류하지 않고 원문 신호만 넘긴다. */
  readonly signals?: JobSignals;
}
/** 받는 추출기 버전. /1은 신호가 없어 미분류로 들어온다. */
export const extractorVersions = ['jobkorea-detail/1', 'jobkorea-detail/2'] as const;
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

const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= 200 && value.every(item => nonempty(item) && item.length <= 200);

function signals(value: unknown): value is JobSignals {
  return object(value) && strings(value['skills']) && strings(value['jobNames']) &&
    (value['duties'] === null || nonempty(value['duties']));
}

function observation(value: unknown): value is PublicJobObservation {
  if (!object(value)) return false;
  if (typeof value['externalId'] !== 'string' || !/^\d+$/u.test(value['externalId'])) return false;
  if (value['url'] !== `https://www.jobkorea.co.kr/Recruit/GI_Read/${value['externalId']}`) return false;
  if (typeof value['observedAt'] !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|\+00:00)$/u.test(value['observedAt']) || !Number.isFinite(Date.parse(value['observedAt']))) return false;
  if (new Date(value['observedAt']).toISOString().slice(0, 10) !== value['observedAt'].slice(0, 10)) return false;
  if (value['extractorVersion'] === 'jobkorea-detail/1' && value['signals'] !== undefined) return false;
  if (!extractorVersions.some(version => version === value['extractorVersion'])) return false;
  if (value['signals'] !== undefined && !signals(value['signals'])) return false;
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
    // Rule classification from the extractor's raw signals; without signals it stays unclassified.
    // No invented company homepage, education or requirements.
    ...classifyKeywords(title.value, item.signals), employment: '', tags: [], description: '', details: null,
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
