// CHANGELOG.md에서 한 버전의 내용만 꺼내 GitHub Release 본문으로 쓴다.
//   node scripts/release-notes.mjs 0.4.0
import { readFileSync } from 'node:fs';

const version = process.argv[2];
if (!version) {
  console.error('사용법: node scripts/release-notes.mjs <버전>');
  process.exit(2);
}
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
// "## [0.4.0] - 2026-11-05" 다음 줄부터 다음 "## [" 직전까지
const start = changelog.indexOf(`## [${version}]`);
if (start === -1) {
  console.error(`CHANGELOG.md에 ${version} 항목이 없습니다. 배포 전에 변경 내역을 적어 주세요.`);
  process.exit(1);
}
const body = changelog.slice(changelog.indexOf('\n', start) + 1);
const next = body.indexOf('\n## [');
console.log((next === -1 ? body : body.slice(0, next)).trim());
