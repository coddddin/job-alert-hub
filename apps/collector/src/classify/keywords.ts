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
      if (re.test(value)) hits.set(`${field}:${keyword}`, { field, keyword });
    }
  }
  return [...hits.values()];
}

const evidence = (hits: readonly Hit[]) => hits.slice(0, 8).map(hit => `${hit.field}:${hit.keyword}`);
const rule = (kind: Classified['kind'], role: string, hits: readonly Hit[], nonHiring = false): Classified => ({
  kind, role,
  classification: { method: 'rule', version: KEYWORD_RULES_VERSION, evidence: evidence(hits), ...(nonHiring ? { nonHiring: true } : {}) },
});
const undecided = (hits: readonly Hit[]): Classified => ({
  ...UNCLASSIFIED,
  classification: { method: 'none', version: KEYWORD_RULES_VERSION, evidence: evidence(hits) },
});

/** 잡코리아 공고의 제목과 원문 신호로 개발 직무·역할을 정한다. 신호가 없으면 미분류. */
export function classifyKeywords(title: string, signals: JobSignals | undefined): Classified {
  if (!signals) return UNCLASSIFIED;
  const items = texts(title, signals);
  const notSkill = items.filter(([field]) => field !== 'skill');

  // 1. 교육생·수강생 모집처럼 채용이 아닌 공고. 스킬 목록은 보지 않는다(교육 과목일 수 있다).
  const nonHiring = find(notSkill, dictionary.nonHiring);
  if (nonHiring.length) return rule('other', '기타', nonHiring, true);

  const whole = items.map(([, value]) => value).join(' ');
  const negative = find(items, dictionary.negative)
    .filter(hit => !(unless[hit.keyword] ?? []).some(word => pattern(word).test(whole)));
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
