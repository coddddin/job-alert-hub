/**
 * Production step: add a JobKorea batch to the ALIO snapshot that the site deploys.
 *
 *   node tools/public-jobs/merge-live.mjs --base apps/web/data/live/snapshot.json --batch run/batch.json
 *
 * The ALIO snapshot is the source of truth. This script only ever replaces it with a
 * validated superset. A missing, empty, invalid, stale (different KST date) or duplicate
 * batch leaves the base file byte-for-byte unchanged and still exits 0, so the private
 * source can never block the public deployment.
 */
import { appendFile, readFile, rename, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { collect } from '../../apps/collector/dist/collect.js';
import { publicJobs } from '../../apps/collector/dist/providers/public-jobs.js';
import { mergePreviewSnapshots } from '../../apps/web/lib/preview.js';

/** Pure merge. Returns `{ snapshot }` on success or `{ reason }` when the base must stay as is. */
export async function mergeLive(base, input) {
  if (base?.version !== 1 || !Array.isArray(base.jobs)) return { reason: 'base snapshot is not v1' };
  let provider;
  try { provider = publicJobs(input); } catch (error) { return { reason: `batch rejected: ${error.message}` }; }
  const observed = (input.jobs ?? []).map(job => job?.observedAt).filter(value => typeof value === 'string' && Number.isFinite(Date.parse(value))).sort();
  if (!observed.length) return { reason: 'batch has no observations' };
  // The batch's collection time is its newest observation; its KST date must match ALIO's.
  const incoming = await collect([provider], () => { throw new Error('merge must not fetch'); }, new Date(observed.at(-1)));
  if (!incoming.jobs.length) return { reason: 'batch has no valid jobs' };
  if (incoming.today !== base.today) return { reason: `stale batch: ${incoming.today} != ${base.today}` };
  if (base.sources?.some(source => source.name === provider.name)) return { reason: `base already has ${provider.name}` };
  let merged;
  try { merged = mergePreviewSnapshots(base, incoming); } catch (error) { return { reason: error.message }; }
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

async function main() {
  const { values } = parseArgs({ options: { base: { type: 'string' }, batch: { type: 'string' } } });
  if (!values.base || !values.batch) throw new Error('Usage: merge-live.mjs --base snapshot.json --batch batch.json');
  const base = JSON.parse(await readFile(values.base, 'utf8'));
  let result;
  try {
    result = await mergeLive(base, JSON.parse(await readFile(values.batch, 'utf8')));
  } catch (error) {
    result = { reason: `batch unreadable: ${error.code ?? error.message}` };
  }
  let line;
  if (result.snapshot) {
    // Write next to the target then rename, so a crash never leaves a half-written snapshot.
    await writeFile(`${values.base}.tmp`, `${JSON.stringify(result.snapshot)}\n`);
    await rename(`${values.base}.tmp`, values.base);
    line = `JobKorea merged: ${result.snapshot.sources.map(s => `${s.name} ${s.total - s.skipped}/${s.total}`).join(', ')}`;
  } else {
    line = `JobKorea skipped, ALIO snapshot unchanged (${result.reason})`;
  }
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n- ${line}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
