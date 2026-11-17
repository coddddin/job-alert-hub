/**
 * 사용자에게 보여 주는 직무군. 수집기 분류(apps/collector/src/classify/taxonomy.ts)와 ID가 같아야 한다.
 * 첫 방문 질문, 맞춤 탭, 알림이 모두 이 목록을 쓴다. 세부 직무는 IT·개발만 둔다.
 */
export const FAMILIES = Object.freeze([
  { id: 'it', label: 'IT·개발' },
  { id: 'office', label: '경영·사무' },
  { id: 'finance', label: '금융·보험' },
  { id: 'marketing', label: '마케팅·홍보' },
  { id: 'sales', label: '영업·판매·상담' },
  { id: 'design', label: '디자인' },
  { id: 'media', label: '미디어·문화·예술' },
  { id: 'research', label: '연구·엔지니어링' },
  { id: 'production', label: '생산·품질·제조' },
  { id: 'logistics', label: '운송·물류·무역' },
  { id: 'construction', label: '건설·건축·설비' },
  { id: 'medical', label: '의료·보건·복지' },
  { id: 'education', label: '교육' },
  { id: 'service', label: '서비스·외식·숙박' },
  { id: 'public', label: '공공·법률·안전' },
  { id: 'etc', label: '기타' },
].map(Object.freeze));

/** IT·개발의 세부 직무. 기존 `role` 값과 같다. */
export const IT_ROLES = Object.freeze(['프론트엔드', '백엔드', '풀스택', '모바일', '게임', '데이터·AI', '임베디드', '전산·IT']);

export const FAMILY_IDS = Object.freeze(FAMILIES.map(family => family.id));
export const familyLabel = id => FAMILIES.find(family => family.id === id)?.label ?? id;
