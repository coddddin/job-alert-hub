/**
 * 직무군 추정 모델(설계 8장). 규칙·사이트 키워드로 직무를 정하지 못한 공고에만 쓴다.
 * 가중치는 `family-model.v1.json`이며 `tools/public-jobs/train_family_model.py`가 만든다.
 * 계산은 scikit-learn의 TfidfVectorizer(char_wb, sublinear_tf, l2) + 직무군별 로지스틱 회귀와 같다.
 * 추정은 확정이 아니다: 화면은 "자동 추정"으로 보이고, 알림에는 넣지 않는다(후보 표시가 있으면 후보로만).
 */
import weights from './family-model.v1.json' with { type: 'json' };
import { FAMILY_IDS, type FamilyId } from './taxonomy.js';

export interface FamilyModel {
  readonly version: string;
  readonly ngram: readonly number[];
  readonly classes: readonly string[];
  readonly intercepts: readonly number[];
  /** [n-gram, idf, {직무군 순번: 가중치}] */
  readonly features: readonly (readonly [string, number, Readonly<Record<string, number>>])[];
}

export interface FamilyEstimate {
  readonly families: FamilyId[];
  /** 가장 높은 직무군의 확률. */
  readonly confidence: number;
  /** 가장 높은 직무군에 가장 크게 기여한 글자 조각. 상세 화면의 근거로 보인다. */
  readonly evidence: string[];
}

/** 평가(2026-11-24 잡코리아 116건)에 쓴 선택 규칙. 바꾸면 다시 잰다. */
const FLOOR = 0.3;
const RATIO = 0.5;
const MAX_FAMILIES = 3;

interface Compiled { readonly model: FamilyModel; readonly index: ReadonlyMap<string, number> }
const compiled = new WeakMap<FamilyModel, Compiled>();

function compile(model: FamilyModel): Compiled {
  let found = compiled.get(model);
  if (!found) {
    found = { model, index: new Map(model.features.map(([gram], i) => [gram, i])) };
    compiled.set(model, found);
  }
  return found;
}

/** scikit-learn `char_wb`: 낱말마다 앞뒤에 공백을 붙여 n-gram을 만든다. 낱말보다 긴 n은 낱말 전체 한 번. */
export function charWbNgrams(value: string, [min, max]: readonly number[]): string[] {
  const grams: string[] = [];
  for (const word of value.toLowerCase().split(/\s+/u).filter(Boolean)) {
    const chars = Array.from(` ${word} `);
    for (let n = min ?? 2; n <= (max ?? 4); n++) {
      grams.push(chars.slice(0, n).join(''));
      if (n >= chars.length) break; // 짧은 낱말은 한 번만 센다(scikit-learn과 같다)
      for (let start = 1; start + n <= chars.length; start++) grams.push(chars.slice(start, start + n).join(''));
    }
  }
  return grams;
}

export function estimateFamilies(title: string, tags: readonly string[], model: FamilyModel = weights): FamilyEstimate | null {
  const { index } = compile(model);
  const counts = new Map<number, number>();
  for (const gram of charWbNgrams(`${title} | ${tags.join(' ')}`, model.ngram)) {
    const i = index.get(gram);
    if (i !== undefined) counts.set(i, (counts.get(i) ?? 0) + 1);
  }
  if (!counts.size) return null;
  const values = new Map<number, number>();
  let norm = 0;
  for (const [i, count] of counts) {
    const value = (1 + Math.log(count)) * (model.features[i]?.[1] ?? 0);
    values.set(i, value);
    norm += value * value;
  }
  norm = Math.sqrt(norm);
  const logits = [...model.intercepts];
  for (const [i, value] of values) {
    for (const [c, weight] of Object.entries(model.features[i]?.[2] ?? {})) logits[Number(c)] = (logits[Number(c)] ?? 0) + (value / norm) * weight;
  }
  const ranked = logits.map((logit, c) => ({ family: model.classes[c] ?? '', p: 1 / (1 + Math.exp(-logit)), c }))
    .filter(entry => (FAMILY_IDS as readonly string[]).includes(entry.family))
    .sort((a, b) => b.p - a.p);
  const top = ranked[0];
  if (!top || top.p < FLOOR) return null;
  const families = ranked.slice(0, MAX_FAMILIES).filter(entry => entry.p >= FLOOR && entry.p >= RATIO * top.p).map(entry => entry.family as FamilyId);
  return { families, confidence: Math.round(top.p * 100) / 100, evidence: wordEvidence([title, ...tags], model, index, counts, values, norm, top.c) };
}

/** 근거는 글자 조각 대신 낱말로 보인다: 낱말마다 그 안의 n-gram이 1순위 직무군에 준 기여를 더해 큰 순서로 3개. */
function wordEvidence(parts: readonly string[], model: FamilyModel, index: ReadonlyMap<string, number>, counts: ReadonlyMap<number, number>, values: ReadonlyMap<number, number>, norm: number, c: number): string[] {
  const scores = new Map<string, number>();
  // 근거 낱말은 괄호·구분 기호로도 나눈다("직원(정규직" → "직원", "정규직").
  for (const word of parts.join(' ').split(/[\s()[\]{}<>/,·|]+/u)) {
    const clean = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (Array.from(clean).length < 2 || scores.has(clean)) continue;
    let score = 0;
    for (const gram of charWbNgrams(clean, model.ngram)) {
      const i = index.get(gram);
      if (i === undefined) continue;
      // 같은 n-gram이 여러 낱말에 있으면 기여를 나눠 갖는다.
      score += ((values.get(i) ?? 0) / norm) * (model.features[i]?.[2][String(c)] ?? 0) / (counts.get(i) ?? 1);
    }
    if (score > 0) scores.set(clean, score);
  }
  return [...scores].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([word]) => word);
}

export const FAMILY_MODEL_VERSION = (weights as unknown as FamilyModel).version;
