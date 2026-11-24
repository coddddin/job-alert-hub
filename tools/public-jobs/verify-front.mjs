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
import { defaults, matchJob, notificationCandidates } from '../../apps/web/lib/matching.js';
import { initialState } from '../../apps/web/lib/state.js';
import { FAMILIES } from '../../apps/web/lib/taxonomy.js';

const { values } = parseArgs({ options: { combined: { type: 'string' }, base: { type: 'string' }, shots: { type: 'string' } } });
if (!values.combined || !values.base) throw new Error('Usage: verify-front.mjs --combined merged.json --base alio.json');
const { chromium } = createRequire(import.meta.url)('playwright');
const snapshot = JSON.parse(await readFile(values.combined, 'utf8'));
const count = name => snapshot.jobs.filter(job => job.id.startsWith(`${name}:`)).length;
const log = {};
const privateSources = snapshot.sources.map(source => source.name).filter(name => name !== 'alio');
const TAGS = { jobkorea: '잡코리아', saramin: '사람인' };
// Independent expectation for the personal tab and alerts: the same library rules applied in Node,
// with the filters the page sets from a first-visit answer (app.js applyProfile).
const normalized = snapshot.jobs.map(job => normalizeJob({ ...job, skills: job.tags ?? [] }, snapshot.today));
const familyIds = labels => labels.map(label => FAMILIES.find(family => family.label === label).id);
const profileFilters = ({ families, career, region }) => ({ family: 'mine', families: familyIds(families), career, region, role: 'all' });
const expectedMatch = (name, profile) => normalized.filter(job => job.id.startsWith(`${name}:`) &&
  matchJob(job, { ...defaults, ...profileFilters(profile) }).status === 'match').length;
const expectedAlerts = (name, profile) => notificationCandidates(normalized, { ...initialState().notifications, ...profileFilters(profile) })
  .filter(job => job.id.startsWith(`${name}:`)).length;
const sum = values => values.reduce((a, b) => a + b, 0);

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

  // 6. Personal tab and alerts with the same first-visit answers as ALIO-only: ALIO results are unchanged,
  //    private jobs enter only as the same library rules say, and JobKorea rows are always rule-classified IT.
  const byId = new Map(snapshot.jobs.map(job => [job.id, job]));
  const jobkoreaRows = page => page.locator('#job-list [data-detail^="jobkorea:"]').evaluateAll(rows => rows.map(row => row.dataset.detail));
  const assertRuleIt = ids => {
    for (const id of ids) {
      const job = byId.get(id);
      assert.equal(job.kind, 'development', id);
      assert.ok(job.families?.includes('it'), id);
      // 키워드 규칙 또는 사이트 직무 키워드(두 번째 근거)로 정한 IT만. 미분류·모델 추정은 맞춤에 오지 않는다.
      assert.ok(['rule', 'source-tag'].includes(job.classification?.method), id);
      assert.ok(!job.classification.nonHiring, id);
    }
  };
  await page.click('[data-view="feed"]');
  await page.selectOption('#filter-source', 'all');
  await page.click('#open-onboarding');
  await answer(page, IT_NEW_SEOUL);
  assert.equal(await page.locator('[data-tab="match"]').getAttribute('aria-selected'), 'true');
  const match = Number(await page.textContent('#tab-match'));
  const inMatch = { alio: await page.locator('#job-list [data-detail^="alio:"]').count() };
  for (const name of privateSources) {
    inMatch[name] = await page.locator(`#job-list [data-detail^="${name}:"]`).count();
    assert.equal(inMatch[name], expectedMatch(name, IT_NEW_SEOUL), name);
  }
  assert.equal(inMatch.alio, refMatch);
  assertRuleIt(await jobkoreaRows(page));
  assert.equal(match, sum(Object.values(inMatch)));
  await page.click('[data-view="alerts"]');
  const alerts = await page.locator('#alert-preview li:not(.muted)').count();
  const privateAlerts = Object.fromEntries(privateSources.map(name => [name, expectedAlerts(name, IT_NEW_SEOUL)]));
  assert.equal(alerts, refAlerts + sum(Object.values(privateAlerts)));
  log.regression = { match, inMatch, alerts, privateAlerts, alioAlertsUnchanged: refAlerts };

  // 7. A non-IT user: only their job family reaches the personal tab, and the answer survives a reload.
  await page.click('[data-view="feed"]');
  await page.click('#open-onboarding');
  const MEDICAL = { families: ['의료·보건·복지'], career: 'any', region: 'all' };
  await answer(page, MEDICAL);
  const medical = await page.locator('#job-list [data-detail]').evaluateAll(buttons => buttons.map(b => b.dataset.detail));
  // Saramin fills families from site tags, so its medical postings reach a medical profile too.
  const saraminMedical = medical.filter(id => id.startsWith('saramin:')).length;
  if (privateSources.includes('saramin')) assert.equal(saraminMedical, expectedMatch('saramin', MEDICAL));
  assert.ok(medical.length > 0);
  assert.ok(medical.every(id => byId.get(id)?.families?.includes('medical')), 'non-medical job in personal tab');
  await shot(page, '7-medical');
  await page.reload();
  await page.waitForSelector('#job-list tr');
  assert.equal(await page.locator('#onboarding').isVisible(), false);
  assert.match(await page.textContent('#filter-family'), /내 관심 직무 \(의료·보건·복지\)/);
  log.personalized = { profile: '의료·보건·복지/상관없음/전국', match: medical.length, saraminMedical, allMedical: true, persistedAfterReload: true };

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
