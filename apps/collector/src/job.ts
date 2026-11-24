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
  /** 직무군 ID(`classify/taxonomy.ts`). 여러 개일 수 있고, 미분류면 빈 목록. 없으면 예전 스냅샷이다. */
  readonly families?: readonly string[];
  /** `kind`·`role`·`families`를 어떻게 정했는지. 없으면 예전 스냅샷이다. */
  readonly classification?: JobClassification;
}

/** 직무 분류 방법과 근거. 출처 코드 > 출처 태그 > 규칙 > 모델 추정 > 미분류 순으로 믿는다. */
export interface JobClassification {
  readonly method: 'source-code' | 'source-tag' | 'rule' | 'model' | 'none';
  /** 모델 추정의 확률(0~1). 다른 방법에는 없다. */
  readonly confidence?: number;
  /** 매핑표·규칙 버전. 예: `ncs-map/1` */
  readonly version: string;
  /** 판단에 쓴 코드·태그·키워드. 예: `NCS:정보통신` */
  readonly evidence: readonly string[];
  /** 확정하지 못했지만 근거가 있는 직무군 후보. 맞춤·알림에 "확인 필요"로 넣어 놓치지 않게 한다. */
  readonly candidates?: readonly string[];
  /** 교육생 모집·광고처럼 채용이 아닌 공고. */
  readonly nonHiring?: boolean;
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
