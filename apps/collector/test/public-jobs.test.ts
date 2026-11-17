import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { collect } from '../src/collect.js';
import { alio } from '../src/providers/alio.js';
import { publicJobs, readPublicBatch, type PublicJobObservation } from '../src/providers/public-jobs.js';

const extracted = (value: string) => ({ value, status: 'extracted' as const, evidence: 'fixture' });
const missing = { value: null, status: 'missing' as const, evidence: null };
const item: PublicJobObservation = {
  externalId: '10000001', url: 'https://www.jobkorea.co.kr/Recruit/GI_Read/10000001',
  observedAt: '2026-11-14T00:00:00Z', extractorVersion: 'jobkorea-detail/1', warnings: [],
  fields: { company: extracted('예시랩'), title: extracted('백엔드 개발자'),
    location: extracted('서울 금천구'), experience: extracted('경력 (3년이상)'), deadline: extracted('2026.12.04(금)') },
};
const batch = (jobs: readonly unknown[]) => ({ version: 1, source: 'jobkorea', jobs });
const noFetch = vi.fn(() => { throw new Error('unexpected network'); });

describe('public job boundary', () => {
  it.each([null, [], {}, { ...batch([]), version: 2 }, { ...batch([]), source: 'alio' }, { ...batch([]), jobs: {} }])('rejects an invalid envelope: %j', value => {
    expect(() => readPublicBatch(value)).toThrow('Unsupported public job batch');
  });
  it.each([
    null, [], {}, { ...item, externalId: 1 }, { ...item, externalId: 'x' },
    { ...item, url: 'javascript:alert(1)' }, { ...item, url: item.url + '?tracking=1' },
    { ...item, observedAt: 'yesterday' }, { ...item, observedAt: '2026-13-99T00:00:00Z' },
    { ...item, observedAt: '2026-02-30T00:00:00Z' },
    { ...item, observedAt: 0 }, { ...item, extractorVersion: 'unknown/2' },
    { ...item, fields: null }, { ...item, fields: { ...item.fields, title: null } },
    { ...item, fields: { ...item.fields, title: { value: 'x', status: 'missing', evidence: null } } },
    { ...item, fields: { ...item.fields, title: { value: '', status: 'extracted', evidence: 'fixture' } } },
    { ...item, fields: { ...item.fields, title: { value: 'x', status: 'extracted', evidence: '' } } },
    { ...item, fields: { ...item.fields, title: { value: null, status: 'invalid', evidence: null } } },
    { ...item, fields: { ...item.fields, title: { ...missing, evidence: 'bad' } } },
    { ...item, warnings: [1] }, { ...item, warnings: '' },
  ])('skips malformed rows without losing valid siblings: %j', async value => {
    const result = await publicJobs(batch([value, item])).collect(noFetch);
    expect(result).toMatchObject({ total: 2, skipped: 1 });
    expect(result.jobs).toHaveLength(1);
  });
  it('preserves raw fields and stable identity without fetching', async () => {
    const result = await publicJobs(batch([item])).collect(noFetch);
    expect(result.jobs[0]).toMatchObject({ id: 'jobkorea:10000001', company: '예시랩', title: '백엔드 개발자',
      raw: { location: '서울 금천구', experience: '경력 (3년이상)', deadline: '2026.12.04(금)' }, details: null, kind: 'other' });
    expect(noFetch).not.toHaveBeenCalled();
  });
  it('retains unknown optional fields instead of inventing conditions', async () => {
    const fields = { ...item.fields, location: missing, experience: missing, deadline: { ...missing, status: 'conflict' } };
    const result = await publicJobs(batch([{ ...item, fields }])).collect(noFetch);
    expect(result.jobs[0]?.raw).toEqual({ location: '', experience: '', deadline: '' });
  });
  it.each(['company', 'title'])('skips missing mandatory %s', async name => {
    const result = await publicJobs(batch([{ ...item, fields: { ...item.fields, [name]: missing } }])).collect(noFetch);
    expect(result).toEqual({ jobs: [], skipped: 1, total: 1 });
  });
  it('quarantines duplicate identities including conflicting versions', async () => {
    expect(await publicJobs(batch([item, { ...item, fields: { ...item.fields, title: extracted('다른 공고') } }])).collect(noFetch))
      .toEqual({ jobs: [], skipped: 2, total: 2 });
  });
  it('handles an empty batch', async () => {
    expect(await publicJobs(batch([])).collect(noFetch)).toEqual({ jobs: [], skipped: 0, total: 0 });
  });
  it('combines with ALIO without changing its output', async () => {
    const fixture: unknown = JSON.parse(readFileSync(new URL('./fixtures/alio-page.json', import.meta.url), 'utf8'));
    const fetch = () => Promise.resolve(new Response(JSON.stringify(fixture)));
    const now = new Date('2026-11-14T00:00:00Z');
    const baseline = await collect([alio('test-key')], fetch, now);
    const combined = await collect([alio('test-key'), publicJobs(batch([item]))], fetch, now);
    expect(combined.jobs.filter(job => job.source !== 'jobkorea')).toEqual(baseline.jobs);
    expect(combined.sources[0]).toEqual(baseline.sources[0]);
    expect(combined.jobs).toHaveLength(baseline.jobs.length + 1);
    expect(combined.version).toBe(1);
  });
});
