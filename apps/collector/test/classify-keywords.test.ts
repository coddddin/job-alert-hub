import { describe, expect, it } from 'vitest';
import { classifyKeywords, type JobSignals } from '../src/classify/index.js';

const signals = (jobNames: string[], skills: string[] = [], duties: string | null = null): JobSignals => ({ jobNames, skills, duties });
const pick = (title: string, s?: JobSignals) => {
  const r = classifyKeywords(title, s);
  return { kind: r.kind, role: r.role, method: r.classification.method, nonHiring: r.classification.nonHiring ?? false };
};

// 실제 잡코리아 표본에서 본 경계 사례를 합성 값으로 옮긴 것. 판정 순서(설계 4절)를 고정한다.
describe('keyword rules (keyword-rules/1)', () => {
  it('needs extractor signals; a title alone is never enough', () => {
    expect(pick('백엔드 개발자')).toMatchObject({ method: 'none', role: '' });
    expect(pick('백엔드 개발자', signals([]))).toMatchObject({ method: 'none', role: '' });
  });
  it('flags training programs before anything else, even with dev skills', () => {
    expect(pick('AI 무료 취업교육생과정 모집', signals(['풀스택', '백엔드'], ['Java', 'Spring'])))
      .toEqual({ kind: 'other', role: '기타', method: 'rule', nonHiring: true });
  });
  it('marks non-development jobs when negative keywords dominate, and leaves ties unclassified', () => {
    expect(pick('물류 알바관리자', signals(['물류센터', '배송', '창고관리']))).toMatchObject({ kind: 'other', method: 'rule', nonHiring: false });
    expect(pick('데이터 담당', signals(['영업지원'], ['Python']))).toMatchObject({ method: 'none' });
  });
  it('does not classify postings that bundle several jobs', () => {
    expect(pick('2026 하반기 부문별 채용', signals(['백엔드 개발자', '서버개발'], ['Spring']))).toMatchObject({ method: 'none' });
    expect(pick('정기채용(개발/사업기획/PM/영업/AI 개발)', signals(['AI 개발', '개발자'], ['MLOps']))).toMatchObject({ method: 'none' });
    expect(pick('플랫폼 프로젝트 팀장(PM)급', signals(['소프트웨어개발'], ['DevOps']))).toMatchObject({ method: 'none' });
    expect(pick('IT 교육 공고', signals(['개발자'], [], '교육일정 직무별 상이, 상세요강 참고'))).toMatchObject({ method: 'none' });
  });
  it('assigns a single role confirmed by two fields', () => {
    expect(pick('백엔드 엔지니어(신입)', signals(['신입 백엔드 엔지니어']))).toMatchObject({ kind: 'development', role: '백엔드', method: 'rule' });
    expect(pick('Android native개발자', signals(['모바일앱개발'], ['Kotlin']))).toMatchObject({ role: '모바일' });
  });
  it('uses 풀스택 only for frontend plus backend, and the title role to break other ties', () => {
    expect(pick('Web 개발자', signals(['웹개발'], ['React', 'Spring Boot']))).toMatchObject({ role: '풀스택' });
    expect(pick('프론트엔드 개발', signals(['모바일', '안드로이드'], ['React']))).toMatchObject({ role: '프론트엔드' });
    expect(pick('개발자 채용', signals(['개발자'], ['Unreal', 'Kotlin']))).toMatchObject({ method: 'none' });
  });
  it('falls back to 전산·IT for general development, including roles seen only in site keywords', () => {
    expect(pick('IT기술팀 개발자', signals(['IT기술팀 개발자']))).toMatchObject({ kind: 'development', role: '전산·IT' });
    expect(pick('PHP웹개발자 채용', signals(['PHP웹개발자', '펌웨어'], ['PHP']))).toMatchObject({ role: '전산·IT' });
  });
  it('matches English keywords on word boundaries and records evidence', () => {
    expect(pick('JavaScript 퍼블리싱', signals(['홈페이지'])).kind).toBe('other');
    const r = classifyKeywords('백엔드 개발자', signals(['서버 개발'], ['Spring']));
    expect(r.classification).toMatchObject({ method: 'rule', version: 'keyword-rules/1' });
    expect(r.classification.evidence).toEqual(expect.arrayContaining(['title:백엔드', 'skill:Spring']));
  });
});
