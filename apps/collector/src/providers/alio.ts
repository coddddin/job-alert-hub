import type { CollectedJob, JobDetails } from '../job.js';
import { ProviderError, type FetchLike, type Provider, type ProviderResult } from './provider.js';

/**
 * 공공데이터포털 `재정경제부_공공기관 채용정보 조회서비스` (data.go.kr/data/15125273).
 * 잡알리오(ALIO)에 올라온 공공기관 채용공고를 돌려준다.
 */
const ENDPOINT = 'https://apis.data.go.kr/1051000/recruitment/list';
const PAGE_SIZE = 100;
/** 전체 수가 비정상적으로 커도 무한히 요청하지 않도록 막는 상한. */
const MAX_PAGES = 20;
const TIMEOUT_MS = 20_000;
/** 잡알리오 공고 상세. 공고문 첨부와 접수 방법이 모두 여기에 있다. */
const DETAIL_URL = 'https://job.alio.go.kr/recruitview.do?idx=';

/** 응답 항목 중 수집에 쓰는 필드만. 나머지 필드는 읽지 않는다. */
export interface AlioItem {
  readonly recrutPblntSn: number;
  readonly instNm: string;
  readonly recrutPbancTtl: string;
  readonly srcUrl: string | null;
  /** `신입`, `경력`, `신입+경력` */
  readonly recrutSeNm: string;
  /** 쉼표로 이은 시·도. 2026년 7월부터 `전남광주`가 나온다. */
  readonly workRgnNmLst: string;
  /** `YYYYMMDD` */
  readonly pbancEndYmd: string;
  /** NCS 직무 분류. 쉼표로 잇는다. */
  readonly ncsCdNmLst: string;
  readonly hireTypeNmLst: string;
  readonly acbgCondNmLst: string;
  readonly recrutNope: number;
  /** 대체인력 채용 여부 */
  readonly replmprYn: string;
  /** 지원 자격. 줄바꿈(`\r\n`)과 글머리표가 섞인 자유 형식. */
  readonly aplyQlfcCn?: string | null;
  /** 우대 조건 요약. 없으면 `해당사항 없음`. */
  readonly prefCondCn?: string | null;
}

interface AlioPage {
  readonly resultCode: number;
  readonly resultMsg: string;
  readonly totalCount: number;
  readonly result: readonly unknown[];
}

type Json = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

const STRING_FIELDS = ['instNm', 'recrutPbancTtl', 'recrutSeNm', 'workRgnNmLst', 'pbancEndYmd', 'ncsCdNmLst', 'hireTypeNmLst', 'acbgCondNmLst', 'replmprYn'] as const;

const OPTIONAL_STRING_FIELDS = ['aplyQlfcCn', 'prefCondCn'] as const;

/** 외부 응답은 타입을 믿을 수 없으므로 런타임에 확인한다. `as`로 단언하지 않는다. */
export function isAlioItem(value: unknown): value is AlioItem {
  if (!isObject(value)) return false;
  if (typeof value['recrutPblntSn'] !== 'number' || typeof value['recrutNope'] !== 'number') return false;
  if (value['srcUrl'] !== null && typeof value['srcUrl'] !== 'string') return false;
  // 자격·우대 요건은 없을 수도 있지만, 있으면 문자열이어야 한다.
  if (!OPTIONAL_STRING_FIELDS.every((key) => value[key] === undefined || value[key] === null || typeof value[key] === 'string')) return false;
  return STRING_FIELDS.every((key) => typeof value[key] === 'string');
}

function readPage(body: unknown): AlioPage {
  if (!isObject(body)) throw new ProviderError('alio', 'INVALID_RESPONSE', '응답이 JSON 객체가 아닙니다');

  // 키 오류 등은 정상 응답과 다른 봉투(OpenAPI_ServiceResponse)로 온다.
  const envelope = body['OpenAPI_ServiceResponse'];
  if (isObject(envelope)) {
    const header = isObject(envelope['cmmMsgHeader']) ? envelope['cmmMsgHeader'] : {};
    const code = typeof header['errMsg'] === 'string' ? header['errMsg'] : 'UNKNOWN_ERROR';
    const message = typeof header['returnAuthMsg'] === 'string' ? header['returnAuthMsg'] : '';
    throw new ProviderError('alio', code, message);
  }

  const { resultCode, resultMsg, totalCount, result } = body;
  if (resultCode !== 200) {
    throw new ProviderError('alio', String(resultCode), typeof resultMsg === 'string' ? resultMsg : '');
  }
  if (typeof totalCount !== 'number' || !Array.isArray(result)) {
    throw new ProviderError('alio', 'INVALID_RESPONSE', 'totalCount 또는 result가 없습니다');
  }
  return { resultCode, resultMsg: typeof resultMsg === 'string' ? resultMsg : '', totalCount, result };
}

const splitList = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

