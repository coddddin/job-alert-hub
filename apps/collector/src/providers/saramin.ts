/**
 * 사람인 공개 검색 목록에서 Python 추출기(`tools/public-jobs/saramin_list.py`)가 만든 JSON 계약 v1을 읽는다.
 * 네트워크·Python을 실행하지 않는다. 신뢰하지 않는 입력을 강제 변환 없이 검증하고, 분류는 태그 사전으로 한다.
 */
import type { CollectedJob } from '../job.js';
import type { Provider } from './provider.js';
import type { ExtractedField } from './public-jobs.js';
import { classifySaraminTags } from '../classify/index.js';
import { withEstimate } from '../classify/model.js';
import { koreanDate } from '../collect.js';

export const saraminFields = ['company', 'title', 'location', 'experience', 'deadline', 'education', 'employment'] as const;
export type SaraminField = typeof saraminFields[number];
export interface SaraminObservation {
  readonly externalId: string;
  readonly url: string;
  readonly observedAt: string;
  readonly extractorVersion: 'saramin-list/1';
  readonly query: string;
  readonly page: number;
  readonly fields: Readonly<Record<SaraminField, ExtractedField>>;
  readonly tags: readonly string[];
  readonly tagsTruncated: boolean;
  readonly warnings: readonly string[];
}

const DETAIL = 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonempty(value: unknown, max = 4000): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
function field(value: unknown): value is ExtractedField {
  if (!object(value)) return false;
  if (value['status'] === 'extracted') return nonempty(value['value']) && nonempty(value['evidence']);
  return (value['status'] === 'missing' || value['status'] === 'conflict') && value['value'] === null && value['evidence'] === null;
}

function observation(value: unknown): value is SaraminObservation {
  if (!object(value)) return false;
  const id = value['externalId'];
  if (typeof id !== 'string' || !/^\d{1,12}$/u.test(id) || value['url'] !== `${DETAIL}${id}`) return false;
  const observed = value['observedAt'];
  if (typeof observed !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|\+00:00)$/u.test(observed) || !Number.isFinite(Date.parse(observed))) return false;
  if (new Date(observed).toISOString().slice(0, 10) !== observed.slice(0, 10)) return false;
  if (value['extractorVersion'] !== 'saramin-list/1' || !nonempty(value['query'], 40)) return false;
  if (typeof value['page'] !== 'number' || !Number.isInteger(value['page']) || value['page'] < 1 || value['page'] > 10) return false;
  const fields = value['fields'];
  const tags = value['tags'];
  return object(fields) && saraminFields.every(name => field(fields[name])) &&
    Array.isArray(tags) && tags.length <= 30 && tags.every(tag => nonempty(tag, 60)) && new Set(tags).size === tags.length &&
    typeof value['tagsTruncated'] === 'boolean' &&
    Array.isArray(value['warnings']) && value['warnings'].every(warning => nonempty(warning));
}

/** Validate untrusted Python JSON at the language boundary, without coercion. */
export function readSaraminBatch(input: unknown): { jobs: SaraminObservation[]; invalid: number } {
  if (!object(input) || input['version'] !== 1 || input['source'] !== 'saramin' || !Array.isArray(input['jobs'])) {
    throw new Error('Unsupported saramin batch');
  }
  const jobs = input['jobs'].filter(observation);
  return { jobs, invalid: input['jobs'].length - jobs.length };
}

/**
 * 목록의 시각만 있는 마감("17시마감")은 관측한 한국 날짜에 붙인다. 다른 표기는 원문 그대로 파서에 맡긴다.
 * "오늘마감"·"~ 11/19(목)"처럼 기준일이 필요한 표기는 결합 단계에서 같은 날짜만 받으므로 그대로 둔다.
 */
export function saraminDeadline(raw: string, observedAt: string): string {
  const hour = /^(\d{1,2})시\s*마감$/u.exec(raw)?.[1];
  if (hour === undefined || Number(hour) > 24) return raw;
  return `${koreanDate(new Date(observedAt))} ${hour.padStart(2, '0')}:00 마감`;
}

function toJob(item: SaraminObservation): CollectedJob | null {
  const { company, title, location, experience, deadline, education, employment } = item.fields;
  if (!company.value || !title.value) return null;
  return {
    id: `saramin:${item.externalId}`, source: '사람인', company: company.value, title: title.value,
    url: item.url, applyUrl: item.url,
    raw: {
      location: location.value ?? '', experience: experience.value ?? '',
      deadline: deadline.value ? saraminDeadline(deadline.value, item.observedAt) : '',
    },
    // 태그 사전이 못 정한 공고(제목 거부어·충돌)는 모델이 추정한다(평가: family-model-eval-2026-11-28.json).
    ...withEstimate(classifySaraminTags(item.tags, title.value), title.value, item.tags),
    employment: employment.value ?? '', tags: item.tags, description: '',
    // The list shows education only; requirements and headcount stay unknown rather than invented.
    details: education.value
      ? { headcount: null, education: [education.value], minimumEducation: null, requirements: [], preferences: null }
      : null,
  };
}

/** Opt-in, offline Provider. Never fetches or launches Python. */
export function saramin(input: unknown): Provider {
  const { jobs: items, invalid } = readSaraminBatch(input);
  const groups = new Map<string, SaraminObservation[]>();
  for (const item of items) groups.set(item.externalId, [...(groups.get(item.externalId) ?? []), item]);
  const jobs: CollectedJob[] = [];
  let skipped = invalid;
  for (const group of groups.values()) {
    // The extractor keeps a duplicate only when it disagrees; quarantine the whole identity.
    const job = group.length === 1 && group[0] ? toJob(group[0]) : null;
    if (job) jobs.push(job);
    else skipped += group.length;
  }
  return {
    name: 'saramin', label: '사람인 (공개 목록)',
    collect: () => Promise.resolve({ jobs, skipped, total: items.length + invalid }),
  };
}
