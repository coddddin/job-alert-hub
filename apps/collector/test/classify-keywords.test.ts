import { describe, expect, it } from 'vitest';
import { classifyKeywords, type JobSignals } from '../src/classify/index.js';

const signals = (jobNames: string[], skills: string[] = [], duties: string | null = null): JobSignals => ({ jobNames, skills, duties });
const pick = (title: string, s?: JobSignals) => {
  const r = classifyKeywords(title, s);
  return { kind: r.kind, role: r.role, families: r.families, method: r.classification.method, nonHiring: r.classification.nonHiring ?? false };
};

// 실제 잡코리아 표본에서 본 경계 사례를 합성 값으로 옮긴 것. 판정 순서(설계 4절)를 고정한다.
describe('keyword rules (keyword-rules/1)', () => {
  it('needs extractor signals; a title alone is never enough', () => {
    expect(pick('백엔드 개발자')).toMatchObject({ method: 'none', role: '' });
    expect(pick('백엔드 개발자', signals([]))).toMatchObject({ method: 'none', role: '' });
  });
  it('flags training programs before anything else, even with dev skills', () => {
    expect(pick('AI 무료 취업교육생과정 모집', signals(['풀스택', '백엔드'], ['Java', 'Spring'])))
      .toEqual({ kind: 'other', role: '기타', families: [], method: 'rule', nonHiring: true });
    expect(pick('투자비 없는 사업점(지사) 모집', signals(['영업사원']))).toMatchObject({ nonHiring: true });
  });
  it('needs a strong phrase without hiring counter-signals to call a posting non-hiring', () => {
    expect(pick('교육과정 개발자 채용', signals(['이러닝 콘텐츠 개발']))).toMatchObject({ nonHiring: false });
    expect(pick('교육생 관리 정규직 채용', signals(['교육운영']))).toMatchObject({ nonHiring: false });
    expect(pick('[국비최대무료/100프로채용연계] 풀스택 과정', signals(['IT학원']))).toMatchObject({ nonHiring: true });
    // 국비 교육기관이 직원을 뽑는 공고는 채용이다("국비"만으로는 정하지 않는다).
    expect(pick('[국비지원 교육센터] 교육상담원 모집합니다', signals(['국비교육', '교육상담']))).toMatchObject({ nonHiring: false });
    expect(pick('전공의(인턴) 모집', signals(['병원', '의료']))).toMatchObject({ nonHiring: false, kind: 'other' });
    expect(pick('부동산 개발 사업 담당', signals(['부동산 개발', '개발자']))).toMatchObject({ kind: 'other' });
  });
  it('marks non-development jobs when negative keywords dominate, and leaves ties unclassified', () => {
    // 비IT 직무군 사전은 후속 단계라 직무군은 비워 둔다(화면에서 분류 대기).
    expect(pick('물류 알바관리자', signals(['물류센터', '배송', '창고관리']))).toMatchObject({ kind: 'other', families: [], method: 'rule', nonHiring: false });
    expect(pick('데이터 담당', signals(['영업지원'], ['Python']))).toMatchObject({ method: 'none' });
  });
  it('does not classify postings that bundle several jobs', () => {
    expect(pick('2026 하반기 부문별 채용', signals(['백엔드 개발자', '서버개발'], ['Spring']))).toMatchObject({ method: 'none' });
    expect(pick('정기채용(개발/사업기획/PM/영업/AI 개발)', signals(['AI 개발', '개발자'], ['MLOps']))).toMatchObject({ method: 'none' });
    expect(pick('플랫폼 프로젝트 팀장(PM)급', signals(['소프트웨어개발'], ['DevOps']))).toMatchObject({ method: 'none' });
    expect(pick('IT 교육 공고', signals(['개발자'], [], '교육일정 직무별 상이, 상세요강 참고'))).toMatchObject({ method: 'none' });
  });
  it('keeps a negative keyword from counting when its exception appears, and holds back titles listing non-dev jobs', () => {
    // '디자이너'는 비개발 신호지만 'UI 개발'이 함께 있으면 세지 않는다(negativeUnless).
    expect(pick('UI 개발 디자이너', signals(['프론트엔드 개발'], ['React']))).toMatchObject({ kind: 'development', role: '프론트엔드' });
    // 제목이 개발과 기획을 나열하면 두 필드가 개발을 가리켜도 확정하지 않는다(listedNonDev).
    expect(pick('백엔드 개발/서비스 기획', signals(['백엔드 개발자'], ['Spring']))).toMatchObject({ method: 'none' });
  });
  it('assigns a single role confirmed by two fields', () => {
    expect(pick('백엔드 엔지니어(신입)', signals(['신입 백엔드 엔지니어']))).toMatchObject({ kind: 'development', role: '백엔드', families: ['it'], method: 'rule' });
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
  it('counts spacing variants of one keyword once ("회로설계" / "회로 설계")', () => {
    // 예전에는 음성 2개(회로설계·회로 설계)로 세어 펌웨어 공고가 비개발로 판정됐다. 이제 1:1 동률이라 미분류.
    const r = classifyKeywords('인버터 펌웨어 경력', signals(['회로설계', '기계조립', '펌웨어']));
    expect(r.classification.method).toBe('none');
    expect(r.classification.evidence.filter(e => e.includes('회로'))).toHaveLength(1);
  });
  it('matches English keywords on word boundaries and records evidence', () => {
    expect(pick('JavaScript 퍼블리싱', signals(['홈페이지'])).kind).toBe('other');
    const r = classifyKeywords('백엔드 개발자', signals(['서버 개발'], ['Spring']));
    expect(r.classification).toMatchObject({ method: 'rule', version: 'keyword-rules/1' });
    expect(r.classification.evidence).toEqual(expect.arrayContaining(['title:백엔드', 'skill:Spring']));
  });
});