/** 낮은 순서. 목록에 없는 표기는 최소 학력 계산에서 뺀다. */
const EDUCATION_ORDER = ['학력무관', '중졸이하', '고졸', '대졸(2~3년)', '대졸(4년)', '석사', '박사'] as const;

export function minimumEducation(levels: readonly string[]): string | null {
  const ranks = levels.map((level) => EDUCATION_ORDER.findIndex((known) => known === level)).filter((rank) => rank >= 0);
  if (ranks.length === 0) return null;
  const lowest = EDUCATION_ORDER[Math.min(...ranks)];
  if (lowest === undefined) return null;
  return lowest === '학력무관' ? lowest : `${lowest} 이상`;
}

const NONE = /^(?:해당\s*사항\s*없음|없음|-)$/u;
/** 줄 앞 글머리표: □ ㅇ ○ ◦ • · ㆍ - * 와 "1." 같은 번호 */
const BULLET = /^(?:[□■ㅇ○◦•·ㆍ\-*▶]|\d+[.)])\s*/u;
const MAX_LINES = 20;
const MAX_LINE_LENGTH = 300;

/** 자유 형식 자격 요건을 줄 목록으로. 내용은 바꾸지 않고 글머리표와 빈 줄만 정리한다. */
export function splitLines(text: string | null | undefined): string[] {
  if (!text || NONE.test(text.trim())) return [];
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(BULLET, '').trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_LINES)
    .map((line) => (line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}…` : line));
}

function details(item: AlioItem): JobDetails {
  const education = splitList(item.acbgCondNmLst);
  const preferences = item.prefCondCn?.trim() ?? '';
  return {
    headcount: item.recrutNope > 0 ? item.recrutNope : null,
    education,
    minimumEducation: minimumEducation(education),
    requirements: splitLines(item.aplyQlfcCn),
    preferences: preferences === '' || NONE.test(preferences) ? null : preferences,
  };
}

/** 응답 한 건을 공통 형식으로 바꾼다. 경력·근무지·마감은 해석하지 않고 원문 그대로 넘긴다. */
export function toJob(item: AlioItem): CollectedJob {
  const fields = splitList(item.ncsCdNmLst);
  const isIt = fields.includes('정보통신');
  const employment = splitList(item.hireTypeNmLst).join(' · ') || '미기재';
  const education = splitList(item.acbgCondNmLst).join(' · ') || '미기재';
  const replacement = item.replmprYn === 'Y' ? ' · 대체인력' : '';
  const url = item.srcUrl?.trim() ?? '';

  return {
    id: `alio:${String(item.recrutPblntSn)}`,
    source: '잡알리오',
    company: item.instNm,
    title: item.recrutPbancTtl,
    url: url === '' ? null : url,
    applyUrl: `${DETAIL_URL}${String(item.recrutPblntSn)}`,
    raw: { experience: item.recrutSeNm, location: item.workRgnNmLst, deadline: item.pbancEndYmd },
    kind: isIt ? 'development' : 'other',
    role: isIt ? '전산·IT' : (fields[0] ?? '기타'),
    employment,
    tags: fields,
    // `학력무관` 하나뿐이면 `학력 학력무관`이 되지 않게 그대로 쓴다.
    details: details(item),
    description: `${item.recrutNope > 0 ? `채용 ${String(item.recrutNope)}명 · ` : ''}${education === '학력무관' ? education : `학력 ${education}`}${replacement}`,
  };
}

async function fetchPage(fetch: FetchLike, key: string, pageNo: number): Promise<AlioPage> {
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({
    serviceKey: key,
    resultType: 'json',
    ongoingYn: 'Y',
    numOfRows: String(PAGE_SIZE),
    pageNo: String(pageNo),
  }).toString();

  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ProviderError('alio', `HTTP_${String(response.status)}`, 'JSON이 아닌 응답');
  }
  return readPage(body);
}

/**
 * @param key 공공데이터포털 일반 인증키(Decoding). 앞뒤 공백·줄바꿈은 잘라낸다.
 */
export function alio(key: string): Provider {
  const serviceKey = key.trim();
  return {
    name: 'alio',
    label: '잡알리오 (공공데이터포털)',
    async collect(fetch): Promise<ProviderResult> {
      if (!serviceKey) throw new ProviderError('alio', 'MISSING_KEY', 'DATA_GO_KR_KEY가 비어 있습니다');

      const first = await fetchPage(fetch, serviceKey, 1);
      const pages = Math.min(Math.ceil(first.totalCount / PAGE_SIZE), MAX_PAGES);
      const rest = await Promise.all(Array.from({ length: Math.max(pages - 1, 0) }, (_, i) => fetchPage(fetch, serviceKey, i + 2)));

      const items = [first, ...rest].flatMap((page) => page.result);
      const valid = items.filter(isAlioItem);
      const seen = new Set<string>();
      const jobs = valid.map(toJob).filter((job) => !seen.has(job.id) && seen.add(job.id));

      return { jobs, skipped: items.length - valid.length, total: first.totalCount };
    },
  };
}
