/**
 * 사람인 목록의 직무 태그(`job_sector`의 job-category 링크) → 화면 역할 매핑, `saramin-tags/2`.
 *
 * 사이트가 붙인 분류어라 `method: 'source-tag'`로 기록한다. 원칙(설계 2절):
 * - 사전에 있는 태그만 판단에 쓴다. 모르는 태그(R&D·연구원·회로설계·H/W 등)는 중립이다.
 * - 개발 태그와 비개발 태그가 함께 있으면 애매하므로 미분류. 알림 오탐이 누락보다 나쁘다.
 * - 개발 태그뿐인데 역할이 여럿이면 개발은 확실하므로 `전산·IT`. 프론트엔드+백엔드만 함께면 풀스택.
 * - 제목 거부어(강사·QA·기획자·디자이너 등)는 개발 판정을 미분류로 내리기만 하고, 역할을 정하지 않는다.
 * 사전을 고치면 버전을 올리고, 고치는 데 쓰지 않은 표본으로 다시 잰다.
 * v2(2026-11-17): v1 표본 오탐(게임 QA·운영 기획자·학습튜터·하드웨어)에서 QA·기획·디자인 태그와 제목 거부어 추가.
 */
import type { Classified } from './index.js';

export const SARAMIN_TAGS_VERSION = 'saramin-tags/2';

type Role = '프론트엔드' | '백엔드' | '풀스택' | '모바일' | '게임' | '데이터·AI' | '임베디드';

/** 역할을 직접 가리키는 직무 태그. */
const ROLE_TAGS: Readonly<Record<string, Role>> = {
  '프론트엔드': '프론트엔드', '퍼블리셔': '프론트엔드', '웹퍼블리셔': '프론트엔드',
  '백엔드/서버개발': '백엔드', '서버개발': '백엔드', '백엔드': '백엔드',
  '풀스택': '풀스택',
  '앱개발': '모바일', '모바일앱개발': '모바일', 'Android': '모바일', '안드로이드': '모바일', 'iOS': '모바일',
  '게임개발': '게임', '게임클라이언트': '게임', '게임서버': '게임', 'Unity': '게임', '유니티': '게임',
  'Unreal': '게임', '언리얼': '게임', 'Unreal Engine': '게임',
  '데이터엔지니어': '데이터·AI', 'AI(인공지능)': '데이터·AI', '인공지능(AI)': '데이터·AI', 'AI/ML': '데이터·AI',
  '머신러닝': '데이터·AI', '딥러닝': '데이터·AI', '빅데이터': '데이터·AI', 'AI엔지니어': '데이터·AI',
  '데이터사이언티스트': '데이터·AI', 'MLOps': '데이터·AI', 'LLM': '데이터·AI', '컴퓨터비전': '데이터·AI',
  '자연어처리': '데이터·AI', '데이터엔지니어링': '데이터·AI',
  '임베디드': '임베디드', '펌웨어': '임베디드', '임베디드SW': '임베디드', 'RTOS': '임베디드',
};

/** 역할 태그가 없을 때만 쓰는 기술 태그의 역할 힌트. 힌트가 한 역할일 때만 그 역할로 둔다. */
const SKILL_HINTS: Readonly<Record<string, Role>> = {
  'React': '프론트엔드', 'Vue.js': '프론트엔드', 'Angular': '프론트엔드',
  'Spring': '백엔드', 'SpringBoot': '백엔드', 'Spring Boot': '백엔드', 'Node.js': '백엔드', 'Django': '백엔드',
  'Swift': '모바일', 'Flutter': '모바일', 'React Native': '모바일',
};

/** 개발 직무임을 보이지만 역할은 정하지 않는 태그. 남으면 `전산·IT`. */
const DEV_TAGS: ReadonlySet<string> = new Set([
  '웹개발', 'SI개발', '소프트웨어개발', 'SW개발', 'S/W', 'SW', '응용프로그램개발', '프로그래머', '프로그래밍', '알고리즘개발',
  'SE(시스템엔지니어)', 'DBA', 'DevOps', '클라우드', '정보보안', '보안엔지니어', '시스템프로그래머', '전산', 'IT개발',
  // 기술 태그
  'Java', 'JavaScript', 'Javascript', 'TypeScript', 'Python', 'C', 'C++', 'C#', 'Go', 'Golang', 'Rust', 'Kotlin',
  'PHP', 'Ruby', 'JSP', 'HTML', 'HTML5', 'CSS', 'SQL', 'MySQL', 'Oracle', 'Linux', 'AWS', 'Docker', 'Kubernetes',
  '.NET', 'ASP.NET', 'MFC', 'Qt', 'Git', ...Object.keys(SKILL_HINTS),
]);

