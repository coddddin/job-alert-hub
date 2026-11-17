/**
 * 사람인 목록의 직무 태그(`job_sector`의 job-category 링크) → 직무군(`families`)·역할 매핑, `saramin-tags/3`.
 *
 * 사이트가 붙인 분류어라 `method: 'source-tag'`로 기록한다. 원칙(설계 2절):
 * - 사전·패턴에 맞는 태그만 판단에 쓴다. 모르는 태그는 중립이다.
 * - 개발 태그와 다른 직무군 태그가 함께 있으면 애매하므로 미분류. 알림 오탐이 누락보다 나쁘다.
 *   연구·하드웨어 같은 약한 태그(R&D·회로설계·H/W 등)는 개발 태그가 있으면 무시한다.
 * - 개발이 아닌 직무군끼리는 여러 개를 허용한다(태그가 많은 순). `role`은 첫 직무군의 라벨.
 * - 개발 태그뿐인데 역할이 여럿이면 개발은 확실하므로 `전산·IT`. 프론트엔드+백엔드만 함께면 풀스택.
 * - 제목 거부어(강사·QA·기획자·디자이너 등)는 개발 판정을 미분류로 내리기만 하고, 역할을 정하지 않는다.
 * 사전을 고치면 버전을 올리고, 고치는 데 쓰지 않은 표본으로 다시 잰다.
 * v2(2026-11-17): v1 표본 오탐(게임 QA·운영 기획자·학습튜터·하드웨어)에서 QA·기획·디자인 태그와 제목 거부어 추가.
 * v3(2026-11-17): 16개 직무군(classify/taxonomy.ts)으로 확장. 개발 판정 규칙은 v2와 같다.
 */
import type { Classified } from './index.js';
import type { FamilyId } from './taxonomy.js';

export const SARAMIN_TAGS_VERSION = 'saramin-tags/3';

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

/** 개발이 아니라는 신호지만 직무군은 정하지 않는 태그(QA·서비스 기획). 개발 태그와 함께면 미분류. */
const NOT_DEV_TAGS: ReadonlySet<string> = new Set(['QA/테스터', 'SQA', 'QA', '웹기획', '서비스기획', '게임기획', '앱기획']);

/**
 * 연구·하드웨어처럼 개발 공고에도 자주 붙는 약한 태그. 개발 태그가 있으면 무시하고,
 * 개발 태그가 없을 때만 직무군을 정한다(v2에서 중립이던 태그).
 */
const WEAK_TAGS: ReadonlySet<string> = new Set([
  'R&D', '연구원', '기술연구', 'R&D기획', '회로설계', 'H/W', 'FPGA', '반도체', '전자제어', 'MCU', 'IoT', 'PCB', '핀테크',
]);

/** 패턴보다 먼저 보는 개별 태그 → 직무군. 패턴이 틀리게 잡는 것과 v2의 비개발 태그를 여기에 둔다. */
const FAMILY_TAGS: Readonly<Record<string, FamilyId>> = {
  'MD': 'marketing', '상품기획': 'marketing', '시장조사': 'marketing',
  '기획': 'office', '사업개발': 'office', '사업기획': 'office', '전략기획': 'office', '경영기획': 'office', '점포개발': 'office',
  '재무': 'office', '재무회계': 'office', '관리회계': 'office', '세무회계': 'office', '전산회계': 'office', '구매': 'office',
  '자재구매': 'office', '구매관리': 'office', '구매기획': 'office', '재고관리': 'office', '자재관리': 'office', 'ER(노무관리)': 'office',
  'CS': 'sales', '고객상담': 'sales', '상담원': 'sales', '인바운드': 'sales', '아웃바운드': 'sales', '전화상담': 'sales',
  '콜센터/고객센터': 'sales', '보험설계사': 'finance', '대출상담사': 'finance', '보험상담': 'finance',
  '안전관리자': 'public', '안전보건관리자': 'public', '보건관리자': 'medical',
  '정비': 'production', '용접': 'production', '공정엔지니어': 'production', '공정설계': 'production', '공정관리': 'production',
  '설비점검': 'production', '설비OP': 'production', '설비보전': 'production', 'QC': 'production',
  '금형설계': 'research', '반도체설계': 'research', '전기설계': 'research', '제약/바이오': 'research', '의약·제약': 'research',
  '바이오': 'research', '미생물': 'research', '생명과학': 'research', '임상개발': 'research',
  '전기기사': 'construction', '토목': 'construction',
  '부동산': 'etc', '부동산투자': 'etc',
  '경비': 'service', '경비원': 'service', '미화': 'service', '운전': 'logistics', '배송': 'logistics',
  '교재개발': 'education', '교육콘텐츠개발': 'education', '교육콘텐츠기획': 'education', '직업훈련': 'education',
  '영상디자인': 'design', '영상디자이너': 'design', 'PhotoShop': 'design', '원화': 'design', '일러스트': 'design', 'VMD': 'design',
};

