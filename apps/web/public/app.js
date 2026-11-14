import { loadJobs } from './lib/load-jobs.js';
import { defaults, matchJob, matchesCatalogFilters, notificationCandidates, REGIONS, ROLES } from './lib/matching.js';
import { initialState, sanitizeState, storageKey } from './lib/state.js';
import { calendarUrl, EDUCATION, PERIODS } from './lib/calendar.js';
import { siteLinks } from './lib/site-links.js';

const data = await loadJobs({ search: location.search });
const { jobs, today } = data;
const live = data.mode === 'live';
const sourceKey = job => job.id.split(':')[0];
const sourceNames = new Map(data.sources.map(source => [source.name, source.label]));
const sourceName = job => sourceNames.get(sourceKey(job)) ?? job.source;
const catalog = live && jobs.some(job => sourceKey(job) === 'jobkorea');

const $ = selector => document.querySelector(selector);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const statusLabel = { match: '일치', review: '확인', exclude: '제외' };

let state = initialState();
let storageAvailable = true;
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  state = sanitizeState(saved);
  if (catalog && !saved?.filters) state.filters.region = 'all';
} catch { storageAvailable = false; }
let view = 'feed';
let tab = catalog ? 'all' : 'match';
let toastTimer;

if (catalog) {
  const select = $('#filter-source');
  for (const job of jobs) {
    const key = sourceKey(job);
    if (Array.from(select.options).some(option => option.value === key)) continue;
    const option = document.createElement('option');
    option.value = key;
    option.textContent = sourceName(job);
    select.append(option);
  }
  $('#source-filter').hidden = false;
  document.querySelector('[data-tab="all"]').hidden = false;
  select.addEventListener('change', render);
}

for (const select of [$('#filter-role'), $('#alert-role')]) {
  select.innerHTML = ROLES.map(role => `<option value="${role}">${role === 'all' ? '분야 전체' : role}</option>`).join('');
}
for (const select of document.querySelectorAll('select[name="region"]')) {
  select.innerHTML = REGIONS.map(region => `<option value="${region}">${region === 'all' ? '지역 전체' : region}</option>`).join('');
}

// ---------- 표시용 계산 ----------
const DAY = 86_400_000;
const toTime = iso => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
function daysLeft(job) { return job.deadline ? Math.round((toTime(job.deadline) - toTime(today)) / DAY) : null; }
function ddayLabel(job) {
  const days = daysLeft(job);
  if (days === null) return job.deadlineKind === 'unknown' ? '?' : '상시';
  return days === 0 ? 'D-day' : days > 0 ? `D-${days}` : '마감';
}
function koreanDate(iso) {
  const date = new Date(toTime(iso));
  return `${date.getUTCFullYear()}년 ${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일 ${'일월화수목금토'[date.getUTCDay()]}요일`;
}
function shortDate(iso) { return `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`; }

function describeExperience({ kind, range }) {
  const min = range && range.min ? ` ${range.min.years}년 ${range.min.inclusive ? '이상' : '초과'}` : '';
  return ({ new: '신입', 'new-or-experienced': '신입·경력' + min, any: '경력무관', experienced: '경력' + min, unknown: '해석 불가' })[kind];
}
function describeLocation(location) {
  const places = location.places.map(place => [place.sido, place.sigungu].filter(Boolean).join(' / '));
  const label = places.length > 1 ? `${[...new Set(location.places.map(place => place.sido))].join(' · ')} (${places.length}곳)` : places[0];
  const extras = [location.nationwide && '전국', location.remote === 'full' && '재택', location.remote === 'partial' && '재택 병행', location.others && `외 ${location.others === 'unknown' ? '다수' : location.others + '곳'}`].filter(Boolean);
  return [label, ...extras].filter(Boolean).join(' · ') || '해석 불가';
}
function describeDeadline(deadline) {
  if (deadline.kind === 'date') return shortDate(deadline.date) + (deadline.time ? ' ' + deadline.time : '');
  return ({ rolling: '상시 채용', 'until-filled': '마감일 없음', unknown: '해석 불가' })[deadline.kind];
}
function parseRate() {
  const fields = jobs.flatMap(job => [describeExperience(job.parsed.experience), describeLocation(job.parsed.location), describeDeadline(job.parsed.deadline)]);
  const ok = fields.filter(label => label !== '해석 불가').length;
  return { percent: Math.round((ok / fields.length) * 1000) / 10, ok, total: fields.length };
}
// 사용자에게는 해석한 값만 보여준다. 공고 표기는 해석하지 못했을 때만(무엇을 확인해야 하는지 알 수 있게),
// 또는 개발용 `?raw`를 붙였을 때만 함께 보여준다.
const showRaw = new URLSearchParams(location.search).has('raw');
if (showRaw) document.documentElement.classList.add('show-raw');
const UNKNOWN = '해석 불가';
const valueCell = (raw, parsed, cls) => {
  const unknown = parsed === UNKNOWN;
  return `<td class="${cls}"><span class="parsed${unknown ? ' unknown' : ''}">${unknown ? '확인 필요' : escape(parsed)}</span><span class="raw${unknown ? ' keep' : ''}">“${escape(raw)}”</span></td>`;
};