/** 개발이 아닌 직무를 가리키는 태그. 하나라도 있으면 개발로 확정하지 않는다. */
const NON_DEV_TAGS: ReadonlySet<string> = new Set([
  // 생산·제조·기계·공정
  '생산직', '생산관리', '제조생산', '생산설계', '기구설계', '기계설계', '부품설계', '제품설계', '금형설계', '장비설계',
  '자동화설계', '구조해석/설계', '3D설계', '기술설계', '설계엔지니어', '공정엔지니어', '공정설계', '공정관리', '설비점검',
  '설비OP', '설비보전', '반도체설계', '용접', '정비', '전기기사', '전기설계', '건축설계', '토목', '시공관리',
  // 품질·테스트(개발 직무가 아니다)
  '품질관리', '품질보증', 'QC', 'QA/테스터', 'SQA', 'QA',
  // 영업·마케팅·기획
  '영업', '국내영업', '해외영업', '기술영업', '영업관리', '거래처관리', '부동산영업', '마케팅', '마케팅기획', '광고기획',
  '상품기획', 'MD', '기획', '게임기획', '서비스기획', '웹기획', '사업개발', '사업기획', '전략기획', '점포개발', '고객상담', 'CS', '텔레마케팅',
  // 경영지원
  '인사', '인사행정', '인사교육', '총무', '회계', '경리', '재무', '사무보조', '사무', '자재구매', '구매', '재고관리', '물류',
  // 디자인
  '웹디자인', '모바일디자인', '시각디자인', '배너디자인', '그래픽디자인', '편집디자인', 'UI/UX디자인', '제품디자인',
  '광고디자인', '앱디자인', '영상디자인', '캐릭터디자인', '패키지디자인', '3D디자인', '원화', '일러스트',
  // 제약·바이오·의료·교육
  '제약/바이오', '의약·제약', '바이오', '미생물', '생명과학', '임상개발', '간호사', '보건관리자', '안전보건관리자',
  '안전관리자', '교재개발', '교육콘텐츠개발', '교육콘텐츠기획', '학원강사', 'IT강사', '직업훈련', '교육운영', '교육기획', '교육행정',
  // 기타 현장
  '부동산', '조리', '운전', '배송', '경비', '미화',
]);

/** 태그가 개발이어도 이 제목이면 개발로 확정하지 않는다(강사·튜터·교육생, QA·테스터, 기획자·디자이너, 하드웨어). */
const TITLE_VETO = /강사|튜터|교육생|수강생|국비|훈련생|테스터|QA|기획자|디자이너|하드웨어/u;

export function classifySaraminTags(tags: readonly string[], title = ''): Classified {
  const roles = new Set<Role>();
  const hints = new Set<Role>();
  const dev: string[] = [];
  const nonDev: string[] = [];
  for (const tag of tags) {
    const role = ROLE_TAGS[tag];
    if (role) { roles.add(role); dev.push(tag); continue; }
    const hint = SKILL_HINTS[tag];
    if (hint) hints.add(hint);
    if (DEV_TAGS.has(tag)) dev.push(tag);
    else if (NON_DEV_TAGS.has(tag)) nonDev.push(tag);
  }
  const evidence = (list: readonly string[], prefix: readonly string[] = []) => [...prefix, ...list.map(tag => `tag:${tag}`)].slice(0, 5);
  const none = (list: readonly string[], prefix: readonly string[] = []): Classified => ({
    kind: 'other', role: '', classification: { method: 'none', version: SARAMIN_TAGS_VERSION, evidence: evidence(list, prefix) },
  });
  if (dev.length && nonDev.length) return none([...dev, ...nonDev]);
  if (nonDev.length) {
    return { kind: 'other', role: '기타', classification: { method: 'source-tag', version: SARAMIN_TAGS_VERSION, evidence: evidence(nonDev) } };
  }
  if (!dev.length) return none([]);
  const veto = TITLE_VETO.exec(title)?.[0];
  if (veto) return none(dev, [`title:${veto}`]);
  let role: Role | '전산·IT' = '전산·IT';
  const [only] = roles.size ? roles : hints;
  if ((roles.size === 1 || (roles.size === 0 && hints.size === 1)) && only) role = only;
  else if (roles.size === 2 && roles.has('프론트엔드') && roles.has('백엔드')) role = '풀스택';
  // 역할을 정한 태그를 근거 앞에 둔다.
  const decisive = dev.filter(tag => ROLE_TAGS[tag] ?? (roles.size === 0 && SKILL_HINTS[tag]));
  return {
    kind: 'development', role,
    classification: { method: 'source-tag', version: SARAMIN_TAGS_VERSION, evidence: evidence([...new Set([...decisive, ...dev])]) },
  };
}