/** 태그 안의 낱말로 정하는 직무군. 위에서부터 처음 맞는 것 하나. */
const FAMILY_PATTERNS: readonly (readonly [FamilyId, RegExp])[] = [
  ['education', /강사|교사|학원|교육|과외|튜터|조교|교수설계|교구/u],
  ['medical', /간호|병원|의원|약사|방사선사|임상병리|요양|진료|수술|원무|의료|치위생|물리치료|초음파|보건|외래|(?:내|외|치|피부|정형외|산부인|한방|영상의학)과$/u],
  ['public', /법무|법률|변호사|송무|특허|소방|경찰|교정직|군무원|컴플라이언스|^감사$/u],
  ['finance', /금융|보험|은행|대출|증권|여신|채권|텔러|자산관리|핀테크|투자|펀드|카드사/u],
  ['marketing', /마케팅|홍보|광고|브랜딩|브랜드관리|프로모션|PR$/u],
  ['sales', /영업|판매|판촉|텔레마케팅/u],
  ['design', /디자인|디자이너/u],
  ['media', /영상|방송|촬영|PD|기자|에디터|아나운서|쇼호스트|콘텐츠|유튜브|만화|웹툰|공연|음악|조명|엔터테인먼트|애프터이펙트/u],
  ['research', /연구|실험|시험|임상|세포|분자|신소재|고분자|화학|설계엔지니어|기구설계|기계설계|부품설계|제품설계|장비설계|생산설계|자동화설계|구조해석|3D설계|기술설계/u],
  ['production', /생산|제조|품질|조립|포장|패킹|검사원|가공|기계조작|자동화라인|판금|도장(?!공)/u],
  ['logistics', /물류|운송|배송|창고|입고|출고|지게차|적재|하역|피킹|집하|화물|무역|납품|택배|WMS|견인|해운/u],
  ['construction', /건축|건설|토목|시공|설비|공조|감리|CM|현장관리|BIM|목공|방수|도장공|인테리어|플랜트|시설관리|도시설계|^공무$/u],
  ['service', /서비스|호텔|식당|홀|서빙|조리|주방|바리스타|매장|안내|고객응대|승무원|지상직|미용|뷰티|지배인|청소|항공사|정비기사|A\/S/u],
  ['office', /사무|총무|회계|경리|세무|인사|급여|비서|서무|문서|서류|자료입력|OA|Excel|경영지원|예산|전표|더존|계산서|복리후생|ESG|비품/u],
];

/** 화면 라벨(apps/web/lib/taxonomy.js). 테스트가 같은지 확인한다. */
export const FAMILY_LABELS: Readonly<Record<FamilyId, string>> = {
  it: 'IT·개발', office: '경영·사무', finance: '금융·보험', marketing: '마케팅·홍보', sales: '영업·판매·상담',
  design: '디자인', media: '미디어·문화·예술', research: '연구·엔지니어링', production: '생산·품질·제조',
  logistics: '운송·물류·무역', construction: '건설·건축·설비', medical: '의료·보건·복지', education: '교육',
  service: '서비스·외식·숙박', public: '공공·법률·안전', etc: '기타',
};