// ---------- 렌더링 ----------
function row(job, result) {
  const saved = state.bookmarks.includes(job.id);
  const calm = daysLeft(job) === null || result.status === 'exclude';
  return `<tr class="${result.status}">
    <td class="cell-dday"><span class="dday${calm ? ' calm' : ''}">${ddayLabel(job)}</span></td>
    <td class="cell-title"><div class="title-row"><button class="job-title" data-detail="${escape(job.id)}">${escape(job.title)}</button><button class="save" data-save="${escape(job.id)}" aria-pressed="${saved}" aria-label="${escape(job.company)} 스크랩">${saved ? '◆' : '◇'}</button></div><span class="sub">${[job.company, live && sourceName(job), job.role, job.skills.join(', '), state.applications[job.id]].filter(Boolean).map(escape).join(' · ')}</span></td>
    ${valueCell(job.raw.experience, describeExperience(job.parsed.experience), 'cell-exp')}
    ${valueCell(job.raw.location, describeLocation(job.parsed.location), 'cell-loc')}
    ${valueCell(job.raw.deadline, describeDeadline(job.parsed.deadline), 'cell-ddl')}
    <td class="cell-status"><span class="tag ${result.status}">${statusLabel[result.status]}</span>${result.status === 'exclude' ? `<span class="reason">${escape(result.reason)}</span>` : ''}</td>
  </tr>`;
}

