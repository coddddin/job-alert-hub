/**
 * Cross-run backoff for the private sources (design 6.3). Each collector already stops a run on
 * 401/403/429/5xx; this remembers that across the half-hourly runs so the next run does not ask again.
 *
 *   node tools/public-jobs/backoff.mjs check --previous previous.json --source saramin   # prints run | skip
 *   node tools/public-jobs/backoff.mjs record --previous previous.json --snapshot snapshot.json \
 *     --run saramin=.scrapling-local/saramin/run.json --run jobkorea=.scrapling-local/jobkorea/run.json
 *
 * Memory is the deployed snapshot's `collectionHealth`, read back next run as previous.json.
 * - A blocking status (401/403/429): no request until the next Korean midnight, and at least
 *   6h·2^(n-1) after the n-th consecutive block (capped at 7 days).
 * - Any other stop (5xx, network failure after the collector's one retry, unexpected status, changed
 *   markup): wait 2^(n-1) hours (capped at 24h).
 * - A clean run resets the count. A source with no run file (skipped or never ran) keeps its memory.
 * Both commands always exit 0: backoff must never block the public deployment.
 */
import { appendFile, readFile, rename, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const HOUR = 3_600_000;
const BLOCKING = new Set([401, 403, 429]);

/** What one collector run tells us: 'ok' | 'blocked' | 'error', with the deciding HTTP status. */
export function outcome(run) {
  const statuses = [...(run?.attempts ?? []), ...(run?.searched ?? [])].map(item => item?.httpStatus);
  const blocked = statuses.find(status => BLOCKING.has(status));
  if (blocked) return { kind: 'blocked', status: blocked };
  if (run?.stopped || run?.searchStopped) {
    return { kind: 'error', status: statuses.find(status => status !== 200) ?? null, reason: run.stopped ?? run.searchStopped };
  }
  return { kind: 'ok', status: 200 };
}

/** The first instant of the next Korean (UTC+9, no DST) day. */
export function nextKoreanMidnight(now) {
  const kst = new Date(now.getTime() + 9 * HOUR);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + 1) - 9 * HOUR);
}

export function nextHealth(previous, result, now) {
  const at = now.toISOString();
  if (result.kind === 'ok') return { state: 'ok', failures: 0, lastAttemptAt: at, until: null };
  const failures = (previous?.state === 'ok' ? 0 : previous?.failures ?? 0) + 1;
  const wait = result.kind === 'blocked'
    ? Math.max(nextKoreanMidnight(now).getTime() - now.getTime(), Math.min(6 * HOUR * 2 ** (failures - 1), 7 * 24 * HOUR))
    : Math.min(HOUR * 2 ** (failures - 1), 24 * HOUR);
  return { state: result.kind, status: result.status, failures, lastAttemptAt: at, until: new Date(now.getTime() + wait).toISOString() };
}

/** `{ run: true }` or `{ run: false, reason }`. Unknown or unreadable memory means run. */
export function decide(health, now) {
  const until = Date.parse(health?.until ?? '');
  if (!Number.isFinite(until) || now.getTime() >= until) return { run: true };
  return { run: false, reason: `${health.state} (HTTP ${health.status ?? '-'}, ${health.failures}회 연속) → ${health.until}까지 쉼` };
}

async function json(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
}

async function main() {
  const [command] = process.argv.slice(2);
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: { previous: { type: 'string' }, source: { type: 'string' }, snapshot: { type: 'string' }, run: { type: 'string', multiple: true } },
  });
  const now = new Date();
  const memory = (await json(values.previous ?? ''))?.collectionHealth ?? {};
  const lines = [];
  if (command === 'check') {
    const verdict = decide(memory[values.source], now);
    console.log(verdict.run ? 'run' : 'skip');
    lines.push(`${values.source}: ${verdict.run ? '수집' : `건너뜀 — ${verdict.reason}`}`);
    console.error(lines[0]);
  } else if (command === 'record') {
    const snapshot = await json(values.snapshot ?? '');
    if (!snapshot) { console.error('backoff: snapshot unreadable, health not recorded'); return; }
    const health = { ...memory };
    for (const pair of values.run ?? []) {
      const [source, file] = pair.split('=');
      const run = await json(file);
      if (!run) { lines.push(`${source}: 실행 기록 없음(건너뜀) — 이전 상태 유지`); continue; }
      const result = outcome(run);
      health[source] = nextHealth(memory[source], result, now);
      lines.push(`${source}: ${result.kind}${result.kind === 'ok' ? '' : ` (HTTP ${result.status ?? '-'}) → ${health[source].until}까지 쉼`}`);
    }
    await writeFile(`${values.snapshot}.tmp`, `${JSON.stringify({ ...snapshot, collectionHealth: health })}\n`);
    await rename(`${values.snapshot}.tmp`, values.snapshot);
    for (const line of lines) console.log(line);
  } else {
    console.error('Usage: backoff.mjs check|record …');
    return;
  }
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.map(line => `\n- 백오프 ${line}`).join('') + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); } catch (error) { console.error(`backoff: ${error.message}`); }
}
