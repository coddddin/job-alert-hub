/**
 * 지금 고른 필터(분야·근무지·경력무관 포함·검색어)를 다른 채용 사이트의 검색 주소로 옮긴다.
 *
 * 이 사이트는 다른 사이트의 공고를 가져오지 않는다. 사용자가 링크를 눌러 그 사이트로 이동할 뿐이고,
 * 주소에는 각 사이트 화면에서 필터를 직접 바꿔 보며 확인한 파라미터만 쓴다(2026-11 기준).
 * 사이트마다 분류가 달라 그대로 옮겨지지 않는 조건은 `dropped`에 남겨 화면에서 알려 준다.
 */
import { ROLES, REGIONS } from './matching.js';

/** 사람인 loc_mcd. 광주·전남은 사람인에서 '전남광주' 하나로 묶여 있다. */
const SARAMIN_REGION = Object.freeze({
  서울: '101000', 경기: '102000', 대구: '104000', 대전: '105000', 부산: '106000', 울산: '107000',
  인천: '108000', 강원: '109000', 경남: '110000', 경북: '111000', 광주: '112000', 전남: '112000',
  전북: '113000', 충북: '114000', 충남: '115000', 제주: '116000', 세종: '118000',
});

/** 잡코리아 local. 광주·전남은 잡코리아에서도 '전남광주' 하나다. 북마클릿이 주소에서 조건을 되읽을 때도 쓴다. */
export const JOBKOREA_REGION = Object.freeze({
  서울: 'I000', 경기: 'B000', 인천: 'K000', 부산: 'H000', 대구: 'F000', 광주: 'L000', 전남: 'L000',
  대전: 'G000', 울산: 'J000', 세종: '1000', 강원: 'A000', 경남: 'C000', 경북: 'D000', 전북: 'M000',
  충남: 'O000', 충북: 'P000', 제주: 'N000',
});

/** 원티드 locations. 충청·전라·경상은 남북이 합쳐져 있어 조금 넓게 걸린다. */
const WANTED_REGION = Object.freeze({
  서울: 'seoul', 부산: 'busan', 대구: 'daegu', 인천: 'incheon', 광주: 'gwangju', 대전: 'daejeon',
  울산: 'ulsan', 세종: 'sejong', 경기: 'gyeonggi', 강원: 'gangwon', 충북: 'chungcheong', 충남: 'chungcheong',
  전북: 'jeolla', 전남: 'jeolla', 경북: 'gyeongsang', 경남: 'gyeongsang', 제주: 'jeju',
});

/**
 * 잡코리아 'AI·개발·데이터' 소분류 전체.
 * 대분류 코드(10031)를 duty에 넣으면 결과가 0건이 되므로 소분류를 모두 나열한다.
 */
const JOBKOREA_DEV = Array.from({ length: 18 }, (_, i) => String(1000229 + i));
/** 잡코리아 duty 소분류. 여러 개를 쉼표로 넣을 수 있다. */
const JOBKOREA_ROLE = Object.freeze({
  프론트엔드: ['1000230'], 백엔드: ['1000229'], 풀스택: ['1000229', '1000230', '1000231'],
  모바일: ['1000232'], 게임: ['1000240'], '데이터·AI': ['1000236', '1000237', '1000242'],
  임베디드: ['1000239', '1000241'], '전산·IT': ['1000233', '1000234', '1000244'],
});

const WANTED_DEV = '518'; // 개발 전체
/** 원티드 직무는 주소 경로에 하나만 들어간다. 딱 맞는 하나가 없으면 개발 전체로 둔다. */
const WANTED_ROLE = Object.freeze({
  프론트엔드: '669', 백엔드: '872', 풀스택: '873', 임베디드: '658', '전산·IT': '665',
});

const SARAMIN_DEV = '2'; // IT개발·데이터 (사람인은 이 단계까지만 옮긴다)

