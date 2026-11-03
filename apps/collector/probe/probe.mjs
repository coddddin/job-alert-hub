// 임시 프로브: 실제 응답 구조를 확인하려고 한 번만 돌린다. 키는 결과 파일에 남기지 않는다.
import { writeFile } from 'node:fs/promises';

const rawKey = process.env.DATA_GO_KR_KEY ?? '';
const key = rawKey.trim();
// 키 자체는 남기지 않고 형태만 기록한다 (앞뒤 공백, 인코딩 여부).
const out = { rawLength: rawKey.length, keyLength: key.length, hasPercent: key.includes('%'), hasPlusOrSlash: /[+/=]/.test(key), calls: [] };
const targets = [
  ['alio-list', 'https://apis.data.go.kr/1051000/recruitment/list', { numOfRows: '30', pageNo: '1', resultType: 'json', ongoingYn: 'Y' }],
];
for (const [name, base, params] of targets) {
  const url = new URL(base);
  url.search = new URLSearchParams({ serviceKey: key, ...params }).toString();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const text = (await res.text()).replaceAll(key, '<KEY>');
    out.calls.push({ name, status: res.status, contentType: res.headers.get('content-type'), body: text.slice(0, 200_000) });
  } catch (error) {
    out.calls.push({ name, error: String(error) });
  }
}
await writeFile(new URL('./result.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(out.calls.map(c => `${c.name}: ${c.status ?? c.error}`).join('\n'));
