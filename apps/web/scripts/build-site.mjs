// GitHub Pages용 정적 사이트를 만든다. 개발 서버(server.mjs)의 경로 표를 그대로 써서
// 로컬에서 보던 화면과 배포된 화면이 같은 파일로 이루어지게 한다.
//
//   node scripts/build-site.mjs [출력 폴더]   (기본: apps/web/site)
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { csp, root, routes } from '../server.mjs';

// Pages는 응답 헤더를 정할 수 없어 CSP를 meta 태그로 넣는다. frame-ancestors는 meta에서 무시되므로 뺀다.
const metaCsp = csp.split('; ').filter(rule => !rule.startsWith('frame-ancestors')).join('; ');

export async function buildSite(out) {
  await rm(out, { recursive: true, force: true });
  const written = [];
  for (const [urlPath, [file]] of routes) {
    const source = path.isAbsolute(file) ? file : path.join(root, file);
    const target = path.join(out, urlPath === '/' ? 'index.html' : urlPath);
    await mkdir(path.dirname(target), { recursive: true });
    if (urlPath === '/') {
      const html = await readFile(source, 'utf8');
      await writeFile(target, html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${metaCsp}">`));
    } else {
      try { await copyFile(source, target); } catch (error) {
        // 실데이터는 수집을 돌린 뒤에만 있다. 없으면 화면이 샘플로 동작한다.
        if (error.code === 'ENOENT' && urlPath.startsWith('/data/live/')) continue;
        throw error;
      }
    }
    written.push(urlPath);
  }
  // Pages가 _로 시작하는 경로를 무시하지 않도록 Jekyll 처리를 끈다.
  await writeFile(path.join(out, '.nojekyll'), '');
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = path.resolve(process.argv[2] ?? path.join(root, 'site'));
  const written = await buildSite(out);
  console.log(`정적 사이트 ${written.length}개 파일 → ${out}`);
}
