/**
 * 직무 분류는 모든 출처가 이 모듈 하나를 지난다(설계: docs/JOB_CLASSIFICATION_DESIGN.md).
 * 우선순위: 출처 코드 > 출처 태그 > 규칙 > 미분류. 애매하면 미분류로 두어 맞춤·알림에서 뺀다.
 */
import type { CollectedJob, JobClassification } from '../job.js';

export type Classified = Pick<CollectedJob, 'kind' | 'role'> & { readonly classification: JobClassification };

/** 분류 근거가 없을 때. 화면은 전체 탭에만 보이고 맞춤·알림에서 뺀다. */
export const UNCLASSIFIED: Classified = Object.freeze({
  kind: 'other',
  role: '',
  classification: Object.freeze({ method: 'none', version: 'none', evidence: Object.freeze([]) }),
});

/**
 * ALIO NCS 대분류. 정보통신이 하나라도 있으면 개발 직무(전산·IT)다.
 * 그 밖에는 첫 대분류를 역할로 둔다(기존 동작 그대로).
 */
export function classifyNcs(fields: readonly string[]): Classified {
  const isIt = fields.includes('정보통신');
  return {
    kind: isIt ? 'development' : 'other',
    role: isIt ? '전산·IT' : (fields[0] ?? '기타'),
    classification: {
      method: 'source-code',
      version: 'ncs-map/1',
      evidence: isIt ? ['NCS:정보통신'] : fields.slice(0, 1).map((field) => `NCS:${field}`),
    },
  };
}