export const SITES = Object.freeze([
  { id: 'saramin', name: '사람인' },
  { id: 'jobkorea', name: '잡코리아' },
  { id: 'wanted', name: '원티드' },
]);

const MAX_KEYWORD = 100;

/** 저장된 상태가 망가져도 허용한 값만 주소에 들어가게 한 번 더 거른다. */
function normalize(filters) {
  const role = ROLES.includes(filters?.role) ? filters.role : 'all';
  const region = REGIONS.includes(filters?.region) ? filters.region : 'all';
  const includeUnspecified = filters?.includeUnspecified !== false;
  const keyword = typeof filters?.keyword === 'string' ? filters.keyword.trim().replace(/\s+/g, ' ').slice(0, MAX_KEYWORD) : '';
  return { role, region, includeUnspecified, keyword };
}

function saramin({ role, region, includeUnspecified, keyword }) {
  const url = new URL('https://www.saramin.co.kr/zf_user/search/recruit');
  if (keyword) url.searchParams.set('searchword', keyword);
  url.searchParams.set('exp_cd', '1');
  if (includeUnspecified) url.searchParams.set('exp_none', 'y');
  if (region !== 'all') url.searchParams.set('loc_mcd', SARAMIN_REGION[region]);
  url.searchParams.set('cat_mcls', SARAMIN_DEV);
  const dropped = [];
  if (role !== 'all') dropped.push(`분야(${role}) → IT개발·데이터 전체`);
  if (region === '광주' || region === '전남') dropped.push('근무지 → 전남광주');
  return { url: url.href, dropped };
}

function jobkorea({ role, region, includeUnspecified, keyword }) {
  const url = new URL('https://www.jobkorea.co.kr/Search/');
  if (keyword) url.searchParams.set('stext', keyword);
  url.searchParams.set('tabType', 'recruit');
  url.searchParams.set('careerType', includeUnspecified ? '1,4' : '1');
  if (region !== 'all') url.searchParams.set('local', JOBKOREA_REGION[region]);
  url.searchParams.set('duty', (role === 'all' ? JOBKOREA_DEV : JOBKOREA_ROLE[role]).join(','));
  const dropped = [];
  if (region === '광주' || region === '전남') dropped.push('근무지 → 전남광주');
  return { url: url.href, dropped };
}

function wanted({ role, region, includeUnspecified, keyword }) {
  const sub = role === 'all' ? undefined : WANTED_ROLE[role];
  const url = new URL(`https://www.wanted.co.kr/wdlist/${WANTED_DEV}${sub ? '/' + sub : ''}`);
  url.searchParams.set('country', 'kr');
  url.searchParams.set('job_sort', 'job.latest_order');
  // 원티드의 '신입'은 연차 범위 0~0이라 같은 키를 두 번 쓴다.
  url.searchParams.append('years', '0');
  url.searchParams.append('years', '0');
  if (region !== 'all') url.searchParams.set('locations', `${WANTED_REGION[region]}.all`);
  const dropped = [];
  if (role !== 'all' && !sub) dropped.push(`분야(${role}) → 개발 전체`);
  if (['충북', '충남', '전북', '전남', '경북', '경남'].includes(region)) dropped.push(`근무지 → ${{ chungcheong: '충청', jeolla: '전라', gyeongsang: '경상' }[WANTED_REGION[region]]} 전체`);
  if (!includeUnspecified) dropped.push('경력무관 제외 → 원티드에 해당 옵션 없음');
  if (keyword) dropped.push('검색어 → 원티드 목록 주소에 넣을 수 없음');
  return { url: url.href, dropped };
}

const BUILDERS = Object.freeze({ saramin, jobkorea, wanted });

/** @returns {{ id: string, name: string, url: string, dropped: string[] }[]} */
export function siteLinks(filters) {
  const clean = normalize(filters);
  return SITES.map(site => ({ ...site, ...BUILDERS[site.id](clean) }));
}
