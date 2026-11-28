import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifySaraminTags, FAMILY_IDS } from '../src/classify/index.js';
import { FAMILY_LABELS, tagFamily } from '../src/classify/saramin-tags.js';
import { readSaraminBatch, saramin, saraminDeadline, type SaraminObservation } from '../src/providers/saramin.js';

const extracted = (value: string) => ({ value, status: 'extracted' as const, evidence: 'fixture' });
const missing = { value: null, status: 'missing' as const, evidence: null };
const item: SaraminObservation = {
  externalId: '90000001', url: 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=90000001',
  observedAt: '2026-11-17T00:00:00+00:00', extractorVersion: 'saramin-list/1', query: '백엔드', page: 1,
  fields: {
    company: extracted('(주)예시클라우드'), title: extracted('백엔드 개발자'), location: extracted('서울 강남구'),
    experience: extracted('신입·경력'), deadline: extracted('17시마감'), education: extracted('대졸↑'), employment: extracted('정규직'),
  },
  tags: ['백엔드/서버개발', 'Java'], tagsTruncated: false, warnings: [],
};
const batch = (jobs: readonly unknown[]) => ({ version: 1, source: 'saramin', jobs });
const noFetch = vi.fn(() => { throw new Error('unexpected network'); });

describe('saramin boundary', () => {
  it.each([null, {}, { ...batch([]), source: 'jobkorea' }, { ...batch([]), version: 2 }])('rejects an invalid envelope: %j', value => {
    expect(() => readSaraminBatch(value)).toThrow('Unsupported saramin batch');
  });
  it.each([
    null, { ...item, externalId: 'x' }, { ...item, url: `${item.url}&searchword=x` },
    { ...item, observedAt: '2026-02-30T00:00:00Z' }, { ...item, extractorVersion: 'jobkorea-detail/1' },
    { ...item, page: 11 }, { ...item, query: '' }, { ...item, tags: ['Java', 'Java'] }, { ...item, tags: [''] },
    { ...item, tagsTruncated: 'no' }, { ...item, fields: { ...item.fields, education: undefined } },
    { ...item, fields: { ...item.fields, title: { ...missing, evidence: 'x' } } }, { ...item, warnings: [1] },
  ])('skips malformed rows without losing valid siblings: %j', async value => {
    const result = await saramin(batch([value, { ...item, externalId: '2', url: item.url.replace('90000001', '2') }])).collect(noFetch);
    expect(result).toMatchObject({ total: 2, skipped: 1 });
    expect(result.jobs).toHaveLength(1);
  });
  it('maps a list row to a classified job with the canonical detail link and no invented details', async () => {
    const { jobs } = await saramin(batch([item])).collect(noFetch);
    expect(jobs[0]).toEqual({
      id: 'saramin:90000001', source: '사람인', company: '(주)예시클라우드', title: '백엔드 개발자',
      url: item.url, applyUrl: item.url,
      raw: { location: '서울 강남구', experience: '신입·경력', deadline: '2026-11-17 17:00 마감' },
      kind: 'development', role: '백엔드', families: ['it'],
      classification: { method: 'source-tag', version: 'saramin-tags/3', evidence: ['tag:백엔드/서버개발', 'tag:Java'] },
      employment: '정규직', tags: ['백엔드/서버개발', 'Java'], description: '',
      details: { headcount: null, education: ['대졸↑'], minimumEducation: null, requirements: [], preferences: null },
    });
    expect(noFetch).not.toHaveBeenCalled();
  });
  it('estimates with the model only what the tag dictionary leaves unclassified', async () => {
    const tutor = { ...item, externalId: '2', url: item.url.replace(/\d+$/u, '2'), fields: { ...item.fields, title: extracted('영어회화 강사 모집') }, tags: ['영어'] };
    const result = await saramin(batch([item, tutor])).collect(noFetch);
    expect(result.jobs[0]?.classification?.method).not.toBe('model');
    expect(result.jobs[1]).toMatchObject({ kind: 'other', role: '', families: ['education'], classification: { method: 'model', version: 'family-model/1' } });
  });
  it('skips missing mandatory fields and quarantines conflicting duplicates', async () => {
    const noTitle = { ...item, fields: { ...item.fields, title: missing } };
    expect(await saramin(batch([noTitle])).collect(noFetch)).toEqual({ jobs: [], skipped: 1, total: 1 });
    const other = { ...item, fields: { ...item.fields, deadline: extracted('~ 12/01(화)') } };
    expect(await saramin(batch([item, other])).collect(noFetch)).toEqual({ jobs: [], skipped: 2, total: 2 });
    const bare = { ...item, fields: { ...item.fields, location: missing, deadline: missing, education: missing, employment: missing } };
    expect((await saramin(batch([bare])).collect(noFetch)).jobs[0]).toMatchObject({ raw: { location: '', deadline: '' }, employment: '', details: null });
  });
  it('anchors hour-only deadlines to the observed Korean date', () => {
    expect(saraminDeadline('9시마감', '2026-11-17T16:00:00Z')).toBe('2026-11-18 09:00 마감');
    for (const raw of ['오늘마감', '~ 11/19(목)', '상시채용', '99시마감']) expect(saraminDeadline(raw, item.observedAt)).toBe(raw);
  });
});

