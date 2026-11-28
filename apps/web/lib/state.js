import { CAREERS, defaults, FAMILY_FILTERS, REGIONS, ROLES } from './matching.js';
import { FAMILY_IDS } from './taxonomy.js';
import { defaultSort, sanitizeSort } from './sort.js';
export const storageKey = 'job-alert-hub:prototype:v1';
export function initialState() {
  // profile: 첫 방문 질문의 답. null이면 아직 묻지 않았다. skipped면 건너뛰었다.
  return { version: 1, profile: null, filters: { ...defaults }, notifications: { ...defaults, includeUnspecified: false, frequency: 'hourly', email: true, kakao: true }, bookmarks: [], applications: {}, sort: { ...defaultSort } };
}
/** 샘플(`sample-1`)과 수집 공고(`alio:306649`) ID. */
const JOB_ID = /^(?:sample-\d+|[a-z]+:\d+)$/;
export function sanitizeState(value) {
  const clean = initialState();
  if (!value || value.version !== 1) return clean;
  for (const key of ['filters', 'notifications']) {
    const source = value[key];
    if (!source || typeof source !== 'object') continue;
    if (ROLES.includes(source.role)) clean[key].role = source.role;
    if (REGIONS.includes(source.region)) clean[key].region = source.region;
    if (typeof source.includeUnspecified === 'boolean') clean[key].includeUnspecified = source.includeUnspecified;
    if (typeof source.keyword === 'string') clean[key].keyword = source.keyword.slice(0, 100);
    if (FAMILY_FILTERS.includes(source.family)) clean[key].family = source.family;
    if (Array.isArray(source.families)) clean[key].families = [...new Set(source.families.filter(id => FAMILY_IDS.includes(id)))];
    if (CAREERS.includes(source.career)) clean[key].career = source.career;
  }
  clean.sort = sanitizeSort(value.sort);
  const p = value.profile;
  if (p && typeof p === 'object') {
    const families = Array.isArray(p.families) ? [...new Set(p.families.filter(id => FAMILY_IDS.includes(id)))] : [];
    if (p.skipped === true) clean.profile = { skipped: true };
    else if (families.length && CAREERS.includes(p.career) && REGIONS.includes(p.region)) clean.profile = { families, career: p.career, region: p.region };
  }
  const n = value.notifications || {};
  if (['hourly', 'daily'].includes(n.frequency)) clean.notifications.frequency = n.frequency;
  for (const channel of ['email', 'kakao']) if (typeof n[channel] === 'boolean') clean.notifications[channel] = n[channel];
  if (Array.isArray(value.bookmarks)) clean.bookmarks = [...new Set(value.bookmarks.filter(id => typeof id === 'string' && JOB_ID.test(id)))];
  if (value.applications && typeof value.applications === 'object') {
    for (const [id, status] of Object.entries(value.applications)) {
      if (JOB_ID.test(id) && ['검토 중', '지원 예정', '지원 완료', '합격', '불합격', '지원 철회'].includes(status)) clean.applications[id] = status;
    }
  }
  return clean;
}
