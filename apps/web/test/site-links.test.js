import test from 'node:test';
import assert from 'node:assert/strict';
import { siteLinks } from '../lib/site-links.js';
import { REGIONS, ROLES } from '../lib/matching.js';

const byId = filters => Object.fromEntries(siteLinks(filters).map(link => [link.id, link]));
const base = { role: 'all', region: '서울', includeUnspecified: true, keyword: '' };

test('브라우저에서 확인한 주소 형식을 그대로 만든다', () => {
  const links = byId({ role: '프론트엔드', region: '서울', includeUnspecified: true, keyword: 'React' });
  assert.equal(links.saramin.url, 'https://www.saramin.co.kr/zf_user/search/recruit?searchword=React&exp_cd=1&exp_none=y&loc_mcd=101000&cat_mcls=2');
  assert.equal(links.jobkorea.url, 'https://www.jobkorea.co.kr/Search/?stext=React&tabType=recruit&careerType=1%2C4&local=I000&duty=1000230');
  assert.equal(links.wanted.url, 'https://www.wanted.co.kr/wdlist/518/669?country=kr&job_sort=job.latest_order&years=0&years=0&locations=seoul.all');
});

test('잡코리아 분야 전체는 대분류 코드 대신 소분류를 모두 넣는다 (대분류만 넣으면 0건)', () => {
  const duty = new URL(byId(base).jobkorea.url).searchParams.get('duty').split(',');
  assert.equal(duty.length, 18);
  assert.equal(duty[0], '1000229');
  assert.equal(duty.at(-1), '1000246');
  assert.ok(!duty.includes('10031'));
});

test('경력무관 제외는 사람인·잡코리아 경력 조건에 반영된다', () => {
  const links = byId({ ...base, includeUnspecified: false });
  assert.ok(!new URL(links.saramin.url).searchParams.has('exp_none'));
  assert.equal(new URL(links.jobkorea.url).searchParams.get('careerType'), '1');
  assert.ok(links.wanted.dropped.some(note => note.includes('경력무관')));
});

test('지역 전체면 근무지 파라미터를 넣지 않는다', () => {
  const links = byId({ ...base, region: 'all' });
  assert.ok(!new URL(links.saramin.url).searchParams.has('loc_mcd'));
  assert.ok(!new URL(links.jobkorea.url).searchParams.has('local'));
  assert.ok(!new URL(links.wanted.url).searchParams.has('locations'));
});

test('모든 지역·분야 조합이 각 사이트 주소로 바뀐다', () => {
  for (const region of REGIONS) for (const role of ROLES) {
    for (const link of siteLinks({ ...base, region, role })) {
      const url = new URL(link.url);
      assert.equal(url.protocol, 'https:');
      assert.ok(!url.href.includes('undefined'), `${link.id} ${region} ${role}: ${url.href}`);
    }
  }
});

test('사이트 분류가 더 넓으면 무엇이 넓어졌는지 알려 준다', () => {
  const links = byId({ ...base, region: '전남', role: '모바일', keyword: 'Kotlin' });
  assert.ok(links.saramin.dropped.includes('근무지 → 전남광주'));
  assert.ok(links.saramin.dropped.some(note => note.startsWith('분야(모바일)')));
  assert.deepEqual(links.jobkorea.dropped, ['근무지 → 전남광주']);
  assert.ok(links.wanted.dropped.includes('근무지 → 전라 전체'));
  assert.ok(links.wanted.dropped.includes('분야(모바일) → 개발 전체'));
  assert.ok(links.wanted.dropped.some(note => note.startsWith('검색어')));
  assert.deepEqual(byId(base).jobkorea.dropped, []);
});

test('허용하지 않은 값은 버리고 검색어는 인코딩해 주소를 조작할 수 없다', () => {
  const links = byId({ role: '../x', region: '평양', includeUnspecified: 'yes', keyword: 'a&exp_cd=2 #x' + 'z'.repeat(200) });
  const saramin = new URL(links.saramin.url);
  assert.equal(saramin.pathname, '/zf_user/search/recruit');
  assert.deepEqual(saramin.searchParams.getAll('exp_cd'), ['1']);
  assert.ok(!saramin.searchParams.has('loc_mcd'));
  assert.equal(saramin.searchParams.get('searchword').length, 100);
  assert.equal(new URL(links.wanted.url).pathname, '/wdlist/518');
  assert.equal(siteLinks(null).length, 3);
});
