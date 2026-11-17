// The one guarantee the deploy depends on: a bad private batch never changes the ALIO snapshot or another source.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { mergeFiles, mergeLive } from './merge-live.mjs';

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

const saraminItem = (id, observedAt = '2026-11-16T21:30:00+00:00') => ({
  externalId: id, url: `https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=${id}`, observedAt,
  extractorVersion: 'saramin-list/1', query: '백엔드', page: 1, tags: ['백엔드/서버개발'], tagsTruncated: false, warnings: [],
  fields: { company: field('회사'), title: field('백엔드 개발자'), location: field('서울 강남구'), experience: field('신입'),
    deadline: field('~ 11/30(월)'), education: field('학력무관'), employment: field('정규직') },
});

test('merges several sources in order; a bad or stale one is skipped without dropping the others', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'merge-files-'));
  const write = (name, value) => { const file = path.join(dir, name); writeFileSync(file, JSON.stringify(value)); return file; };
  const files = [write('jk.json', batch([observation('7')])), path.join(dir, 'missing.json'),
    write('stale.json', { version: 1, source: 'saramin', jobs: [saraminItem('9', '2026-11-15T21:30:00+00:00')] }),
    write('sr.json', { version: 1, source: 'saramin', jobs: [saraminItem('9')] }), write('other.json', { ...batch([]), source: 'wanted' })];
  const { snapshot, lines } = await mergeFiles(base, files);
  assert.deepEqual(snapshot.jobs.map(job => [job.id, job.role]), [['alio:1', '백엔드'], ['jobkorea:7', ''], ['saramin:9', '백엔드']]);
  assert.deepEqual(snapshot.sources.map(s => s.name), ['alio', 'jobkorea', 'saramin']);
  assert.equal(lines.filter(line => line.includes('skipped')).length, 3, lines.join('\n'));
  assert.equal((await mergeFiles(base, [files[1]])).snapshot, null);
});
