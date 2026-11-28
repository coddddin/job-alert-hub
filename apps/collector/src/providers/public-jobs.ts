import type { CollectedJob } from '../job.js';
import type { Provider } from './provider.js';
import { withEstimate } from '../classify/model.js';
import { classifyKeywords, classifySaraminTags, developmentEvidence, SARAMIN_TAGS_VERSION, type Classified, type JobSignals } from '../classify/index.js';

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

/**
 * 직무 판정: IT 여부와 채용 아님은 키워드 규칙이 정한다. 규칙이 IT가 아니라고 본 공고는
 * 사이트 직무 키워드(jobNames)를 사람인 태그 사전으로 16개 직무군에 매핑한다.
 * 사전이 IT라고 하거나 아무것도 못 찾으면 규칙 결과를 그대로 둔다(충돌은 확정하지 않는다).
 */
/** 직무가 아니라 지원 방법이다("홈페이지 지원"). 직무 판정과 꼬리표에서 뺀다. */
const NOT_JOB = /^홈페이지\s*지원$/u;
/** 여러 직무를 한 공고에 묶었다는 제목. 사이트 키워드만으로 개발 공고로 정하지 않는다. */
const BUNDLED = /각\s*부문|부문별|분야별|공개\s*채용|공채|정기\s*채용|수시\s*채용|대규모|인재영입|[/,·].*(?:기획|영업|PM|사무|컨설)/u;

function decide(title: string, raw: JobSignals | undefined): Classified {
  const signals = raw && { ...raw, jobNames: raw.jobNames.filter(name => !NOT_JOB.test(name.trim())) };
  const rule = classifyKeywords(title, signals);
  if (!signals || rule.classification.nonHiring) return rule;
  const byTags = classifySaraminTags(signals.jobNames, title);
  // 규칙이 한 필드뿐이라 정하지 못했지만 사이트 직무 키워드가 개발만 가리키면 개발로 본다(두 번째 근거).
  if (rule.classification.method === 'none' && byTags.families.length === 1 && byTags.families[0] === 'it' && !BUNDLED.test(title)) {
    return { ...byTags, classification: { ...byTags.classification, version: `jobkorea-jobnames+${SARAMIN_TAGS_VERSION}`, evidence: [...new Set([...rule.classification.evidence, ...byTags.classification.evidence.map(e => e.replace(/^tag:/u, 'job:'))])].slice(0, 5) } };
  }
  // 규칙은 개발이라는데 사이트 직무 키워드의 절반 이상이 다른 직무군이면(여러 부문 묶음 공고) 확정하지 않는다.
  if (rule.kind === 'development') {
    const each = signals.jobNames.map(name => classifySaraminTags([name]).families);
    const dev = each.filter(families => families.includes('it')).length;
    const other = each.filter(families => families.length && !families.includes('it')).length;
    if (other <= dev) return rule;
    return { kind: 'other', role: '', families: [], classification: { method: 'none', version: rule.classification.version, evidence: [...rule.classification.evidence.slice(0, 3), ...byTags.classification.evidence.slice(0, 2).map(e => e.replace(/^tag:/u, 'job:'))] } };
  }
  if (!byTags.families.length || byTags.families.includes('it')) return rule;
  // 여러 부문을 묶은 공고는 직무군이 많아진다. 태그가 많은 상위 3개만 남겨 모든 맞춤에 끼지 않게 한다.
  return {
    ...byTags,
    families: byTags.families.slice(0, 3),
    classification: {
      method: 'source-tag', version: `jobkorea-jobnames+${SARAMIN_TAGS_VERSION}`,
      evidence: byTags.classification.evidence.map(e => e.replace(/^tag:/u, 'job:')),
    },
  };
}

/**
 * 판정 결과에 더해, 직무를 확정하지 못한 채용 공고라도 제목·사이트 직무 키워드에 개발 신호가 있으면
 * IT 후보로 표시한다. 후보는 확정이 아니므로 직무군(families)은 비워 두고 근거만 붙인다.
 */
export function classifyJobKorea(title: string, raw: JobSignals | undefined): Classified {
  const result = decide(title, raw);
  if (result.families.length || result.classification.nonHiring) return result;
  const signals = raw && { ...raw, jobNames: raw.jobNames.filter(name => !NOT_JOB.test(name.trim())) };
  const dev = developmentEvidence(title, signals);
  const flagged = dev.length ? { ...result, classification: { ...result.classification, candidates: ['it'], evidence: [...new Set([...result.classification.evidence, ...dev])].slice(0, 8) } } : result;
  // 규칙·사이트 키워드가 못 정한 공고만 모델이 추정한다(평가: tools/public-jobs/family-model-eval-2026-11-28.json).
  return withEstimate(flagged, title, signalTags(raw));
}

/** 목록 표시와 검색에 쓰는 꼬리표: 사이트 직무 키워드와 스킬, 중복 없이 최대 10개. */
function signalTags(signals: JobSignals | undefined): string[] {
  return [...new Set([...(signals?.jobNames ?? []), ...(signals?.skills ?? [])])].filter(tag => !NOT_JOB.test(tag.trim())).slice(0, 10);
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
    ...classifyJobKorea(title.value, item.signals), employment: '', tags: signalTags(item.signals), description: '', details: null,
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