/** 태그 하나의 직무군. 모르면 `null`. */
export function tagFamily(tag: string): FamilyId | null {
  const exact = FAMILY_TAGS[tag];
  if (exact) return exact;
  return FAMILY_PATTERNS.find(([, pattern]) => pattern.test(tag))?.[0] ?? null;
}

/** 태그가 개발이어도 이 제목이면 개발로 확정하지 않는다(강사·튜터·교육생, QA·테스터, 기획자·디자이너, 하드웨어). */
const TITLE_VETO = /강사|튜터|교육생|수강생|국비|훈련생|테스터|QA|기획자|디자이너|하드웨어/u;

export function classifySaraminTags(tags: readonly string[], title = ''): Classified {
  const roles = new Set<Role>();
  const hints = new Set<Role>();
  const dev: string[] = [];
  const blockers: string[] = [];
  const strong = new Map<FamilyId, string[]>();
  const weak = new Map<FamilyId, string[]>();
  for (const tag of tags) {
    const role = ROLE_TAGS[tag];
    if (role) { roles.add(role); dev.push(tag); continue; }
    const hint = SKILL_HINTS[tag];
    if (hint) hints.add(hint);
    if (DEV_TAGS.has(tag)) { dev.push(tag); continue; }
    if (NOT_DEV_TAGS.has(tag)) { blockers.push(tag); continue; }
    const family = tagFamily(tag);
    if (!family) continue;
    const bucket = WEAK_TAGS.has(tag) ? weak : strong;
    bucket.set(family, [...(bucket.get(family) ?? []), tag]);
  }
  const evidence = (list: readonly string[], prefix: readonly string[] = []) => [...prefix, ...list.map(tag => `tag:${tag}`)].slice(0, 5);
  const none = (list: readonly string[], prefix: readonly string[] = []): Classified => ({
    kind: 'other', role: '', families: [],
    classification: { method: 'none', version: SARAMIN_TAGS_VERSION, evidence: evidence(list, prefix) },
  });
  const others = [...strong.values()].flat();
  if (dev.length) {
    // 개발과 다른 직무군이 함께면 애매하다. 알림 오탐이 누락보다 나쁘다.
    if (others.length || blockers.length) return none([...dev, ...blockers, ...others]);
    const veto = TITLE_VETO.exec(title)?.[0];
    if (veto) return none(dev, [`title:${veto}`]);
    let role: Role | '전산·IT' = '전산·IT';
    const [only] = roles.size ? roles : hints;
    if ((roles.size === 1 || (roles.size === 0 && hints.size === 1)) && only) role = only;
    else if (roles.size === 2 && roles.has('프론트엔드') && roles.has('백엔드')) role = '풀스택';
    // 역할을 정한 태그를 근거 앞에 둔다.
    const decisive = dev.filter(tag => ROLE_TAGS[tag] ?? (roles.size === 0 && SKILL_HINTS[tag]));
    return {
      kind: 'development', role, families: ['it'],
      classification: { method: 'source-tag', version: SARAMIN_TAGS_VERSION, evidence: evidence([...new Set([...decisive, ...dev])]) },
    };
  }
  const found = strong.size ? strong : weak;
  if (!found.size) return none(blockers);
  // 태그가 많은 직무군부터. 공고 하나가 여러 직무군을 뽑을 수 있다(예: 마케팅 + 디자인).
  const families = [...found.entries()].sort((a, b) => b[1].length - a[1].length).map(([family]) => family);
  const first = families[0] ?? 'etc';
  return {
    kind: 'other', role: FAMILY_LABELS[first], families,
    classification: { method: 'source-tag', version: SARAMIN_TAGS_VERSION, evidence: evidence([...found.values()].flat()) },
  };
}
