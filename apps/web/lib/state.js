import { defaults, REGIONS, ROLES } from './matching.js';
export const storageKey = 'job-alert-hub:prototype:v1';
export function initialState() {
  return { version: 1, filters: { ...defaults }, notifications: { ...defaults, includeUnspecified: false, frequency: 'hourly', email: true, kakao: true }, bookmarks: [], applications: {} };
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
