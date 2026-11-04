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
  /** 기관의 채용 페이지 주소. 없으면 `null`. */
  readonly url: string | null;
  /** 지원하기 버튼이 여는 공고 상세 주소(공고문·접수 안내가 있는 곳). 없으면 `null`. */
  readonly applyUrl: string | null;
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
  /** 지원 전에 확인할 조건. 수집처가 주지 않으면 `null`. */
  readonly details: JobDetails | null;
}

export interface JobDetails {
  /** 채용 인원. 모르면 `null`. */
  readonly headcount: number | null;
  /** 공고에 적힌 학력 조건들. 분야마다 다를 수 있어 목록이다. */
  readonly education: readonly string[];
  /** 그중 가장 낮은 학력. 이 이상이면 적어도 한 분야에는 지원할 수 있다. 알 수 없으면 `null`. */
  readonly minimumEducation: string | null;
  /** 지원 자격(필수 요건). 원문의 줄을 글머리표만 떼고 그대로 담는다. */
  readonly requirements: readonly string[];
  /** 우대 조건 요약. 없으면 `null`. */
  readonly preferences: string | null;
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
