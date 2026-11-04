import { describe, expect, it } from 'vitest';
import { collect, koreanDate } from '../src/collect.js';
import type { CollectedJob } from '../src/job.js';
import type { Provider } from '../src/providers/provider.js';
import { buildReport, toMarkdown } from '../src/report.js';

const job = (id: string, raw: CollectedJob['raw']): CollectedJob => ({
  id: `test:${id}`,
  source: '테스트',
  company: '회사',
  title: '공고',
  url: null,
  applyUrl: null,
  raw,
  kind: 'other',
  role: '기타',
  employment: '정규직',
  tags: [],
  description: '',
});

const jobs = [
  job('1', { experience: '신입+경력', location: '서울,전남광주', deadline: '20261117' }),
  job('2', { experience: '경력', location: '해외', deadline: '상시' }),
  job('3', { experience: '모름', location: '서울, 해외', deadline: '곧' }),
  job('4', { experience: '모름', location: '전국', deadline: '곧' }),
];

describe('buildReport', () => {
  const report = buildReport(jobs, '2026-11-03');

  it('필드별 해석 수를 센다', () => {
    expect(report.jobs).toBe(4);
    expect(report.experience).toMatchObject({ parsed: 2, total: 4 });
    expect(report.deadline).toMatchObject({ parsed: 2, total: 4 });
  });

  it('일부만 읽은 근무지도 실패로 센다', () => {
    expect(report.location.parsed).toBe(2);
    expect(report.location.failures).toEqual([
      { raw: '서울, 해외', count: 1 },
      { raw: '해외', count: 1 },
    ]);
  });

  it('실패 원문은 많이 나온 순서로 정리한다', () => {
    expect(report.experience.failures).toEqual([{ raw: '모름', count: 2 }]);
  });

  it('실패 목록 길이를 제한한다', () => {
    expect(buildReport(jobs, '2026-11-03', 1).location.failures).toHaveLength(1);
  });
});

describe('toMarkdown', () => {
  it('성공률 표와 실패 원문 표를 만든다', () => {
    const markdown = toMarkdown(buildReport([...jobs, job('5', { experience: '신입', location: 'A|B', deadline: '상시' })], '2026-11-03'), '2026-11-03T00:00:00.000Z');
    expect(markdown).toContain('| 경력 | 3 / 5 | 60.0% |');
    expect(markdown).toContain('`A\\|B`');
  });

  it('공고가 없으면 성공률 대신 -를 쓰고 실패 표를 생략한다', () => {
    const markdown = toMarkdown(buildReport([], '2026-11-03'), 'now');
    expect(markdown).toContain('| 경력 | 0 / 0 | - |');
    expect(markdown).not.toContain('해석하지 못한 원문');
  });
});

describe('collect', () => {
  it('수집처 결과를 한 스냅샷으로 묶는다', async () => {
    const provider = (name: string, ids: string[]): Provider => ({
      name,
      label: `${name} 라벨`,
      collect: () => Promise.resolve({ jobs: ids.map((id) => job(id, jobs[0]?.raw ?? { experience: '', location: '', deadline: '' })), skipped: 1, total: ids.length + 1 }),
    });
    const snapshot = await collect([provider('a', ['1']), provider('b', ['2', '3'])], () => Promise.reject(new Error('unused')), new Date('2026-11-03T16:00:00Z'));

    expect(snapshot.today).toBe('2026-11-04');
    expect(snapshot.sources).toEqual([
      { name: 'a', label: 'a 라벨', total: 2, skipped: 1 },
      { name: 'b', label: 'b 라벨', total: 3, skipped: 1 },
    ]);
    expect(snapshot.jobs).toHaveLength(3);
  });
});

describe('koreanDate', () => {
  it.each([
    ['2026-11-03T14:59:59Z', '2026-11-03'],
    ['2026-11-03T15:00:00Z', '2026-11-04'],
    ['2026-12-31T15:00:00Z', '2027-01-01'],
  ])('%s → %s (UTC+9)', (iso, date) => {
    expect(koreanDate(new Date(iso))).toBe(date);
  });
});
