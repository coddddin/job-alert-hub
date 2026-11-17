/**
 * 이전 배포 스냅샷에서 최근에 본 공고 원본 ID를 한 줄씩 출력한다. 수집기가 상세를 다시 요청하지 않게 한다.
 *
 *   node tools/public-jobs/seen-ids.mjs previous.json jobkorea [hours=24] > seen.txt
 * 파일이 없거나 형식이 틀리면 아무것도 출력하지 않는다(전부 새로 요청).
 */
import { readFile } from 'node:fs/promises';
const [file, source, hours = '24'] = process.argv.slice(2);
try {
  const snapshot = JSON.parse(await readFile(file, 'utf8'));
  const limit = Date.now() - Number(hours) * 3_600_000;
  for (const job of snapshot.jobs ?? []) {
    if (typeof job?.id !== 'string' || !job.id.startsWith(`${source}:`)) continue;
    if (Date.parse(job.seenAt ?? '') >= limit) console.log(job.id.slice(source.length + 1));
  }
} catch { /* 첫 실행이나 실패: 빈 목록 */ }
