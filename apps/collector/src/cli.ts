#!/usr/bin/env node
/**
 * 공고를 수집해 웹이 읽는 스냅샷과 해석 리포트를 쓴다.
 *
 *   DATA_GO_KR_KEY=... node dist/cli.js [--out <dir>]
 *
 * 결과: <dir>/snapshot.json, <dir>/report.json
 * GitHub Actions에서는 해석 리포트를 실행 요약에도 붙인다.
 */
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { collect } from './collect.js';
import { alio } from './providers/alio.js';
import { ProviderError } from './providers/provider.js';
import { buildReport, toMarkdown } from './report.js';

const { values } = parseArgs({
  options: { out: { type: 'string', default: path.resolve(import.meta.dirname, '../../web/data/live') } },
});
const out = values.out;

try {
  const snapshot = await collect([alio(process.env['DATA_GO_KR_KEY'] ?? '')], fetch, new Date());
  const report = buildReport(snapshot.jobs, snapshot.today);

  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, 'snapshot.json'), `${JSON.stringify(snapshot)}\n`);
  await writeFile(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

  const markdown = toMarkdown(report, snapshot.collectedAt);
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  if (summary) await appendFile(summary, markdown);
  console.log(markdown);
} catch (error) {
  // 오류 메시지에는 수집처 코드만 담는다. 요청 URL에는 인증키가 있어 출력하지 않는다.
  console.error(error instanceof ProviderError ? error.message : error);
  process.exitCode = 1;
}
