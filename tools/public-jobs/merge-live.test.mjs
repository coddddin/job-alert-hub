// The one guarantee the deploy depends on: a bad JobKorea batch never changes the ALIO snapshot.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { mergeLive } from './merge-live.mjs';

const base = {
  version: 1, collectedAt: '2026-11-16T21:20:00.000Z', today: '2026-11-17',
  sources: [{ name: 'alio', label: '잡알리오', total: 1, skipped: 0 }],
  jobs: [{ id: 'alio:1', source: 'alio', company: '기관', title: '전산직', url: null, applyUrl: null,
    raw: { location: '서울', experience: '신입', deadline: '2026-11-30' }, kind: 'development', role: '백엔드',
    employment: '정규직', tags: [], description: '', details: null }],
};
const field = value => ({ value, status: 'extracted', evidence: value });
const observation = (id, observedAt = '2026-11-16T21:25:00+00:00') => ({
  externalId: id, url: `https://www.jobkorea.co.kr/Recruit/GI_Read/${id}`, observedAt, extractorVersion: 'jobkorea-detail/1',
  fields: { company: field('회사'), title: field('개발자'), location: field('서울'), experience: field('신입'), deadline: field('~11/30') },
  warnings: [],
});
const batch = jobs => ({ version: 1, source: 'jobkorea', jobs });

test('merges a same-day batch and keeps per-source collection times', async () => {
  const { snapshot } = await mergeLive(base, batch([observation('7')]));
  assert.deepEqual(snapshot.jobs.map(job => job.id), ['alio:1', 'jobkorea:7']);
  assert.equal(snapshot.collectedAt, base.collectedAt);
  assert.deepEqual(snapshot.sources.map(s => [s.name, s.collectedAt]),
    [['alio', base.collectedAt], ['jobkorea', '2026-11-16T21:25:00.000Z']]);
});

test('keeps ALIO alone for empty, invalid, stale or already merged batches', async () => {
  for (const input of [batch([]), { version: 2 }, batch([observation('7', '2026-11-15T21:25:00+00:00')])]) {
    assert.ok((await mergeLive(base, input)).reason);
  }
  const { snapshot } = await mergeLive(base, batch([observation('7')]));
  assert.ok((await mergeLive(snapshot, batch([observation('8')]))).reason);
});

test('CLI exits 0 and leaves the file untouched when the batch is missing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'merge-live-'));
  const file = path.join(dir, 'snapshot.json');
  writeFileSync(file, JSON.stringify(base));
  const before = readFileSync(file, 'utf8');
  execFileSync(process.execPath, [path.join(import.meta.dirname, 'merge-live.mjs'), '--base', file, '--batch', path.join(dir, 'none.json')]);
  assert.equal(readFileSync(file, 'utf8'), before);
});