function render() {
  const results = jobs.map(job => ({ job, result: matchJob(job, state.filters) }));
  const source = $('#filter-source').value;
  const scoped = results.filter(({ job }) =>
    (source === 'all' || sourceKey(job) === source) &&
    (view !== 'saved' || state.bookmarks.includes(job.id)));
  const browse = scoped.filter(({ job }) => matchesCatalogFilters(job, state.filters));
  const count = status => scoped.filter(x => x.result.status === status).length;
  const match = count('match');
  const soon = scoped.filter(x => x.result.status === 'match' && daysLeft(x.job) !== null && daysLeft(x.job) <= 7).length;
  const rate = parseRate();

  $('#edition').textContent = live
    ? `${koreanDate(today)} · 수집 공고 ${jobs.length}건 · ${data.sources.map(source => source.label).join(' · ')}`
    : `${koreanDate(today)} · 샘플 공고 ${jobs.length}건 (가상 데이터)`;
  $('#feed-title').textContent = view === 'saved' ? `스크랩한 공고 ${scoped.length}건` : tab === 'all' ? `공고 ${browse.length}건` : `공고 ${scoped.length}건 중, 지금 지원할 ${match}건`;
  $('#feed-subtitle').textContent = view === 'saved'
    ? '스크랩한 공고에 현재 목록 필터를 적용했어요. 공고를 눌러 지원 상태를 기록해 보세요.'
    : tab === 'all' ? '출처별 공고를 검색하고, 상세에서 지원 조건과 원문을 확인하세요.'
    : `경력·근무지·마감 표기를 해석해 ${state.filters.region === 'all' ? '' : state.filters.region + '에서 '}신입이 지원할 수 있는 공고를 찾아요`;
  $('#match-count').textContent = match;
  $('#review-count').textContent = count('review');
  $('#parse-rate').textContent = `${rate.percent}%`;
  $('#parse-rate').title = `${rate.total}개 항목 중 ${rate.ok}개 해석`;
  $('#soon-count').textContent = soon;
  $('#tab-match').textContent = match;
  $('#tab-review').textContent = count('review');
  $('#tab-exclude').textContent = count('exclude');
  $('#tab-all').textContent = browse.length;
  document.querySelectorAll('[data-tab]').forEach(button => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $('#saved-count').textContent = state.bookmarks.filter(id => jobs.some(job => job.id === id)).length;

  const visible = (tab === 'all' ? browse : scoped.filter(x => x.result.status === tab))
    .sort((a, b) => (daysLeft(a.job) ?? Infinity) - (daysLeft(b.job) ?? Infinity));
  $('#job-list').innerHTML = visible.length
    ? visible.map(x => row(x.job, x.result)).join('')
    : `<tr class="empty"><td colspan="6">${view === 'saved' ? '이 탭에 해당하는 스크랩 공고가 없어요.' : '이 탭에 해당하는 공고가 없어요. 필터를 바꾸거나 위 사이트에서 같은 조건으로 찾아보세요.'}</td></tr>`;
  renderSiteLinks();
  $('#footnote').textContent = `* 원문 표기는 kr-job-parser로 해석합니다. 해석하지 못한 항목은 버리지 않고 확인 필요로 남깁니다. 해석률은 ${live ? '수집한' : '샘플'} ${jobs.length}건의 경력·근무지·마감 ${rate.total}개 항목 중 '해석 불가'가 아닌 비율이며, 정답과 맞는지(정확도)를 잰 값은 아닙니다. 다른 사이트 링크는 그 사이트의 검색 주소로 이동만 시키며, ≈ 표시는 그 사이트 분류가 더 넓어 조건이 일부 넓게 걸린다는 뜻입니다(링크에 마우스를 올리면 자세히).`;
  $('#colophon-note').textContent = live
    ? `출처: ${data.sources.map(source => source.label).join(', ')} · 수집 ${new Date(data.collectedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`
    : `샘플 기준일 ${today} · 실제 공고 아님`;
}

/** 다른 사이트의 공고는 가져오지 않는다. 지금 필터를 그 사이트 검색 주소로 옮겨 이동만 시킨다. */
function renderSiteLinks() {
  $('#site-links').innerHTML = siteLinks(state.filters).map(link => {
    const note = link.dropped.length ? `${link.name}에서는 ${link.dropped.join(', ')}` : `${link.name}에 같은 조건을 그대로 적용`;
    return `<li><a href="${escape(link.url)}" target="_blank" rel="noopener noreferrer" title="${escape(note)}">${escape(link.name)}<span aria-hidden="true"> ↗</span>${link.dropped.length ? '<span class="site-approx" aria-hidden="true">≈</span>' : ''}<span class="sr-only"> (새 창, ${escape(note)})</span></a></li>`;
  }).join('');
}

// 북마클릿은 `pnpm build`가 만든다. 아직 빌드하지 않았으면 설치 버튼만 숨기고 나머지는 그대로 쓴다.
import('./lib/bookmarklet.js').then(({ BOOKMARKLET, PARSER_VERSION }) => {
  const link = $('#bookmarklet-link');
  link.href = BOOKMARKLET;
  $('#bookmarklet-meta').textContent = `kr-job-parser ${PARSER_VERSION} 포함 · ${Math.round(BOOKMARKLET.length / 1024)}KB · 외부 스크립트를 불러오지 않음`;
  // 이 페이지에서 누르면 CSP가 막는다. 끌어다 놓는 버튼이라는 걸 알려 준다.
  link.addEventListener('click', event => { event.preventDefault(); toast('북마크바로 끌어다 놓은 뒤 잡코리아 화면에서 눌러 주세요.'); });
  $('#open-bookmarklet').hidden = false;
  $('#open-bookmarklet').addEventListener('click', () => $('#bookmarklet-dialog').showModal());
  $('#close-bookmarklet').addEventListener('click', () => $('#bookmarklet-dialog').close());
}).catch(() => {});

// ---------- 상태와 이벤트 ----------
function toast(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500);
}
function persist() {
  try { localStorage.setItem(storageKey, JSON.stringify(state)); storageAvailable = true; return true; }
  catch { storageAvailable = false; toast('브라우저 저장소를 사용할 수 없어 이번 화면에서만 유지됩니다.'); return false; }
}
function fillForm(form, values) {
  for (const [key, value] of Object.entries(values)) {
    const control = form.elements.namedItem(key);
    if (!control) continue;
    if (control.type === 'checkbox') control.checked = value; else control.value = value;
  }
}
function readForm(form) {
  const data = new FormData(form);
  return { role: data.get('role'), region: data.get('region'), keyword: data.get('keyword').trim(), includeUnspecified: data.has('includeUnspecified') };
}
function switchView(next) {
  view = next;
  $('#feed-view').hidden = next === 'alerts' || next === 'calendar';
  $('#alerts-view').hidden = next !== 'alerts';
  $('#calendar-view').hidden = next !== 'calendar';
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === next;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  if (next === 'alerts') { fillForm($('#alert-form'), state.notifications); preview(); }
  if (next === 'calendar') showCalendar();
  render();
}
// ---------- 공채달력 (잡코리아 제공 iframe) ----------
// 방문자 모두가 잡코리아 페이지를 불러오지 않도록, 탭을 처음 열 때만 주소를 넣는다.
const calendar = { period: 'month', edu: '5' };
function segmented(container, options, key) {
  container.innerHTML = options.map(option => `<button type="button" role="radio" data-${key}="${option.value}" aria-checked="${calendar[key] === option.value}">${option.label}</button>`).join('');
}
function showCalendar() {
  segmented($('#calendar-edu'), EDUCATION, 'edu');
  segmented($('#calendar-period'), PERIODS, 'period');
  const frame = $('#calendar-iframe');
  frame.classList.toggle('week', calendar.period === 'week');
  const src = calendarUrl(calendar);
  if (frame.getAttribute('src') !== src) frame.setAttribute('src', src);
}
$('#calendar-view').addEventListener('click', event => {
  const button = event.target.closest('[data-edu], [data-period]');
  if (!button) return;
  if (button.dataset.edu) calendar.edu = button.dataset.edu;
  if (button.dataset.period) calendar.period = button.dataset.period;
  showCalendar();
});
function preview() {
  const form = $('#alert-form');
  const matches = notificationCandidates(jobs, readForm(form));
  const channels = ['email', 'kakao'].filter(key => form.elements.namedItem(key).checked);
  $('#preview-caption').textContent = channels.length ? `입력한 조건에 맞는 샘플 공고 ${matches.length}건` : `선택한 채널이 없어요. 조건에 맞는 공고는 ${matches.length}건이에요.`;
  $('#alert-preview').innerHTML = matches.length
    ? matches.map(job => `<li>${escape(job.title)}<small>${escape(job.company)} · ${ddayLabel(job)} · ${escape(describeLocation(job.parsed.location))}</small></li>`).join('')
    : '<li class="muted">조건에 맞는 샘플 공고가 없어요.</li>';
}
/** 지원 버튼은 공고 상세(공고문·접수 안내)로, 기관 채용 페이지는 보조 링크로 둔다. */
function applyLinks(job) {
  const primary = job.applyUrl ?? job.url ?? null;
  return { primary, secondary: job.url && job.url !== primary ? job.url : null };
}
function applyBlock(job) {
  const { primary, secondary } = applyLinks(job);
  const days = daysLeft(job);
  const when = job.deadline ? `<strong>${ddayLabel(job)}</strong> · ${shortDate(job.deadline)} 마감` : job.deadlineKind === 'unknown' ? '마감일 확인 필요' : '상시 · 채용 시 마감';
  const urgent = days !== null && days >= 0 && days <= 3;
  if (job.closed) return `<div class="apply"><span class="apply-button" aria-disabled="true">마감된 공고예요</span><p class="apply-meta">${when}</p></div>`;
  if (!primary) return `<div class="apply"><span class="apply-button" aria-disabled="true">샘플 공고라 지원 링크가 없어요</span><p class="apply-meta">${when}</p></div>`;
  return `<div class="apply${urgent ? ' urgent' : ''}">
    <a class="apply-button" href="${escape(primary)}" target="_blank" rel="noopener noreferrer">${escape(job.source)}에서 지원하기 <span aria-hidden="true">↗</span></a>
    <p class="apply-meta">${when}${secondary ? ` · <a href="${escape(secondary)}" target="_blank" rel="noopener noreferrer">기관 채용 페이지</a>` : ''}</p>
  </div>`;
}
function factRow(label, value, { raw = null, note = '' } = {}) {
  if (!value) return '';
  const unknown = value === UNKNOWN;
  const body = unknown
    ? `확인 필요 <small>공고 표기 “${escape(raw)}”를 해석하지 못했어요</small>`
    : `${escape(value)}${note ? `<small>${escape(note)}</small>` : ''}${raw && showRaw ? ` <small class="raw-inline">“${escape(raw)}”</small>` : ''}`;
  return `<div><dt>${label}</dt><dd${unknown ? ' class="unknown"' : ''}>${body}</dd></div>`;
}
/** 지원 전에 확인할 조건: 경력·학력·근무지·마감·인원·고용 형태, 그리고 지원 자격 원문 */
function facts(job) {
  const d = job.details;
  const rows = [
    factRow('경력', describeExperience(job.parsed.experience), { raw: job.raw.experience }),
    d ? factRow('학력', d.minimumEducation ?? d.education.join(' · '), { note: d.education.length > 1 ? `분야별: ${d.education.join(' · ')}` : '' }) : '',
    factRow('근무지', describeLocation(job.parsed.location), { raw: job.raw.location }),
    factRow('마감', describeDeadline(job.parsed.deadline), { raw: job.raw.deadline }),
    d ? factRow('채용 인원', d.headcount ? `${d.headcount}명` : '') : '',
    factRow('고용 형태', job.employment),
    d ? factRow('우대', d.preferences) : factRow('모집', job.description),
  ];
  return `<dl class="facts">${rows.join('')}</dl>${requirements(d)}`;
}
const PREVIEW_LINES = 6;
/** "일반요건", "필수요건", "채용분야 응시자격"처럼 짧고 요건·자격으로 끝나는 줄은 소제목으로 본다. */
const SECTION = /^[^.,]{0,12}(?:요건|자격|사항|조건)$/;
function requirements(details) {
  const lines = details?.requirements ?? [];
  if (!lines.length) return '';
  const render = list => list.map(line => SECTION.test(line) ? `<li class="req-section">${escape(line)}</li>` : `<li>${escape(line)}</li>`).join('');
  const rest = lines.slice(PREVIEW_LINES);
  return `<section class="requirements" aria-labelledby="req-title"><h3 id="req-title">지원 자격</h3><ul>${render(lines.slice(0, PREVIEW_LINES))}</ul>${rest.length ? `<details><summary>${rest.length}줄 더 보기</summary><ul>${render(rest)}</ul></details>` : ''}<p class="muted small">공고 원문 그대로예요. 세부 조건은 지원하기에서 공고문을 확인하세요.</p></section>`;
}

