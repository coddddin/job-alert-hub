/**
 * 직무군 ID. 화면 목록(apps/web/lib/taxonomy.js)과 같아야 하며 테스트가 이를 확인한다.
 * 출처별 분류(NCS, 사람인 태그, 잡코리아 키워드)는 모두 이 ID로 끝난다.
 */
export const FAMILY_IDS = [
  'it', 'office', 'finance', 'marketing', 'sales', 'design', 'media', 'research',
  'production', 'logistics', 'construction', 'medical', 'education', 'service', 'public', 'etc',
] as const;
export type FamilyId = typeof FAMILY_IDS[number];

/** ALIO NCS 대분류 → 직무군. 표에 없는 분류는 `etc`. */
export const NCS_FAMILIES: Readonly<Record<string, FamilyId>> = {
  정보통신: 'it',
  사업관리: 'office',
  '경영.회계.사무': 'office',
  '금융.보험': 'finance',
  영업판매: 'sales',
  '문화.예술.디자인.방송': 'media',
  연구: 'research',
  '전기.전자': 'research',
  기계: 'research',
  재료: 'research',
  화학: 'research',
  '화학.바이오': 'research',
  '환경.에너지.안전': 'research',
  식품가공: 'production',
  '섬유.의복': 'production',
  '인쇄.목재.가구.공예': 'production',
  '운전.운송': 'logistics',
  건설: 'construction',
  '보건.의료': 'medical',
  '사회복지.종교': 'medical',
  '교육.자연.사회과학': 'education',
  '경비.청소': 'service',
  음식서비스: 'service',
  '이용.숙박.여행.오락.스포츠': 'service',
  '법률.경찰.소방.교도.국방': 'public',
  농림어업: 'etc',
};
