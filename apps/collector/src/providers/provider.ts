import type { CollectedJob } from '../job.js';

/** 테스트에서 네트워크 없이 응답을 넣을 수 있도록 `fetch`를 주입받는다. */
export type FetchLike = (url: URL, init?: { signal?: AbortSignal }) => Promise<Response>;

export interface ProviderResult {
  readonly jobs: readonly CollectedJob[];
  /** 응답 형식이 맞지 않아 건너뛴 항목 수. 수집 전체를 멈추지 않고 세어서 보고한다. */
  readonly skipped: number;
  /** 수집처가 알려준 전체 공고 수. */
  readonly total: number;
}

/**
 * 수집처 하나. 새 수집처는 이 인터페이스만 구현하면 되고,
 * 파서·리포트·웹 화면 코드는 바꾸지 않는다.
 */
export interface Provider {
  /** ID 접두사로 쓰는 짧은 이름. */
  readonly name: string;
  /** 화면에 보여 줄 출처 이름. */
  readonly label: string;
  collect(fetch: FetchLike): Promise<ProviderResult>;
}

/** 수집처가 오류를 돌려줬을 때. 키 미등록처럼 다시 시도해도 소용없는 오류를 구분하려고 코드를 남긴다. */
export class ProviderError extends Error {
  override readonly name = 'ProviderError';

  constructor(
    readonly provider: string,
    readonly code: string,
    message: string,
  ) {
    super(`[${provider}] ${code}: ${message}`);
  }
}