fillForm($('#filter-form'), state.filters);
fillForm($('#alert-form'), state.notifications);
$('#filter-form').addEventListener('input', () => { state.filters = readForm($('#filter-form')); persist(); render(); });
$('#filter-form').addEventListener('submit', event => event.preventDefault());
$('#reset-filters').addEventListener('click', () => {
  state.filters = { ...defaults, ...(catalog ? { region: 'all' } : {}) };
  $('#filter-source').value = 'all';
  fillForm($('#filter-form'), state.filters); persist(); render();
});
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
  tab = button.dataset.tab;
  render();
}));
$('#alert-form').addEventListener('input', preview);
$('#alert-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = $('#alert-form');
  state.notifications = { ...readForm(form), frequency: form.elements.frequency.value, email: form.elements.email.checked, kakao: form.elements.kakao.checked };
  if (persist()) toast('알림 설정을 저장했어요. 실제 발송은 하지 않아요.');
  render();
});
$('#job-list').addEventListener('click', event => {
  const save = event.target.closest('[data-save]');
  if (save) {
    const id = save.dataset.save;
    state.bookmarks = state.bookmarks.includes(id) ? state.bookmarks.filter(value => value !== id) : [...state.bookmarks, id];
    persist(); render(); return;
  }
  const detail = event.target.closest('[data-detail]');
  if (!detail) return;
  const job = jobs.find(value => value.id === detail.dataset.detail);
  const head = `<span class="eyebrow">${live ? escape(sourceName(job)) : 'FICTIONAL JOB · 샘플 공고'}</span><h2>${escape(job.title)}</h2><p class="muted">${[job.company, job.employment].filter(Boolean).map(escape).join(' · ')}</p>`;
  const body = `${facts(job)}<p class="muted small">${escape(matchJob(job, state.filters).reason)}</p><label>내 지원 상태<select id="application-status">${['검토 중', '지원 예정', '지원 완료', '합격', '불합격', '지원 철회'].map(status => `<option${(state.applications[job.id] || '검토 중') === status ? ' selected' : ''}>${status}</option>`).join('')}</select></label>`;
  // 내용은 스크롤되고, 지원 버튼은 아래에 고정해 언제든 누를 수 있게 한다.
  $('#dialog-content').innerHTML = `<div class="dialog-scroll">${head}${body}</div>${applyBlock(job)}`;
  $('#application-status').addEventListener('change', event => { state.applications[job.id] = event.target.value; persist(); render(); });
  $('#job-dialog').showModal();
});
$('#close-dialog').addEventListener('click', () => $('#job-dialog').close());
render();
if (!storageAvailable) toast('저장된 설정을 읽을 수 없어 기본값으로 시작합니다.');
