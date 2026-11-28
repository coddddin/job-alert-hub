/**
 * 출처 코드가 없는 공고(잡코리아)의 키워드 규칙 분류. 설계 4절의 판정 순서를 따른다:
 * 비채용 → 음성 우세 → "직무별 상이" → 역할 → 개발 신호만이면 전산·IT. 애매하면 미분류.
 * 제목만으로는 정하지 않는다. 사전은 `keyword-rules.v1.json`이며 바꾸면 holdout으로 다시 잰다.
 */
import rules from './keyword-rules.v1.json' with { type: 'json' };
import { UNCLASSIFIED, type Classified } from './index.js';

/** 추출기가 넘기는 원문 신호. 분류는 하지 않은 값이다. */
export interface JobSignals {
  readonly skills: readonly string[];
  readonly duties: string | null;
  readonly jobNames: readonly string[];
}

type Field = 'title' | 'job' | 'skill' | 'duty';
interface Hit { readonly field: Field; readonly keyword: string }

export const KEYWORD_RULES_VERSION = rules.version;

function pattern(keyword: string): RegExp {
  const body = keyword.trim().split(/\s+/u).map(part => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('\\s*');
  const before = /^[A-Za-z0-9]/u.test(keyword) ? '(?<![A-Za-z0-9])' : '';
  const after = /[A-Za-z0-9]$/u.test(keyword) ? '(?![A-Za-z0-9])' : '';
  return new RegExp(`${before}${body}${after}`, 'iu');
}

const compile = (words: readonly string[]) => words.map(keyword => ({ keyword, re: pattern(keyword) }));
const dictionary = {
  nonHiring: compile(rules.nonHiring),
  nonHiringCounter: compile(rules.nonHiringCounter),
  varies: compile(rules.varies),
  development: compile(rules.development),
  negative: compile(rules.negative),
  managerTitle: compile(rules.managerTitle),
  listedNonDev: compile([...rules.negative, ...rules.managerTitle, ...rules.listedNonDev]),
  roles: Object.entries(rules.roles).map(([role, words]) => ({ role, words: compile(words) })),
};
const unless: Readonly<Record<string, readonly string[]>> = rules.negativeUnless;

function texts(title: string, signals: JobSignals): readonly (readonly [Field, string])[] {
  return [
    ['title', title],
    ...signals.jobNames.map(value => ['job', value] as const),
    ...signals.skills.map(value => ['skill', value] as const),
    ...(signals.duties ? [['duty', signals.duties] as const] : []),
  ];
}

function find(items: readonly (readonly [Field, string])[], words: ReturnType<typeof compile>): Hit[] {
  const hits = new Map<string, Hit>();
  for (const [field, value] of items) {
    for (const { keyword, re } of words) {
      // "회로설계"/"회로 설계"처럼 공백·대소문자만 다른 표기는 같은 패턴이므로 한 번만 센다.
      const key = `${field}:${keyword.replace(/\s+/gu, '').toLocaleLowerCase()}`;
      if (!hits.has(key) && re.test(value)) hits.set(key, { field, keyword });
    }
  }
  return [...hits.values()];
}

const evidence = (hits: readonly Hit[]) => hits.slice(0, 8).map(hit => `${hit.field}:${hit.keyword}`);
const rule = (kind: Classified['kind'], role: string, hits: readonly Hit[], nonHiring = false): Classified => ({
  kind, role,
  // IT만 직무군을 확정한다. 비IT 직무군 사전은 아직 없어 빈 목록(화면에서 "분류 대기")으로 둔다.
  families: kind === 'development' ? ['it'] : [],
  classification: { method: 'rule', version: KEYWORD_RULES_VERSION, evidence: evidence(hits), ...(nonHiring ? { nonHiring: true } : {}) },
});
const undecided = (hits: readonly Hit[]): Classified => ({
  ...UNCLASSIFIED,
  classification: { method: 'none', version: KEYWORD_RULES_VERSION, evidence: evidence(hits) },
});

/**
 * 제목·사이트 직무 키워드·비고에서 찾은 개발 신호(스킬 목록은 제외). 확정에는 쓰지 않고,
 * 미분류 공고를 "IT 후보"로 표시해 놓치지 않게 하는 데만 쓴다.
 */
// 후보 표시 전용 단어(확정 사전 keyword-rules.v1.json에는 넣지 않는다: 확정 정밀도를 holdout으로 잰 사전이라).
const CANDIDATE_IT = compile([
  'Data Engineering', 'Data Engineer', '데이터 엔지니어', '데이터파이프라인', '데이터 플랫폼', 'AI Engineer', 'AI 엔지니어',
  'ML Engineer', '머신러닝', 'MLOps', 'LLM', '네트워크 엔지니어', '네트워크관리', '시스템 엔지니어', '시스템운영', '인프라',
  'SRE', 'DBA', '클라우드', 'DevOps', '보안 엔지니어', '정보보안', '소프트웨어', 'SW', '프로그래머', '개발자',
]);

export function developmentEvidence(title: string, signals: JobSignals | undefined): string[] {
  if (!signals) return [];
  const items = texts(title, signals).filter(([field]) => field !== 'skill');
  const hits = [...dictionary.roles.flatMap(({ words }) => find(items, words)), ...find(items, dictionary.development), ...find(items, CANDIDATE_IT)];
  return [...new Set(evidence(hits))];
}

function negativeHits(items: readonly (readonly [Field, string])[]): Hit[] {
  const whole = items.map(([, value]) => value).join(' ');
  return find(items, dictionary.negative)
    .filter(hit => !(unless[hit.keyword] ?? []).some(word => pattern(word).test(whole)));
}

/** 규칙이 본 비개발 신호(음성 키워드). 미분류가 동률 때문인지 구분할 때 쓴다. */
export function nonDevelopmentEvidence(title: string, signals: JobSignals | undefined): string[] {
  return signals ? evidence(negativeHits(texts(title, signals))) : [];
}

/** 잡코리아 공고의 제목과 원문 신호로 개발 직무·역할을 정한다. 신호가 없으면 미분류. */
export function classifyKeywords(title: string, signals: JobSignals | undefined): Classified {
  if (!signals) return UNCLASSIFIED;
  const items = texts(title, signals);
  const notSkill = items.filter(([field]) => field !== 'skill');

  // 1. 교육생·수강생·사업점 모집처럼 채용이 아닌 공고. 강한 표현이 있고, 제목·비고에 채용·정규직·연봉 같은
  //    반대 신호가 없을 때만 정한다("채용연계" 교육은 반대 신호가 아니다). 스킬 목록은 보지 않는다(교육 과목일 수 있다).
  const nonHiring = find(notSkill, dictionary.nonHiring);
  const stated = items.filter(([field]) => field === 'title' || field === 'duty')
    .map(([field, value]) => [field, rules.nonHiringCounterExcept.reduce((text, phrase) => text.replace(pattern(phrase), ''), value)] as const);
  const counter = find(stated, dictionary.nonHiringCounter);
  if (nonHiring.length && !counter.length) return rule('other', '기타', nonHiring, true);

  const negative = negativeHits(items);
  const roleHits = dictionary.roles.map(({ role, words }) => ({ role, hits: find(items, words) })).filter(r => r.hits.length);
  const positive = [...roleHits.flatMap(r => r.hits), ...find(items, dictionary.development)];

  // 2. 비개발 키워드가 더 많으면 개발 공고가 아니다. 같으면 애매하므로 미분류.
  if (negative.length > positive.length) return rule('other', '기타', negative);
  if (!positive.length) return undecided(negative);
  if (negative.length === positive.length) return undecided([...positive, ...negative]);

  // 3. "직무별 상이"나 각 부문·공개채용처럼 여러 직무를 한 공고에 묶은 경우는 개발 공고로 확정하지 않는다.
  const varies = find(notSkill, dictionary.varies);
  if (varies.length) return undecided(varies);
  // 제목이 PM·PO 같은 관리 직무이거나, "개발/사업기획/영업"처럼 비개발 직무를 함께 나열하면 확정하지 않는다.
  const managed = find([['title', title]], dictionary.managerTitle);
  if (managed.length) return undecided(managed);
  const listed = title.split(/[/ㆍ·,]/u).map(part => ['title', part] as const);
  const listedNonDev = listed.length > 1 ? find(listed, dictionary.listedNonDev) : [];
  if (listedNonDev.length) return undecided([...listedNonDev, ...positive]);

  // 4. 제목만, 또는 한 필드만으로는 확정하지 않는다. 두 필드 이상이 같은 방향이어야 한다.
  if (new Set(positive.map(hit => hit.field)).size < 2) return undecided(positive);

  const roles = new Set(roleHits.map(r => r.role));
  const fullStack = roles.has('풀스택') || (roles.has('프론트엔드') && roles.has('백엔드'));
  if (fullStack) {
    roles.delete('프론트엔드');
    roles.delete('백엔드');
    roles.add('풀스택');
  }
  if (roles.size > 1) {
    // 제목에 역할이 하나만 있고 다른 필드도 그 역할을 가리키면 제목을 따른다(예: 프론트엔드 공고의 키워드에 안드로이드).
    const titled = roleHits.filter(r => r.hits.some(hit => hit.field === 'title'));
    const only = titled.length === 1 ? titled[0] : undefined;
    if (!only?.hits.some(hit => hit.field !== 'title')) return undecided(positive);
    return rule('development', only.role, [...only.hits, ...positive.filter(hit => !only.hits.includes(hit))]);
  }
  const [role] = roles;
  // 사이트 직무 키워드는 넓게 붙어 있어(웹 공고에 '펌웨어') 그것만으로는 세부 역할을 정하지 않는다.
  const named = role === '풀스택' ? roleHits.filter(r => ['풀스택', '프론트엔드', '백엔드'].includes(r.role)) : roleHits.filter(r => r.role === role);
  const confirmed = named.some(r => r.hits.some(hit => hit.field === 'title' || hit.field === 'skill'));
  return rule('development', role && confirmed ? role : '전산·IT', positive);
}
