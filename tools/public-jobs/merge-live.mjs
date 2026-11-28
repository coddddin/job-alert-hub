/**
 * Production step: add private-source batches (JobKorea, Saramin) to the ALIO snapshot that the site deploys.
 *
 *   node tools/public-jobs/merge-live.mjs --base apps/web/data/live/snapshot.json --batch jobkorea.json --batch saramin.json
 *
 * The ALIO snapshot is the source of truth. This script only ever replaces it with a
 * validated superset. Batches are merged one at a time in the given order; a missing, empty,
 * invalid, stale (different KST date) or duplicate batch is skipped on its own and never
 * affects the others. If nothing merges the base file stays byte-for-byte unchanged. It always
 * exits 0, so a private source can never block the public deployment.
 */
import { appendFile, readFile, rename, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { collect } from '../../apps/collector/dist/collect.js';
import { publicJobs } from '../../apps/collector/dist/providers/public-jobs.js';
import { saramin } from '../../apps/collector/dist/providers/saramin.js';
import { withEstimate } from '../../apps/collector/dist/classify/model.js';
import { mergePreviewSnapshots } from '../../apps/web/lib/preview.js';
import { normalizeJob } from '../../apps/web/lib/normalize-job.js';
import { readPlan } from './collection-plan.mjs';

/** Private sources by the batch's `source`. Each validates its own JSON contract. */
const PROVIDERS = { jobkorea: publicJobs, saramin };

/** Pure merge. Returns `{ snapshot }` on success or `{ reason }` when the base must stay as is. */
export async function mergeLive(base, input) {
  if (base?.version !== 1 || !Array.isArray(base.jobs)) return { reason: 'base snapshot is not v1' };
  const make = Object.hasOwn(PROVIDERS, input?.source) ? PROVIDERS[input.source] : null;
  if (!make) return { reason: 'batch rejected: unknown source' };
  let provider;
  try { provider = make(input); } catch (error) { return { reason: `batch rejected: ${error.message}` }; }
  const observed = (input.jobs ?? []).map(job => job?.observedAt).filter(value => typeof value === 'string' && Number.isFinite(Date.parse(value))).sort();
  if (!observed.length) return { reason: 'batch has no observations' };
  // The batch's collection time is its newest observation; its KST date must match ALIO's.
  const incoming = await collect([provider], () => { throw new Error('merge must not fetch'); }, new Date(observed.at(-1)));
  if (!incoming.jobs.length) return { reason: 'batch has no valid jobs' };
  if (incoming.today !== base.today) return { reason: `stale batch: ${incoming.today} != ${base.today}` };
  if (base.sources?.some(source => source.name === provider.name)) return { reason: `base already has ${provider.name}` };
  let merged;
  try { merged = mergePreviewSnapshots(base, incoming); } catch (error) { return { reason: error.message }; }
  // 공고마다 마지막으로 본 시각을 남긴다. 다음 회차에서 이월·재요청 판단에 쓴다.
  const seen = new Map(input.jobs.map(job => [`${provider.name}:${job?.externalId}`, job?.observedAt]));
  merged = { ...merged, jobs: merged.jobs.map(job => (seen.has(job.id) ? { ...job, seenAt: new Date(seen.get(job.id)).toISOString() } : job)) };
  const stamp = (sources, collectedAt) => sources.map(source => ({ ...source, collectedAt: source.collectedAt ?? collectedAt }));
  return {
    snapshot: {
      ...merged,
      // Top-level time stays ALIO's; each source carries its own collection time.
      collectedAt: base.collectedAt,
      sources: [...stamp(base.sources ?? [], base.collectedAt), ...stamp(incoming.sources, incoming.collectedAt)],
    },
  };
}

/**
 * 이전 배포 스냅샷의 민간 공고를 이어 붙인다(누적). 이번 회차에 다시 본 공고는 새 관측이 이긴다.
 * 이월 조건: carryHours 안에 본 공고이고, 오늘 기준으로 마감되지 않았다. ALIO는 매 회차 전체를 받으므로 이월하지 않는다.
 */
export function carryOver(snapshot, previous, { carryHours = 72, now = new Date() } = {}) {
  if (previous?.version !== 1 || !Array.isArray(previous.jobs)) return { snapshot, carried: {} };
  const have = new Set(snapshot.jobs.map(job => job.id));
  const limit = now.getTime() - carryHours * 3_600_000;
  const carried = {};
  const jobs = [];
  for (const job of previous.jobs) {
    const source = typeof job?.id === 'string' ? job.id.split(':')[0] : '';
    if (!source || source === 'alio' || have.has(job.id)) continue;
    const seenAt = Date.parse(job.seenAt ?? '');
    if (!Number.isFinite(seenAt) || seenAt < limit) continue;
    try { if (normalizeJob(job, snapshot.today).closed) continue; } catch { continue; }
    jobs.push(estimateCarried(job));
    have.add(job.id);
    carried[source] = (carried[source] ?? 0) + 1;
  }
  if (!jobs.length) return { snapshot, carried };
  const sources = snapshot.sources.map(entry => (carried[entry.name] ? { ...entry, carried: carried[entry.name] } : entry));
  for (const name of Object.keys(carried)) {
    if (sources.some(entry => entry.name === name)) continue;
    // 이번 회차에 실패한 출처: 이전 수집 시각을 그대로 두어 화면이 오래된 데이터로 표시하게 한다.
    const old = previous.sources?.find(entry => entry.name === name);
    if (old) sources.push({ ...old, total: 0, skipped: 0, carried: carried[name] });
  }
  return { snapshot: { ...snapshot, sources, jobs: [...snapshot.jobs, ...jobs] }, carried };
}

/**
 * 모델 도입 전에 수집돼 미분류로 이월되는 공고에도 같은 추정 단계를 적용한다(다시 수집될 때까지 기다리지 않게).
 * 확정·비채용·이미 추정된 공고는 그대로 둔다. 꼬리표는 수집 때와 같은 값(사이트 직무 키워드·스킬)이다.
 */
function estimateCarried(job) {
  const classification = job.classification;
  if (!classification || classification.method !== 'none' || job.families?.length) return job;
  const estimated = withEstimate({ kind: job.kind, role: job.role, families: [], classification }, job.title ?? '', job.tags ?? []);
  return estimated.classification.method === 'model' ? { ...job, ...estimated } : job;
}

/** Merge every batch file in order onto the base. Returns the final snapshot (or null) and one line per batch. */
export async function mergeFiles(base, files) {
  let snapshot = null;
  const lines = [];
  for (const file of files) {
    let input;
    try { input = JSON.parse(await readFile(file, 'utf8')); } catch (error) {
      lines.push(`${file} skipped (batch unreadable: ${error.code ?? error.message})`);
      continue;
    }
    const name = typeof input?.source === 'string' ? input.source : file;
    const result = await mergeLive(snapshot ?? base, input);
    if (result.snapshot) {
      snapshot = result.snapshot;
      const source = snapshot.sources.find(s => s.name === name);
      lines.push(`${name} merged: ${source.total - source.skipped}/${source.total}`);
    } else {
      lines.push(`${name} skipped (${result.reason})`);
    }
  }
  return { snapshot, lines };
}

async function main() {
  const { values } = parseArgs({ options: { base: { type: 'string' }, batch: { type: 'string', multiple: true }, previous: { type: 'string' }, plan: { type: 'string' } } });
  if (!values.base || !values.batch?.length) throw new Error('Usage: merge-live.mjs --base snapshot.json --batch batch.json [--batch more.json] [--previous deployed.json --plan plan.json]');
  const base = JSON.parse(await readFile(values.base, 'utf8'));
  let { snapshot, lines } = await mergeFiles(base, values.batch);
  if (values.previous) {
    let previous = null;
    let plan = readPlan({});
    try { previous = JSON.parse(await readFile(values.previous, 'utf8')); } catch (error) { lines.push(`previous snapshot unreadable (${error.code ?? error.message})`); }
    try { if (values.plan) plan = readPlan(JSON.parse(await readFile(values.plan, 'utf8'))); } catch { /* 기본값 */ }
    const result = carryOver(snapshot ?? base, previous, { carryHours: plan.carryHours });
    const total = Object.values(result.carried).reduce((a, b) => a + b, 0);
    if (total) { snapshot = result.snapshot; lines.push(`carried from previous: ${Object.entries(result.carried).map(([k, v]) => `${k} ${v}`).join(', ')}`); }
  }
  if (snapshot) {
    // Write next to the target then rename, so a crash never leaves a half-written snapshot.
    await writeFile(`${values.base}.tmp`, `${JSON.stringify(snapshot)}\n`);
    await rename(`${values.base}.tmp`, values.base);
    lines.push(`snapshot: ${snapshot.sources.map(s => `${s.name} ${s.total - s.skipped}/${s.total}`).join(', ')}`);
  } else {
    lines.push('ALIO snapshot unchanged');
  }
  for (const line of lines) console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.map(line => `\n- ${line}`).join('') + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
