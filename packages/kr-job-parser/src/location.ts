import type { Fit } from './fit.js';

/** 시·도 17곳의 짧은 이름. 채용 사이트의 지역 필터에서 흔히 쓰는 표기다. */
export const SIDO = [
  '서울',
  '부산',
  '대구',
  '인천',
  '광주',
  '대전',
  '울산',
  '세종',
  '경기',
  '강원',
  '충북',
  '충남',
  '전북',
  '전남',
  '경북',
  '경남',
  '제주',
] as const;

export type Sido = (typeof SIDO)[number];

/**
 * 공식 명칭과 줄임말을 짧은 이름으로 바꾸는 표.
 * `광주시`는 경기도 광주시와 헷갈리므로 광주광역시의 별칭으로 넣지 않는다.
 */
const ALIASES: Readonly<Record<Sido, readonly string[]>> = {
  서울: ['서울특별시', '서울시', '서울'],
  부산: ['부산광역시', '부산시', '부산'],
  대구: ['대구광역시', '대구시', '대구'],
  인천: ['인천광역시', '인천시', '인천'],
  광주: ['광주광역시', '광주'],
  대전: ['대전광역시', '대전시', '대전'],
  울산: ['울산광역시', '울산시', '울산'],
  세종: ['세종특별자치시', '세종시', '세종'],
  경기: ['경기도', '경기'],
  강원: ['강원특별자치도', '강원도', '강원'],
  충북: ['충청북도', '충북'],
  충남: ['충청남도', '충남'],
  전북: ['전북특별자치도', '전라북도', '전북'],
  전남: ['전라남도', '전남'],
  경북: ['경상북도', '경북'],
  경남: ['경상남도', '경남'],
  제주: ['제주특별자치도', '제주도', '제주'],
};

/**
 * 2026년 7월 1일 광주광역시와 전라남도가 전남광주통합특별시로 합쳐졌다.
 * 공고와 사용자 필터에는 여전히 `광주`·`전남`이 쓰이므로 시·도 목록은 그대로 두고,
 * 통합 명칭은 두 지역을 모두 가리키는 것으로 해석한다.
 */
const MERGED_ALIASES = ['전남광주통합특별시', '전남광주특별시', '전남광주'] as const;
const MERGED: readonly Sido[] = ['광주', '전남'];

/** 옛 광주광역시의 자치구. 통합 명칭 뒤에 오면 광주로, 그 밖의 시·군은 전남으로 본다. */
const GWANGJU_GU = new Set(['동구', '서구', '남구', '북구', '광산구']);

/** 긴 별칭부터 비교해야 `서울특별시`가 `서울`보다, `전남광주`가 `전남`보다 먼저 잡힌다. */
const ALIAS_LIST: readonly (readonly [alias: string, sidos: readonly Sido[]])[] = [
  ...SIDO.flatMap((sido) => ALIASES[sido].map((alias) => [alias, [sido]] as const)),
  ...MERGED_ALIASES.map((alias) => [alias, MERGED] as const),
].sort(([a], [b]) => b.length - a.length);

/** 근무지 하나. `sigungu`는 `강남구`, `성남시 분당구`처럼 원문 표기를 유지한다. */
export interface Place {
  readonly sido: Sido;
  readonly sigungu?: string;
}

/** 재택 여부. `partial`은 재택 병행·하이브리드다. */
export type Remote = 'none' | 'partial' | 'full';

export interface WorkLocation {
  /** 인식한 근무지. 중복은 제거한다. */
  readonly places: readonly Place[];
  /** `전국` 표기가 있었는지. */
  readonly nationwide: boolean;
  readonly remote: Remote;
  /** `외 2곳`·`외 1`처럼 목록에 없는 근무지 수. `외 다수`처럼 수를 알 수 없으면 `'unknown'`. */
  readonly others: number | 'unknown';
  /** 근무지로 인식하지 못한 조각. 규칙을 보강할 근거로 남긴다. */
  readonly unparsed: readonly string[];
}

// 단위가 없는 `외 1`(잡코리아 목록 표기)도 받는다. 단위 없이 숫자 뒤에 다른 글자가 붙은 `외 1명` 같은 경우는 제외한다.
const OTHERS_COUNT = /외\s*(\d+)(?:\s*(?:곳|개\s*지역|개소|개|지역)|(?=\s*(?:$|[,·/|)\]])))/u;
const OTHERS_MANY = /외\s*(?:다수|여러\s*곳)/u;
const REMOTE_PARTIAL = /재택(?:\s*근무)?\s*(?:병행|가능|혼합)|부분\s*재택|하이브리드|hybrid|주\s*\d\s*회\s*재택/iu;
const REMOTE_FULL = /재택|원격\s*근무|리모트|remote/iu;
const SEPARATORS = /[,·/|、()[\]]|\s및\s|\s또는\s/u;
const SIGUNGU = /^[가-힣]+(?:시|군|구)$/u;
const WHOLE_AREA = /^(?:전\s*지역|전체|전역|일대|인근)$/u;

