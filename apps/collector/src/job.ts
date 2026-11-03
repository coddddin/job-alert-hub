/**
 * 수집처와 상관없이 웹 화면이 읽는 공고 한 건.
 *
 * 경력·근무지·마감은 해석하지 않은 원문(`raw`) 그대로 둔다.
 * 해석은 화면을 그리는 시점에 kr-job-parser가 하므로, 규칙을 고치면 다시 수집하지 않아도 결과가 바뀐다.
 */
export interface CollectedJob {
  /** `수집처:원본 ID`. 수집처가 달라도 겹치지 않는다. */
  readonly id: `${string}:${string}`;
  readonly source: string;
  readonly company: string;
  readonly title: string;
  /** 원문 공고 주소. 없으면 `null`. */
  readonly url: string | null;
  readonly raw: {
    readonly experience: string;
    readonly location: string;
    readonly deadline: string;
  };
  /** 화면 필터용 분류. 정보통신 직무만 `development`다. */
  readonly kind: 'development' | 'other';
  readonly role: string;
  readonly employment: string;
  /** 직무 분류·학력처럼 검색과 상세 화면에 쓰는 짧은 꼬리표. */
  readonly tags: readonly string[];
  readonly description: string;
}

/** `apps/web`이 읽는 파일 형식. */
export interface Snapshot {
  readonly version: 1;
  /** 수집한 시각 (ISO 8601). */
  readonly collectedAt: string;
  /** 마감 계산 기준일. 수집한 날의 한국 날짜다. */
  readonly today: `${number}-${number}-${number}`;
  readonly sources: readonly { readonly name: string; readonly label: string; readonly total: number; readonly skipped: number }[];
  readonly jobs: readonly CollectedJob[];
}
