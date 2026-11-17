/**
 * 수집 계획(collection-plan.json)을 읽어 출처별 이번 회차 검색어 목록을 만든다.
 * 관심 직무군(focus) 검색어가 예산의 focusShare만큼, 나머지는 출처의 기본 검색어가 차지한다.
 * 시작 위치는 시각(시간 단위)으로 돌려 매 회차 다른 검색어가 앞에 온다.
 *
 *   node tools/public-jobs/collection-plan.mjs --plan plan.json --source saramin --slots 10 [--defaults a,b,c]
 *   → 한 줄에 검색어 하나
 */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { FAMILY_IDS } from '../../apps/web/lib/taxonomy.js';

/** 계획을 검증한다. 잘못된 값은 버리고 기본값을 쓴다(수집을 막지 않는다). */
export function readPlan(value) {
  const plan = value && typeof value === 'object' ? value : {};
  const focus = Array.isArray(plan.focus) ? plan.focus.filter(id => FAMILY_IDS.includes(id)) : [];
  const share = Number.isFinite(plan.focusShare) ? Math.min(1, Math.max(0, plan.focusShare)) : 0.7;
  const queries = {};
  for (const id of focus) {
    const list = plan.queries?.[id];
    if (Array.isArray(list)) queries[id] = list.filter(q => typeof q === 'string' && q.trim()).map(q => q.trim().slice(0, 40));
  }
  const hours = (key, fallback) => (Number.isFinite(plan[key]) && plan[key] > 0 ? plan[key] : fallback);
  return { focus, share, queries, carryHours: hours('carryHours', 72), skipSeenHours: hours('skipSeenHours', 24) };
}

const rotate = (list, by) => (list.length ? [...list.slice(by % list.length), ...list.slice(0, by % list.length)] : []);

/**
 * slots개 자리에 검색어를 배정한다. 관심 직무군 검색어는 round(slots × share)자리, 나머지는 기본 검색어.
 * 관심 검색어가 없으면 전부 기본 검색어. 같은 검색어는 한 번만.
 */
export function schedule(plan, { slots, defaults = [], hour = Math.floor(Date.now() / 3_600_000) }) {
  const focusQueries = rotate([...new Set(plan.focus.flatMap(id => plan.queries[id] ?? []))], hour);
  const others = rotate([...new Set(defaults)].filter(q => !focusQueries.includes(q)), hour);
  const focusSlots = focusQueries.length ? Math.min(focusQueries.length, Math.round(slots * plan.share)) : 0;
  const picked = [...focusQueries.slice(0, focusSlots), ...others.slice(0, slots - focusSlots)];
  // 기본 검색어가 모자라면 관심 검색어로 채운다.
  for (const q of focusQueries.slice(focusSlots)) if (picked.length < slots) picked.push(q);
  return picked;
}

async function main() {
  const { values } = parseArgs({ options: { plan: { type: 'string' }, slots: { type: 'string' }, defaults: { type: 'string', default: '' } } });
  let raw = {};
  try { raw = JSON.parse(await readFile(values.plan, 'utf8')); } catch { /* 계획이 없으면 기본 검색어만 */ }
  const list = schedule(readPlan(raw), { slots: Number(values.slots) || 10, defaults: values.defaults.split(',').map(q => q.trim()).filter(Boolean) });
  console.log(list.join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
