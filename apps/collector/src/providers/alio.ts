import type { CollectedJob } from '../job.js';
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

/** 외부 응답은 타입을 믿을 수 없으므로 런타임에 확인한다. `as`로 단언하지 않는다. */
export function isAlioItem(value: unknown): value is AlioItem {
  if (!isObject(value)) return false;
  if (typeof value['recrutPblntSn'] !== 'number' || typeof value['recrutNope'] !== 'number') return false;
  if (value['srcUrl'] !== null && typeof value['srcUrl'] !== 'string') return false;
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
    raw: { experience: item.recrutSeNm, location: item.workRgnNmLst, deadline: item.pbancEndYmd },
    kind: isIt ? 'development' : 'other',
    role: isIt ? '전산·IT' : (fields[0] ?? '기타'),
    employment,
    tags: fields,
    description: `채용 ${String(item.recrutNope)}명 · 학력 ${education}${replacement}`,
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