function readSido(token: string): { sidos: readonly Sido[]; rest: string } | null {
  for (const [alias, sidos] of ALIAS_LIST) {
    if (token.startsWith(alias)) return { sidos, rest: token.slice(alias.length) };
  }
  return null;
}

function readPlaces(segment: string): readonly Place[] | null {
  const [first = '', ...tokens] = segment.split(/\s+/u);
  const head = readSido(first);
  if (!head) return null;

  // "서울강남구"처럼 붙여 쓴 경우 시·도 뒤에 남은 부분을 다음 토큰으로 본다.
  if (head.rest) tokens.unshift(head.rest);

  const parts: string[] = [];
  for (const token of tokens) {
    if (!SIGUNGU.test(token)) break;
    parts.push(token);
  }

  // 시·도 이름 뒤에 붙은 나머지가 시·군·구도, "전지역" 같은 표현도 아니면 지역명으로 보지 않는다.
  // 단독 "광주시"(경기 광주시와 광주광역시 중 어느 쪽인지 모름)가 여기서 걸러진다.
  if (head.rest && parts.length === 0 && !WHOLE_AREA.test(head.rest)) return null;

  const [sido, ...more] = head.sidos;
  if (sido === undefined) return null;
  if (parts.length === 0) return head.sidos.map((value) => ({ sido: value }));

  const sigungu = parts.join(' ');
  if (more.length === 0) return [{ sido, sigungu }];
  // 통합 명칭 + 시·군·구: 옛 행정구역을 시·군·구 이름으로 되짚는다.
  return [{ sido: GWANGJU_GU.has(parts[0] ?? '') ? '광주' : '전남', sigungu }];
}

function samePlace(a: Place, b: Place): boolean {
  return a.sido === b.sido && a.sigungu === b.sigungu;
}

/**
 * 채용공고의 근무지 표기를 해석한다.
 *
 * @example
 * parseLocation('서울 강남구 외 2곳');
 * // { places: [{ sido: '서울', sigungu: '강남구' }], nationwide: false, remote: 'none', others: 2, unparsed: [] }
 *
 * parseLocation('경기 성남시 분당구 (재택 병행)');
 * // { places: [{ sido: '경기', sigungu: '성남시 분당구' }], remote: 'partial', ... }
 */
export function parseLocation(raw: string): WorkLocation {
  let text = raw.normalize('NFKC').replace(/\s+/gu, ' ').trim();

  const remote: Remote = REMOTE_PARTIAL.test(text) ? 'partial' : REMOTE_FULL.test(text) ? 'full' : 'none';
  const nationwide = text.includes('전국');

  let others: number | 'unknown' = 0;
  const count = OTHERS_COUNT.exec(text);
  if (count?.[1] !== undefined) {
    others = Number(count[1]);
    text = text.replace(OTHERS_COUNT, ' ');
  } else if (OTHERS_MANY.test(text)) {
    others = 'unknown';
    text = text.replace(OTHERS_MANY, ' ');
  }

  text = text
    .replace(REMOTE_PARTIAL, ' ')
    .replace(new RegExp(REMOTE_FULL.source, 'giu'), ' ')
    .replaceAll('전국', ' ');

  const places: Place[] = [];
  const unparsed: string[] = [];
  for (const segment of text.split(SEPARATORS)) {
    const trimmed = segment.trim();
    if (!trimmed || WHOLE_AREA.test(trimmed) || /^(?:근무|근무지|가능|병행)$/u.test(trimmed)) continue;
    const found = readPlaces(trimmed);
    if (!found) {
      unparsed.push(trimmed);
      continue;
    }
    for (const place of found) {
      if (!places.some((existing) => samePlace(existing, place))) places.push(place);
    }
  }

  return { places, nationwide, remote, others, unparsed };
}

/**
 * 해당 시·도에서 일할 수 있는 공고인지 판단한다.
 *
 * - `전국`이거나 완전 재택이면 어느 지역이든 `yes`다.
 * - 목록에 없고 `외 N곳`처럼 숨은 근무지가 있으면 `unknown`이다.
 * - 근무지를 하나도 인식하지 못했으면 `unknown`이다.
 */
export function matchesRegion(location: WorkLocation, sido: Sido): Fit {
  if (location.nationwide || location.remote === 'full') return 'yes';
  if (location.places.some((place) => place.sido === sido)) return 'yes';
  if (location.others !== 0 || location.places.length === 0) return 'unknown';
  return 'no';
}
