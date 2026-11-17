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
import { mergePreviewSnapshots } from '../../apps/web/lib/preview.js';

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
  const { values } = parseArgs({ options: { base: { type: 'string' }, batch: { type: 'string', multiple: true } } });
  if (!values.base || !values.batch?.length) throw new Error('Usage: merge-live.mjs --base snapshot.json --batch batch.json [--batch more.json]');
  const base = JSON.parse(await readFile(values.base, 'utf8'));
  const { snapshot, lines } = await mergeFiles(base, values.batch);
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
