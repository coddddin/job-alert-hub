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

const { values } = parseArgs({ options: { combined: { type: 'string' }, base: { type: 'string' }, shots: { type: 'string' } } });
if (!values.combined || !values.base) throw new Error('Usage: verify-front.mjs --combined merged.json --base alio.json');
const { chromium } = createRequire(import.meta.url)('playwright');
const snapshot = JSON.parse(await readFile(values.combined, 'utf8'));
const count = name => snapshot.jobs.filter(job => job.id.startsWith(`${name}:`)).length;
const log = {};

async function serve(file) {
  const server = createServer({ snapshot: file });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}
const rows = page => page.locator('#job-list tr:not(.empty)').count();
/** 첫 방문 질문에 답한다. families는 화면 라벨, region은 시·도 또는 'all'. */
async function answer(page, { families, career, region }) {
  await page.waitForSelector('#onboarding[open]');
  for (const box of await page.locator('#onboarding-families input').all()) await box.setChecked(false);
  for (const label of families) await page.locator('#onboarding-families label', { hasText: label }).locator('input').check();
  await page.locator(`#onboarding-careers input[value="${career}"]`).check();
  await page.selectOption('#onboarding-region', region);
  await page.click('#onboarding-form button[type="submit"]');
  await page.waitForSelector('#onboarding', { state: 'hidden' });
}
const IT_NEW_SEOUL = { families: ['IT·개발'], career: 'new', region: '서울' };
const shot = (page, name) => values.shots && page.screenshot({ path: path.join(values.shots, `${name}.png`), fullPage: false });

