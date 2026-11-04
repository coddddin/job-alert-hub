// 실제로 배포될 tarball을 만들어 빈 프로젝트에 설치하고, 라이브러리 import와 CLI 실행을 확인한다.
// publint·attw는 package.json 설정을 검사하고, 이 스크립트는 "설치한 사람이 실제로 쓸 수 있는가"를 검사한다.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dir = mkdtempSync(path.join(tmpdir(), 'kr-job-parser-pack-'));
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { cwd: dir, encoding: 'utf8', timeout: 60_000, ...options });

try {
  const tarball = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', dir], { cwd: root, encoding: 'utf8' }))[0].filename;
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'smoke', private: true, type: 'module' }));
  run('npm', ['install', `./${tarball}`, '--no-audit', '--no-fund', '--ignore-scripts']);

  const exports = run('node', ['--input-type=module', '-e', "import * as m from 'kr-job-parser'; console.log(Object.keys(m).sort().join(','))"]).trim();
  if (!exports.includes('parseExperience')) throw new Error(`import 결과가 이상합니다: ${exports}`);

  const output = run('npx', ['--no', 'kr-job-parser', 'exp', '경력 3년↑'], { stdio: ['ignore', 'pipe', 'pipe'] });
  if (output !== '✓ 경력 3년↑ → 경력 3년 이상\n') throw new Error(`CLI 출력이 이상합니다: ${output}`);

  console.log(`✓ ${tarball}: import ${exports.split(',').length}개, CLI 실행 확인`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
