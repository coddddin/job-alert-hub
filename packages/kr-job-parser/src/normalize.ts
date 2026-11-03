/**
 * 사이트마다 다른 표기를 비교하기 쉬운 한 가지 형태로 맞춘다.
 *
 * - 전각 문자와 호환 문자를 NFKC로 정리한다 (예: `３년` → `3년`).
 * - 공백을 모두 없앤다. 한국어 표기는 띄어쓰기가 제각각이라 의미를 바꾸지 않는다.
 * - 범위 기호(`-`, `–`, `∼` 등)를 `~` 하나로 모은다.
 * - `↑`, `+`는 `이상`으로, `↓`는 `이하`로 바꾼다.
 */
export function normalize(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/\s+/gu, '')
    .replace(/[-–—∼〜]/gu, '~')
    .replace(/[↑+]/gu, '이상')
    .replace(/↓/gu, '이하');
}
