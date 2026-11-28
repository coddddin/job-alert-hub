/**
 * 목록 정렬. 표의 열 제목(마감·공고·경력·근무지·마감일·판정)을 누르면 그 열로 정렬하고, 다시 누르면 방향을 바꾼다.
 * 기본값은 기존 동작(마감 임박순)과 같다.
 */
export const SORT_KEYS = ['deadline', 'title', 'experience', 'location', 'status'];
export const defaultSort = { key: 'deadline', dir: 'asc' };

/** 같은 항목을 다시 누르면 방향을 바꾸고, 다른 항목을 누르면 오름차순으로 시작한다. */
export function nextSort(current, key) {
  return current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' };
}

/** 저장값이 올바르지 않으면(예전 정렬 항목 포함) 기본값으로 돌린다. */
export function sanitizeSort(value) {
  if (value && SORT_KEYS.includes(value.key) && (value.dir === 'asc' || value.dir === 'desc')) return { key: value.key, dir: value.dir };
  return { ...defaultSort };
}

/** 경력 정렬 순서: 신입 → 신입·경력 → 경력무관 → 경력(요구 연차 적은 순). 알 수 없으면 null(맨 뒤). */
export function experienceRank(parsed) {
  switch (parsed?.kind) {
    case 'new': return 0;
    case 'new-or-experienced': return 1;
    case 'any': return 2;
    case 'experienced': return 3 + Math.min(parsed.range?.min?.years ?? 0, 99) / 100;
    default: return null;
  }
}

/** 판정 정렬 순서: 지원 가능 → 확인 필요 → 제외. */
export const STATUS_RANK = Object.freeze({ match: 0, review: 1, exclude: 2 });

const text = (a, b) => a.localeCompare(b, 'ko');

/** 마감 임박순. 마감일이 없는 공고(상시 등)는 맨 뒤. */
function byDeadline(x, y) {
  if ((x.days === null) !== (y.days === null)) return x.days === null ? 1 : -1;
  return (x.days ?? 0) - (y.days ?? 0);
}

/**
 * 공고 배열을 새 배열로 정렬한다. `get`은 공고에서
 * { days, title, experience(순위), location(지역 이름), status(순위) }를 꺼내는 함수다.
 * 값이 없는 공고(상시 마감, 경력·근무지 미제공)는 방향과 상관없이 맨 뒤에 두고,
 * 값이 같으면 마감 임박순으로 둔다.
 */
export function sortJobs(items, sort, get) {
  const sign = sort.dir === 'desc' ? -1 : 1;
  const field = sort.key === 'deadline' ? 'days' : sort.key;
  return [...items].sort((a, b) => {
    const x = get(a), y = get(b);
    const u = x[field] ?? null, v = y[field] ?? null;
    if ((u === null) !== (v === null)) return u === null ? 1 : -1;
    const primary = u === null ? 0 : typeof u === 'number' ? u - v : text(u, v);
    return sign * primary || byDeadline(x, y);
  });
}
