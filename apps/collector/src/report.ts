import { parseDeadline, parseExperience, parseLocation, type IsoDate } from 'kr-job-parser';
import type { CollectedJob } from './job.js';

export type Field = 'experience' | 'location' | 'deadline';

export interface FieldStats {
  readonly parsed: number;
  readonly total: number;
  /** 해석하지 못한 원문과 등장 횟수. 많이 나온 순서다. 파서 규칙을 보강할 근거가 된다. */
  readonly failures: readonly { readonly raw: string; readonly count: number }[];
}

export type ParseReport = Readonly<Record<Field, FieldStats>> & { readonly jobs: number };

const FIELDS: readonly Field[] = ['experience', 'location', 'deadline'];

/** 필드 하나를 해석할 수 있었는지. 일부만 읽은 근무지(`unparsed`가 남음)도 실패로 센다. */
function isParsed(field: Field, raw: string, today: IsoDate): boolean {
  switch (field) {
    case 'experience':
      return parseExperience(raw).kind !== 'unknown';
    case 'location': {
      const location = parseLocation(raw);
      return location.unparsed.length === 0 && (location.places.length > 0 || location.nationwide || location.remote === 'full');
    }
    case 'deadline':
      return parseDeadline(raw, { today }).kind !== 'unknown';
  }
}

function fieldStats(jobs: readonly CollectedJob[], field: Field, today: IsoDate, maxFailures: number): FieldStats {
  const failures = new Map<string, number>();
  let parsed = 0;
  for (const job of jobs) {
    const raw = job.raw[field];
    if (isParsed(field, raw, today)) parsed += 1;
    else failures.set(raw, (failures.get(raw) ?? 0) + 1);
  }
  const sorted = [...failures]
    .map(([raw, count]) => ({ raw, count }))
    .sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw))
    .slice(0, maxFailures);
  return { parsed, total: jobs.length, failures: sorted };
}

export function buildReport(jobs: readonly CollectedJob[], today: IsoDate, maxFailures = 10): ParseReport {
  return {
    jobs: jobs.length,
    experience: fieldStats(jobs, 'experience', today, maxFailures),
    location: fieldStats(jobs, 'location', today, maxFailures),
    deadline: fieldStats(jobs, 'deadline', today, maxFailures),
  };
}

const LABEL: Readonly<Record<Field, string>> = { experience: '경력', location: '근무지', deadline: '마감' };

const percent = ({ parsed, total }: FieldStats): string => (total === 0 ? '-' : `${((parsed / total) * 100).toFixed(1)}%`);

/** GitHub Actions 실행 요약(`$GITHUB_STEP_SUMMARY`)에 붙이는 마크다운. */
export function toMarkdown(report: ParseReport, collectedAt: string): string {
  const lines = [
    `## kr-job-parser 해석 리포트`,
    '',
    `수집 ${collectedAt} · 공고 ${String(report.jobs)}건`,
    '',
    '| 필드 | 해석 | 성공률 |',
    '| --- | ---: | ---: |',
    ...FIELDS.map((field) => `| ${LABEL[field]} | ${String(report[field].parsed)} / ${String(report[field].total)} | ${percent(report[field])} |`),
  ];
  const failures = FIELDS.flatMap((field) => report[field].failures.map(({ raw, count }) => `| ${LABEL[field]} | \`${raw.replaceAll('|', '\\|')}\` | ${String(count)} |`));
  if (failures.length > 0) {
    lines.push('', '### 해석하지 못한 원문', '', '| 필드 | 원문 | 건수 |', '| --- | --- | ---: |', ...failures);
  }
  return `${lines.join('\n')}\n`;
}