describe('saramin-tags/3', () => {
  const role = (tags: string[]) => {
    const { kind, role: r, families, classification } = classifySaraminTags(tags);
    return [kind, r, classification.method, families.join('+')];
  };
  it.each([
    [['백엔드/서버개발', 'Java'], ['development', '백엔드', 'source-tag', 'it']],
    [['프론트엔드', '백엔드/서버개발'], ['development', '풀스택', 'source-tag', 'it']],
    [['앱개발', 'AI(인공지능)'], ['development', '전산·IT', 'source-tag', 'it']], // several roles: dev, generic role
    [['Java', 'Python', 'JSP'], ['development', '전산·IT', 'source-tag', 'it']],
    [['React', 'TypeScript'], ['development', '프론트엔드', 'source-tag', 'it']], // a single skill hint
    [['React', 'Spring'], ['development', '전산·IT', 'source-tag', 'it']], // conflicting hints fall back to generic
    [['임베디드', '회로설계', 'H/W'], ['development', '임베디드', 'source-tag', 'it']], // weak tags yield to dev
    [['앱개발', '웹개발', '기구설계'], ['other', '', 'none', '']], // dev and another family together
    [['게임개발', 'QA/테스터'], ['other', '', 'none', '']], // QA is not a development role
    [['생산직', '품질관리'], ['other', '생산·품질·제조', 'source-tag', 'production']],
    [['SNS마케팅', '브랜드디자인', '온라인마케팅'], ['other', '마케팅·홍보', 'source-tag', 'marketing+design']],
    [['간호조무사', '3교대', '피부과'], ['other', '의료·보건·복지', 'source-tag', 'medical']],
    [['R&D', '연구원'], ['other', '연구·엔지니어링', 'source-tag', 'research']], // weak tags count without dev tags
    [['영어', '2교대'], ['other', '', 'none', '']], // only unknown tags
    [[], ['other', '', 'none', '']],
  ])('%j → %j', (tags, expected) => {
    expect(role(tags)).toEqual(expected);
  });
  it('maps every family label exactly as the web taxonomy shows it', () => {
    const web = readFileSync(new URL('../../web/lib/taxonomy.js', import.meta.url), 'utf8');
    const pairs = [...web.matchAll(/\{ id: '(\w+)', label: '([^']+)' \}/gu)].map(([, id, label]) => [id, label]);
    expect(Object.fromEntries(pairs)).toEqual(FAMILY_LABELS);
    expect(Object.keys(FAMILY_LABELS)).toEqual([...FAMILY_IDS]);
    expect(['금융상품영업', '법률사무원', '건축기사', '물류관리', '영상편집', '바리스타강사'].map(tagFamily))
      .toEqual(['finance', 'public', 'construction', 'logistics', 'media', 'education']);
  });
  it('records the deciding tags as evidence', () => {
    expect(classifySaraminTags(['Java', '게임개발']).classification.evidence).toEqual(['tag:게임개발', 'tag:Java']);
    expect(classifySaraminTags(['웹디자인', 'HTML']).classification).toEqual({ method: 'none', version: 'saramin-tags/3', evidence: ['tag:HTML', 'tag:웹디자인'] });
  });
  it('lets a title veto only downgrade to unclassified, never assign a role', () => {
    expect(classifySaraminTags(['프론트엔드'], '[재택] 프론트엔드 교육과정 학습튜터 채용')).toEqual({
      kind: 'other', role: '', families: [], classification: { method: 'none', version: 'saramin-tags/3', evidence: ['title:튜터', 'tag:프론트엔드'] },
    });
    expect(classifySaraminTags(['생산직'], '강사 채용').role).toBe('생산·품질·제조');
    expect(classifySaraminTags(['프론트엔드'], '프론트엔드 개발자').role).toBe('프론트엔드');
  });
});
