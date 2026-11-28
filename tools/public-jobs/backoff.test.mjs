// Cross-run backoff: a blocking signal must keep the next half-hourly runs from asking again.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { decide, nextHealth, nextKoreanMidnight, outcome } from './backoff.mjs';

const at = iso => new Date(iso);
const ok = { stopped: null, attempts: [{ httpStatus: 200 }] };

test('reads the deciding status from both collectors\' run files', () => {
  assert.deepEqual(outcome(ok), { kind: 'ok', status: 200 });
  assert.equal(outcome({ stopped: 'access_or_service_error', attempts: [{ httpStatus: 200 }, { httpStatus: 429 }] }).kind, 'blocked');
  // JobKorea: a block during keyword discovery, with details still fetched for what was found.
  assert.deepEqual(outcome({ stopped: null, searchStopped: 'access_or_service_error', searched: [{ httpStatus: 403 }], attempts: [] }), { kind: 'blocked', status: 403 });
  assert.deepEqual(outcome({ stopped: 'access_or_service_error', attempts: [{ httpStatus: 503 }] }).status, 503);
  assert.equal(outcome({ stopped: 'access_or_service_error', attempts: [{ httpStatus: null }] }).kind, 'error');
  // A 404 on one detail is an individual exclusion, not a stop.
  assert.equal(outcome({ stopped: null, attempts: [{ httpStatus: 404 }, { httpStatus: 200 }] }).kind, 'ok');
});

test('a block waits until the next Korean day and doubles on repeats; errors back off by hours', () => {
  assert.equal(nextKoreanMidnight(at('2026-11-28T10:00:00Z')).toISOString(), '2026-11-28T15:00:00.000Z');
  assert.equal(nextKoreanMidnight(at('2026-11-28T16:00:00Z')).toISOString(), '2026-11-29T15:00:00.000Z');
  const first = nextHealth(undefined, { kind: 'blocked', status: 429 }, at('2026-11-28T01:00:00Z'));
  assert.equal(first.until, '2026-11-28T15:00:00.000Z'); // 10:00 KST block → midnight KST (14h > 6h)
  const late = nextHealth(undefined, { kind: 'blocked', status: 429 }, at('2026-11-28T14:30:00Z'));
  assert.equal(late.until, '2026-11-28T20:30:00.000Z'); // 23:30 KST → at least 6h, not 30 minutes
  const second = nextHealth(first, { kind: 'blocked', status: 429 }, at('2026-11-28T15:00:00Z'));
  assert.equal(second.failures, 2);
  assert.equal(second.until, '2026-11-29T15:00:00.000Z'); // 24h: max(midnight, 12h)
  const errors = [1, 2, 3].reduce((health, i) => nextHealth(health, { kind: 'error', status: 503 }, at(`2026-11-28T0${i}:00:00Z`)), undefined);
  assert.equal(errors.until, '2026-11-28T07:00:00.000Z'); // third error in a row → 4h
  assert.deepEqual(nextHealth(errors, { kind: 'ok' }, at('2026-11-28T08:00:00Z')), { state: 'ok', failures: 0, lastAttemptAt: '2026-11-28T08:00:00.000Z', until: null });
  assert.equal(nextHealth({ state: 'ok', failures: 0 }, { kind: 'error', status: null }, at('2026-11-28T08:00:00Z')).failures, 1);
});

test('decides to run when memory is missing, expired or unreadable', () => {
  const now = at('2026-11-28T05:00:00Z');
  assert.equal(decide(undefined, now).run, true);
  assert.equal(decide({ until: 'garbage' }, now).run, true);
  assert.equal(decide({ until: '2026-11-28T04:59:00Z' }, now).run, true);
  const wait = decide({ state: 'blocked', status: 429, failures: 1, until: '2026-11-28T15:00:00Z' }, now);
  assert.equal(wait.run, false);
  assert.match(wait.reason, /429/);
});

test('CLI: record writes health into the snapshot, keeps a skipped source\'s memory, and check reads it back', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'backoff-'));
  const file = name => path.join(dir, name);
  const kept = { state: 'blocked', status: 403, failures: 1, lastAttemptAt: '2026-11-28T00:00:00.000Z', until: '2999-01-01T00:00:00.000Z' };
  writeFileSync(file('previous.json'), JSON.stringify({ collectionHealth: { jobkorea: kept } }));
  writeFileSync(file('snapshot.json'), JSON.stringify({ version: 1, jobs: [] }));
  writeFileSync(file('saramin.json'), JSON.stringify({ stopped: 'access_or_service_error', attempts: [{ httpStatus: 429 }] }));
  const cli = args => execFileSync(process.execPath, [path.join(import.meta.dirname, 'backoff.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
  cli(['record', '--previous', file('previous.json'), '--snapshot', file('snapshot.json'),
    '--run', `saramin=${file('saramin.json')}`, '--run', `jobkorea=${file('missing.json')}`]);
  const health = JSON.parse(readFileSync(file('snapshot.json'), 'utf8')).collectionHealth;
  assert.equal(health.saramin.state, 'blocked');
  assert.deepEqual(health.jobkorea, kept);
  assert.equal(cli(['check', '--previous', file('snapshot.json'), '--source', 'saramin']).trim(), 'skip');
  assert.equal(cli(['check', '--previous', file('none.json'), '--source', 'saramin']).trim(), 'run');
});