const browser = await chromium.launch();
const combined = await serve(values.combined);
const alioOnly = await serve(values.base);
try {
  // ALIO-only reference: the previous start tab and personal results.
  const ref = await (await browser.newContext()).newPage();
  await ref.goto(alioOnly.url);
  await ref.waitForSelector('#job-list tr');
  await answer(ref, IT_NEW_SEOUL);
  assert.equal(await ref.locator('[data-tab="match"]').getAttribute('aria-selected'), 'true');
  assert.equal(await ref.locator('#source-filter').isHidden(), true);
  const refMatch = Number(await ref.textContent('#tab-match'));
  await ref.click('[data-view="alerts"]');
  const refAlerts = await ref.locator('#alert-preview li:not(.muted)').count();
  log.alioOnly = { profile: 'IT·개발/신입/서울', startTab: 'match', sourceFilterHidden: true, match: refMatch, alerts: refAlerts };

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(combined.url);
  await page.waitForSelector('#job-list tr');
  // 0. 첫 방문: 질문이 열리고, 건너뛰면 전체 공고를 둘러본다.
  assert.equal(await page.locator('#onboarding').isVisible(), true);
  await shot(page, '0-onboarding');
  await page.click('#onboarding-skip');
  // Skipping applies the "browse everything" profile when the dialog's close event fires; wait for it
  // (otherwise the default IT filter can still be in place for a moment).
  await page.waitForFunction(() => document.querySelector('#filter-family')?.value === 'all');

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

  // 2. Source filter.
  const perSource = {};
  for (const { name } of snapshot.sources) {
    await page.selectOption('#filter-source', name);
    perSource[name] = await rows(page);
    assert.equal(perSource[name], count(name));
  }
  log.sourceFilter = perSource;

  // 3. Search a real private job by company name within the JobKorea source.
  await page.selectOption('#filter-source', 'jobkorea');
  const target = snapshot.jobs.find(job => job.id.startsWith('jobkorea:'));
  await page.fill('input[name="keyword"]', target.company);
  const hits = await rows(page);
  assert.ok(hits >= 1);
  assert.ok(await page.locator(`[data-detail="${target.id}"]`).isVisible());
  log.search = { keyword: target.company, hits };
  await shot(page, '3-search');

  // 4. Detail and original link.
  await page.click(`[data-detail="${target.id}"]`);
  await page.waitForSelector('#job-dialog[open]');
  const dialog = await page.textContent('#dialog-content');
  assert.ok(dialog.includes(target.title) && dialog.includes('잡코리아'));
  const hrefs = await page.locator('#dialog-content a[href]').evaluateAll(links => links.map(link => link.href));
  assert.ok(hrefs.includes(target.url), JSON.stringify(hrefs));
  log.detail = { id: target.id, title: target.title, originalLink: target.url };
  await shot(page, '4-detail');
  await page.click('#close-dialog');

  // 5. Scrap, then confirm it survives a reload and appears in the saved view.
  await page.click(`[data-save="${target.id}"]`);
  assert.equal(await page.locator(`[data-save="${target.id}"]`).getAttribute('aria-pressed'), 'true');
  await page.reload();
  await page.waitForSelector('#job-list tr');
  await page.click('[data-view="saved"]');
  await page.click('[data-tab="all"]');
  assert.equal(await page.textContent('#saved-count'), '1');
  assert.ok(await page.locator(`[data-detail="${target.id}"]`).isVisible());
  log.scrap = { savedCount: 1, persistedAfterReload: true };

  // 6. Personal tab and alerts with the same first-visit answers as ALIO-only: ALIO results are unchanged,
  //    and only rule-classified JobKorea IT jobs join them (unclassified or non-IT rows never do).
  const byId = new Map(snapshot.jobs.map(job => [job.id, job]));
  const jobkoreaRows = page => page.locator('#job-list [data-detail^="jobkorea:"]').evaluateAll(rows => rows.map(row => row.dataset.detail));
  const assertRuleIt = ids => {
    for (const id of ids) {
      const job = byId.get(id);
      assert.equal(job.kind, 'development', id);
      assert.ok(job.families?.includes('it'), id);
      assert.equal(job.classification?.method, 'rule', id);
      assert.ok(!job.classification.nonHiring, id);
    }
  };
  await page.click('[data-view="feed"]');
  await page.click('#open-onboarding');
  await answer(page, IT_NEW_SEOUL);
  assert.equal(await page.locator('[data-tab="match"]').getAttribute('aria-selected'), 'true');
  const match = Number(await page.textContent('#tab-match'));
  const alioInMatch = await page.locator('#job-list [data-detail^="alio:"]').count();
  const matched = await jobkoreaRows(page);
  assert.equal(alioInMatch, refMatch);
  assert.equal(match, refMatch + matched.length);
  assertRuleIt(matched);
  await page.click('[data-view="alerts"]');
  const alerts = await page.locator('#alert-preview li:not(.muted)').count();
  assert.ok(alerts >= refAlerts, `${alerts} < ${refAlerts}`);
  log.regression = { match, alioInMatch, refMatch, alerts, refAlerts, jobkoreaInMatch: matched.length };

  // 7. A non-IT user: only their job family reaches the personal tab, and the answer survives a reload.
  await page.click('[data-view="feed"]');
  await page.click('#open-onboarding');
  await answer(page, { families: ['의료·보건·복지'], career: 'any', region: 'all' });
  const medical = await page.locator('#job-list [data-detail]').evaluateAll(buttons => buttons.map(b => b.dataset.detail));
  assert.ok(medical.length > 0);
  assert.ok(medical.every(id => byId.get(id)?.families?.includes('medical')), 'non-medical job in personal tab');
  await shot(page, '7-medical');
  await page.reload();
  await page.waitForSelector('#job-list tr');
  assert.equal(await page.locator('#onboarding').isVisible(), false);
  assert.match(await page.textContent('#filter-family'), /내 관심 직무 \(의료·보건·복지\)/);
  log.personalized = { profile: '의료·보건·복지/상관없음/전국', match: medical.length, allMedical: true, persistedAfterReload: true };

  // 8. IT, new graduate, any region: a JobKorea IT job open to new graduates reaches the personal tab,
  //    and its detail shows the source. (Seoul alone may have none: many are experienced-only.)
  await page.click('[data-view="feed"]');
  await page.click('#open-onboarding');
  await answer(page, { ...IT_NEW_SEOUL, region: 'all' });
  const anyRegion = await jobkoreaRows(page);
  assertRuleIt(anyRegion);
  const open = snapshot.jobs.filter(job => job.id.startsWith('jobkorea:') && job.families?.includes('it') &&
    !job.classification?.nonHiring && /경력무관|신입/u.test(job.raw?.experience ?? ''));
  if (open.length) {
    assert.ok(anyRegion.length >= 1, 'JobKorea IT jobs missing from the personal tab');
    await page.click(`[data-detail="${anyRegion[0]}"]`);
    await page.waitForSelector('#job-dialog[open]');
    assert.ok((await page.textContent('#dialog-content')).includes('잡코리아'));
    await page.click('#close-dialog');
  } else assert.equal(anyRegion.length, 0);
  log.jobkoreaMatch = { profile: 'IT·개발/신입/전국', jobkoreaInMatch: anyRegion.length, openItJobs: open.length,
    roles: anyRegion.map(id => byId.get(id).role) };
  await shot(page, '8-match-jobkorea');

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, ...log }, null, 2));
} finally {
  await browser.close();
  combined.server.close();
  alioOnly.server.close();
}
