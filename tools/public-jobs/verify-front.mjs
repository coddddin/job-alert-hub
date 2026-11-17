/**
 * One browser pass over the real user flow on the existing jobs screen.
 *
 *   node tools/public-jobs/verify-front.mjs --combined merged.json --base alio.json [--shots DIR]
 *
 * Needs Playwright (preinstalled in the dev container; not a repo dependency). It never
 * fetches remote sites: both snapshots are served locally by the production server routes.
 * Prints a JSON record of every checked step; exits 1 on the first failed expectation.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createServer } from '../../apps/web/server.mjs';
import { normalizeJob } from '../../apps/web/lib/normalize-job.js';
import { matchJob, notificationCandidates } from '../../apps/web/lib/matching.js';
import { initialState } from '../../apps/web/lib/state.js';

const { values } = parseArgs({ options: { combined: { type: 'string' }, base: { type: 'string' }, shots: { type: 'string' } } });
if (!values.combined || !values.base) throw new Error('Usage: verify-front.mjs --combined merged.json --base alio.json');
const { chromium } = createRequire(import.meta.url)('playwright');
const snapshot = JSON.parse(await readFile(values.combined, 'utf8'));
const count = name => snapshot.jobs.filter(job => job.id.startsWith(`${name}:`)).length;
const privateSources = snapshot.sources.map(source => source.name).filter(name => name !== 'alio');
const TAGS = { jobkorea: '잡코리아', saramin: '사람인' };
// Independent expectation for the personal tab and alerts: the same library rules applied in Node.
const normalized = snapshot.jobs.map(job => normalizeJob({ ...job, skills: job.tags ?? [] }, snapshot.today));
const filters = { ...initialState().filters, region: '서울' };
const expectedMatch = name => normalized.filter(job => job.id.startsWith(`${name}:`) && matchJob(job, filters).status === 'match').length;
const expectedAlerts = name => notificationCandidates(normalized, initialState().notifications).filter(job => job.id.startsWith(`${name}:`)).length;
const log = {};

async function serve(file) {
  const server = createServer({ snapshot: file });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}
const rows = page => page.locator('#job-list tr:not(.empty)').count();
const shot = (page, name) => values.shots && page.screenshot({ path: path.join(values.shots, `${name}.png`), fullPage: false });

const browser = await chromium.launch();
const combined = await serve(values.combined);
const alioOnly = await serve(values.base);
try {
  // ALIO-only reference: the previous start tab and personal results.
  const ref = await (await browser.newContext()).newPage();
  await ref.goto(alioOnly.url);
  await ref.waitForSelector('#job-list tr');
  assert.equal(await ref.locator('[data-tab="match"]').getAttribute('aria-selected'), 'true');
  assert.equal(await ref.locator('#source-filter').isHidden(), true);
  const refMatch = Number(await ref.textContent('#tab-match'));
  await ref.click('[data-view="alerts"]');
  const refAlerts = await ref.locator('#alert-preview li:not(.muted)').count();
  log.alioOnly = { startTab: 'match', sourceFilterHidden: true, match: refMatch, alerts: refAlerts };

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(combined.url);
  await page.waitForSelector('#job-list tr');

  // 1. Load: both sources, with per-source collection time and no stale marker.
  const edition = await page.textContent('#edition');
  const colophon = await page.textContent('#colophon-note');
  for (const source of snapshot.sources) assert.ok(edition.includes(source.label), edition);
  assert.ok(!edition.includes('오래된 데이터'), edition);
  assert.equal((colophon.match(/수집/g) ?? []).length, snapshot.sources.length, colophon);
  assert.equal(Number(await page.textContent('#tab-all')), snapshot.jobs.length);
  assert.equal(await rows(page), snapshot.jobs.length);
  log.load = { edition, colophon, startTab: 'all', rows: snapshot.jobs.length };
  await shot(page, '1-load');

  // 2. Source filter, with the short source tag on every row.
  const perSource = {};
  for (const { name } of snapshot.sources) {
    await page.selectOption('#filter-source', name);
    perSource[name] = await rows(page);
    assert.equal(perSource[name], count(name));
    if (TAGS[name]) assert.equal(await page.locator(`#job-list .source-tag[data-source="${name}"]`).count(), count(name));
  }
  log.sourceFilter = perSource;

  // 3-4. Per private source: search a real job by company, open its detail, check the original link.
  log.search = {};
  log.detail = {};
  for (const name of privateSources) {
    await page.selectOption('#filter-source', name);
    const target = snapshot.jobs.find(job => job.id.startsWith(`${name}:`));
    await page.fill('input[name="keyword"]', target.company);
    const hits = await rows(page);
    assert.ok(hits >= 1);
    assert.ok(await page.locator(`[data-detail="${target.id}"]`).isVisible());
    assert.equal(await page.locator(`[data-detail="${target.id}"]`).locator('xpath=..').locator('.source-tag').textContent(), TAGS[name]);
    log.search[name] = { keyword: target.company, hits };
    await shot(page, `3-search-${name}`);
    await page.click(`[data-detail="${target.id}"]`);
    await page.waitForSelector('#job-dialog[open]');
    const dialog = await page.textContent('#dialog-content');
    assert.ok(dialog.includes(target.title) && dialog.includes(TAGS[name]), dialog);
    const hrefs = await page.locator('#dialog-content a[href]').evaluateAll(links => links.map(link => link.href));
    assert.ok(hrefs.includes(target.url), JSON.stringify(hrefs));
    log.detail[name] = { id: target.id, title: target.title, originalLink: target.url };
    await shot(page, `4-detail-${name}`);
    await page.click('#close-dialog');
    await page.fill('input[name="keyword"]', '');
  }
  const target = snapshot.jobs.find(job => job.id.startsWith(`${privateSources.at(-1)}:`));
  await page.selectOption('#filter-source', privateSources.at(-1));

  // 5. Scrap, then confirm it survives a reload and appears in the saved view.
  await page.click(`[data-save="${target.id}"]`);
  assert.equal(await page.locator(`[data-save="${target.id}"]`).getAttribute('aria-pressed'), 'true');
  await page.reload();
  await page.waitForSelector('#job-list tr');
  await page.click('[data-view="saved"]');
  await page.click('[data-tab="all"]');
  assert.equal(await page.textContent('#saved-count'), '1');
  assert.ok(await page.locator(`[data-detail="${target.id}"]`).isVisible());
  log.scrap = { id: target.id, savedCount: 1, persistedAfterReload: true };

  // 6. Personal tab and alerts: ALIO results equal the ALIO-only reference; private jobs enter
  // only when classified as development (unclassified JobKorea stays out).
  await page.click('[data-view="feed"]');
  await page.click('#reset-filters');
  await page.selectOption('#filter-region', '서울');
  await page.click('[data-tab="match"]');
  const match = Number(await page.textContent('#tab-match'));
  const inMatch = { alio: await page.locator('#job-list [data-detail^="alio:"]').count() };
  for (const name of privateSources) {
    inMatch[name] = await page.locator(`#job-list [data-detail^="${name}:"]`).count();
    assert.equal(inMatch[name], expectedMatch(name), name);
  }
  assert.equal(inMatch.alio, refMatch);
  assert.equal(match, Object.values(inMatch).reduce((a, b) => a + b, 0));
  await page.click('[data-view="alerts"]');
  const alerts = await page.locator('#alert-preview li:not(.muted)').count();
  const privateAlerts = Object.fromEntries(privateSources.map(name => [name, expectedAlerts(name)]));
  assert.equal(alerts, refAlerts + Object.values(privateAlerts).reduce((a, b) => a + b, 0));
  log.regression = { match, inMatch, alerts, privateAlerts, alioAlertsUnchanged: refAlerts };

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, ...log }, null, 2));
} finally {
  await browser.close();
  combined.server.close();
  alioOnly.server.close();
}
