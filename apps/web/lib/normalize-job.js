import { isOpen, parseDeadline, parseExperience, parseLocation } from 'kr-job-parser';

/** 파서의 경력 결과를 화면과 매칭 규칙이 쓰는 네 가지 값으로 줄인다. */
const EXPERIENCE = {
  new: 'new',
  'new-or-experienced': 'new',
  any: 'unspecified',
  experienced: 'experienced',
  unknown: 'unknown',
};

/**
 * 원문 표기(`job.raw`)를 해석해 화면과 매칭에 쓰는 공통 형식으로 바꾼다.
 * 실연동 이후 수집 단계에서도 같은 함수를 쓴다.
 *
 * @param {{ raw: { experience: string, location: string, deadline: string } }} job
 * @param {import('kr-job-parser').IsoDate} today 마감 여부와 연도 없는 날짜를 계산할 기준일
 */
export function normalizeJob(job, today) {
  const experience = parseExperience(job.raw.experience);
  const location = parseLocation(job.raw.location);
  const deadline = parseDeadline(job.raw.deadline, { today });

  return {
    ...job,
    experience: EXPERIENCE[experience.kind],
    location,
    locations: [...new Set(location.places.map(place => place.sido))],
    area: location.places.map(place => place.sigungu).filter(Boolean).join(' · ') || (location.places.length ? '' : '미제공'),
    deadline: deadline.kind === 'date' ? deadline.date : null,
    deadlineKind: deadline.kind,
    closed: isOpen(deadline, today) === 'no',
    parsed: { experience, location, deadline },
  };
}
