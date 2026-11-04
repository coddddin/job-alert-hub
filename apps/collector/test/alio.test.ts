import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alio, isAlioItem, toJob, type AlioItem } from '../src/providers/alio.js';
import { ProviderError, type FetchLike } from '../src/providers/provider.js';

/** 2026-11-03 실제 응답의 앞 5건. 긴 본문 필드는 잘라 두었다. */
const fixture: unknown = JSON.parse(readFileSync(new URL('./fixtures/alio-page.json', import.meta.url), 'utf8'));

const item: AlioItem = {
  recrutPblntSn: 1,
  instNm: '한국테스트공사',
  recrutPbancTtl: '2026년 전산직 채용',
  srcUrl: 'https://example.com/recruit',
  recrutSeNm: '신입+경력',
  workRgnNmLst: '서울,전남광주',
  pbancEndYmd: '20261117',
  ncsCdNmLst: '경영.회계.사무,정보통신',
  hireTypeNmLst: '정규직',
  acbgCondNmLst: '학력무관',
  recrutNope: 3,
  replmprYn: 'N',
};

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** 요청한 URL을 기록하고 페이지 번호별로 응답을 돌려주는 가짜 fetch. */
function fakeFetch(respond: (page: number) => Response): FetchLike & { readonly urls: URL[] } {
  const urls: URL[] = [];
  const fn = (url: URL): Promise<Response> => {
    urls.push(url);
    return Promise.resolve(respond(Number(url.searchParams.get('pageNo'))));
  };
  return Object.assign(fn, { urls });
}

const page = (items: readonly unknown[], totalCount: number): unknown => ({ resultCode: 200, resultMsg: '성공했습니다.', totalCount, result: items });

describe('isAlioItem', () => {
  it('실제 응답 항목을 받아들인다', () => {
    const { result } = fixture as { result: unknown[] };
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(isAlioItem)).toBe(true);
  });

  it.each([
    ['객체가 아님', null],
    ['배열', [item]],
    ['ID가 문자열', { ...item, recrutPblntSn: '1' }],
    ['필수 문자열 누락', { ...item, workRgnNmLst: undefined }],
    ['srcUrl이 숫자', { ...item, srcUrl: 3 }],
  ])('형식이 다르면 거른다: %s', (_, value) => {
    expect(isAlioItem(value)).toBe(false);
  });

  it('srcUrl은 null일 수 있다', () => {
    expect(isAlioItem({ ...item, srcUrl: null })).toBe(true);
  });
});

describe('toJob', () => {
  it('원문 표기는 해석하지 않고 그대로 넘긴다', () => {
    expect(toJob(item)).toEqual({
      id: 'alio:1',
      source: '잡알리오',
      company: '한국테스트공사',
      title: '2026년 전산직 채용',
      url: 'https://example.com/recruit',
      raw: { experience: '신입+경력', location: '서울,전남광주', deadline: '20261117' },
      kind: 'development',
      role: '전산·IT',
      employment: '정규직',
      tags: ['경영.회계.사무', '정보통신'],
      description: '채용 3명 · 학력 학력무관',
    });
  });

  it('정보통신이 아닌 직무는 첫 분류를 역할로 쓴다', () => {
    const job = toJob({ ...item, ncsCdNmLst: '건설,기계' });
    expect(job.kind).toBe('other');
    expect(job.role).toBe('건설');
  });

  it('빈 값과 대체인력을 표시한다', () => {
    const job = toJob({ ...item, srcUrl: '  ', ncsCdNmLst: '', hireTypeNmLst: '', acbgCondNmLst: '', replmprYn: 'Y' });
    expect(job.url).toBeNull();
    expect(job.employment).toBe('미기재');
    expect(job.role).toBe('기타');
    expect(job.description).toBe('채용 3명 · 학력 미기재 · 대체인력');
  });
});

describe('alio().collect', () => {
  it('전체 수만큼 페이지를 나눠 요청하고 키는 앞뒤 공백을 자른다', async () => {
    const fetch = fakeFetch((n) => json(page([{ ...item, recrutPblntSn: n }], 250)));
    const result = await alio(' key\n').collect(fetch);

    expect(fetch.urls.map((url) => url.searchParams.get('pageNo'))).toEqual(['1', '2', '3']);
    expect(fetch.urls.every((url) => url.searchParams.get('serviceKey') === 'key')).toBe(true);
    expect(fetch.urls[0]?.searchParams.get('ongoingYn')).toBe('Y');
    expect(result.total).toBe(250);
    expect(result.jobs.map((job) => job.id)).toEqual(['alio:1', 'alio:2', 'alio:3']);
  });

  it('형식이 틀린 항목은 건너뛰고 수를 센다', async () => {
    const fetch = fakeFetch(() => json(page([item, { broken: true }, item], 3)));
    const result = await alio('key').collect(fetch);
    expect(result.jobs).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });

  it('실제 응답 fixture를 처리한다', async () => {
    const result = await alio('key').collect(fakeFetch(() => json(fixture)));
    expect(result.skipped).toBe(0);
    expect(result.jobs[0]?.raw).toEqual({ experience: '신입+경력', location: '강원', deadline: '20261117' });
  });

  it('페이지 수에 상한을 둔다', async () => {
    const fetch = fakeFetch(() => json(page([], 1_000_000)));
    await alio('key').collect(fetch);
    expect(fetch.urls).toHaveLength(20);
  });

  it('키가 비어 있으면 요청하지 않는다', async () => {
    const fetch = fakeFetch(() => json(page([], 0)));
    await expect(alio(' ').collect(fetch)).rejects.toMatchObject({ code: 'MISSING_KEY' });
    expect(fetch.urls).toHaveLength(0);
  });

  it('키 오류 봉투를 코드로 바꾼다', async () => {
    const body = { OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', returnAuthMsg: '등록되지 않은 서비스키', returnReasonCode: '30' } } };
    const error = await alio('key').collect(fakeFetch(() => json(body, 403))).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR' });
    expect(String(error)).not.toContain('key=');
  });

  it.each([
    ['헤더 없는 봉투', { OpenAPI_ServiceResponse: {} }, 'UNKNOWN_ERROR'],
    ['실패 코드', { resultCode: 500, resultMsg: '서버 오류' }, '500'],
    ['실패 코드 메시지 없음', { resultCode: 400 }, '400'],
    ['result 누락', { resultCode: 200, totalCount: 1 }, 'INVALID_RESPONSE'],
    ['배열 응답', [], 'INVALID_RESPONSE'],
  ])('%s → %s', async (_, body, code) => {
    await expect(alio('key').collect(fakeFetch(() => json(body)))).rejects.toMatchObject({ code });
  });

  it('JSON이 아닌 응답은 HTTP 상태로 알린다', async () => {
    const fetch = fakeFetch(() => new Response('<html>Bad Gateway</html>', { status: 502 }));
    await expect(alio('key').collect(fetch)).rejects.toMatchObject({ code: 'HTTP_502' });
  });
});
