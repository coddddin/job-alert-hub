import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const url = 'http://127.0.0.1:3001';
const snapshot = path.join(root, '.scrapling-local/preview/snapshot.json');
async function ready() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(500) });
    if (response.headers.get('x-job-alert-preview') !== '1') throw new Error('3001 포트를 다른 프로그램이 사용 중입니다.');
    return true;
  } catch (error) {
    if (error.message.includes('3001')) throw error;
    return false;
  }
}
try {
  await access(snapshot);
  if (!await ready()) {
    const server = spawn(process.execPath, [path.join(root, 'tools/public-jobs/preview.mjs'), '--snapshot', snapshot], {
      cwd: root, detached: true, stdio: 'ignore', windowsHide: true,
    });
    server.unref();
    let started = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
      if (await ready()) { started = true; break; }
    }
    if (!started) throw new Error('미리보기 서버를 시작하지 못했습니다. 빌드 결과와 스냅샷을 확인하세요.');
  }
  const browser = spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' });
  browser.on('error', () => console.log(`브라우저 주소창에 ${url} 를 입력하세요.`));
  console.log(`미리보기를 열었습니다: ${url}`);
} catch (error) {
  console.error(error.code === 'ENOENT' ? '검증 데이터가 없습니다. 먼저 공개 공고를 수집하고 미리보기 스냅샷을 만들어주세요.' : error.message);
  process.exitCode = 1;
}
