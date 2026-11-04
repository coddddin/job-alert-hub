// 잡코리아 북마클릿을 한 줄짜리 javascript: 주소로 묶는다.
//   node scripts/build-bookmarklet.mjs
// 결과: dist/bookmarklet.js (웹이 설치 버튼에 넣는 모듈). 외부 스크립트를 불러오지 않도록 파서까지 전부 넣는다.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parserPackage = JSON.parse(await readFile(path.join(root, 'node_modules/kr-job-parser/package.json'), 'utf8'));

const result = await build({
  entryPoints: [path.join(root, 'bookmarklet/jobkorea.js')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  // 한글을 \uXXXX로 바꿔 두면 주소 인코딩 뒤 길이가 3분의 2로 준다.
  charset: 'ascii',
  legalComments: 'none',
  define: { __PARSER_VERSION__: JSON.stringify(parserPackage.version) },
});

const code = result.outputFiles[0].text.trim();
// 주소로 쓸 때 문제가 되는 글자만 퍼센트 인코딩한다(%, 공백·줄바꿈, #, 따옴표, 꺾쇠, 비ASCII).
// 브라우저는 javascript: 주소를 실행하기 전에 한 번 디코딩한다.
const href = `javascript:${code.replace(/[%\s#"'<>`\u0080-\uffff]/gu, char => encodeURIComponent(char))}`;
// 브라우저 북마크 주소 길이 제한(수십만 자)보다 한참 작게 유지한다.
const LIMIT = 60_000;
if (href.length > LIMIT) throw new Error(`북마클릿이 너무 큽니다: ${href.length}자 (> ${LIMIT})`);

await mkdir(path.join(root, 'dist'), { recursive: true });
await writeFile(
  path.join(root, 'dist/bookmarklet.js'),
  `// 생성 파일: scripts/build-bookmarklet.mjs\nexport const PARSER_VERSION = ${JSON.stringify(parserPackage.version)};\nexport const BOOKMARKLET = ${JSON.stringify(href)};\n`,
);
console.log(`북마클릿 ${href.length.toLocaleString()}자 (kr-job-parser ${parserPackage.version}) → dist/bookmarklet.js`);
