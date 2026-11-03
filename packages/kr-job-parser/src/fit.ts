/**
 * 판단 결과. `boolean` 대신 세 가지 값을 써서 "아니다"와 "모르겠다"를 구분한다.
 * 해석하지 못한 공고를 `false`로 처리하면 맞는 공고를 조용히 놓치기 때문이다.
 */
export type Fit = 'yes' | 'no' | 'unknown';
