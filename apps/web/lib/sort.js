/** 목록 정렬 기준. 기본값은 기존 동작(마감 임박순)과 같다. */
export const SORT_KEYS = ['deadline', 'title', 'company', 'source'];
export const defaultSort = { key: 'deadline', dir: 'asc' };

/** 같은 항목을 다시 누르면 방향을 바꾸고, 다른 항목을 누르면 오름차순으로 시작한다. */
export function nextSort(current, key) {
  return current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' };
}

/** 저장값이 올바르지 않으면 기본값으로 돌린다. */
export function sanitizeSort(value) {
  if (value && SORT_KEYS.includes(value.key) && (value.dir === 'asc' || value.dir === 'desc')) return { key: value.key, dir: value.dir };
  return { ...defaultSort };
}

const text = (a, b) => (a ?? '').localeCompare(b ?? '', 'ko');

/**
 * 공고 배열을 새 배열로 정렬한다. 마감일이 없는 공고(상시 등)는 방향과 상관없이 맨 뒤에 둔다.
 * `get`은 공고에서 { days, title, company, source }를 꺼내는 함수다.
 */
export function sortJobs(items, sort, get) {
  const sign = sort.dir === 'desc' ? -1 : 1;
  return [...items].sort((a, b) => {
    const x = get(a), y = get(b);
    if ((x.days === null) !== (y.days === null)) return x.days === null ? 1 : -1;
    const primary = sort.key === 'deadline' ? (x.days ?? 0) - (y.days ?? 0) : text(x[sort.key], y[sort.key]);
    return sign * primary || (x.days ?? 0) - (y.days ?? 0);
  });
}
