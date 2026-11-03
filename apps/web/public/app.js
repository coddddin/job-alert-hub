import { loadJobs } from './lib/load-jobs.js';
import { defaults, matchJob, notificationCandidates } from './lib/matching.js';
import { initialState, sanitizeState, storageKey } from './lib/state.js';

const data = await loadJobs({ search: location.search });
const { jobs, today } = data;
const live = data.mode === 'live';

const $ = selector => document.querySelector(selector);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const roles = ['all', '프론트엔드', '백엔드', '풀스택', '모바일', '게임', '데이터·AI', '임베디드', '전산·IT'];
const statusLabel = { match: '일치', review: '확인', exclude: '제외' };

let state = initialState();
let storageAvailable = true;
try { state = sanitizeState(JSON.parse(localStorage.getItem(storageKey))); } catch { storageAvailable = false; }
let view = 'feed';
let tab = 'match';
let toastTimer;

for (const select of [$('#filter-role'), $('#alert-role')]) {
  select.innerHTML = roles.map(role => `<option value="${role}">${role === 'all' ? '분야 전체' : role}</option>`).join('');
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
const rawCell = (raw, parsed, cls) => `<td class="${cls}"><span class="raw">“${escape(raw)}”</span><span class="parsed${parsed === '해석 불가' ? ' unknown' : ''}">${escape(parsed)}</span></td>`;

// ---------- 렌더링 ----------
function row(job, result) {
  const saved = state.bookmarks.includes(job.id);
  const calm = daysLeft(job) === null || result.status === 'exclude';
  return `<tr class="${result.status}">
    <td class="cell-dday"><span class="dday${calm ? ' calm' : ''}">${ddayLabel(job)}</span></td>
    <td class="cell-title"><div class="title-row"><button class="job-title" data-detail="${job.id}">${escape(job.title)}</button><button class="save" data-save="${job.id}" aria-pressed="${saved}" aria-label="${escape(job.company)} 스크랩">${saved ? '◆' : '◇'}</button></div><span class="sub">${escape(job.company)} · ${escape(job.role)} · ${job.skills.map(escape).join(', ')}${state.applications[job.id] ? ' · ' + escape(state.applications[job.id]) : ''}</span></td>
    ${rawCell(job.raw.experience, describeExperience(job.parsed.experience), 'cell-exp')}
    ${rawCell(job.raw.location, describeLocation(job.parsed.location), 'cell-loc')}
    <td class="cell-ddl"><span class="raw">${escape(job.raw.deadline)}</span><span class="parsed${job.deadlineKind === 'unknown' ? ' unknown' : ''}">${escape(describeDeadline(job.parsed.deadline))}</span></td>
    <td class="cell-status"><span class="tag ${result.status}">${statusLabel[result.status]}</span>${result.status === 'exclude' ? `<span class="reason">${escape(result.reason)}</span>` : ''}</td>
  </tr>`;
}

function render() {
  const results = jobs.map(job => ({ job, result: matchJob(job, state.filters) }));
  const scoped = results.filter(({ job }) => view !== 'saved' || state.bookmarks.includes(job.id));
  const count = status => scoped.filter(x => x.result.status === status).length;
  const match = count('match');
  const soon = scoped.filter(x => x.result.status === 'match' && daysLeft(x.job) !== null && daysLeft(x.job) <= 7).length;
  const rate = parseRate();

  $('#edition').textContent = live
    ? `${koreanDate(today)} · 공공기관 공고 ${jobs.length}건 · 잡알리오 실데이터`
    : `${koreanDate(today)} · 샘플 공고 ${jobs.length}건 (가상 데이터)`;
  $('#feed-title').textContent = view === 'saved' ? `스크랩한 공고 ${scoped.length}건` : `공고 ${jobs.length}건 중, 지금 지원할 ${match}건`;
  $('#feed-subtitle').textContent = view === 'saved'
    ? '스크랩한 공고에 현재 목록 필터를 적용했어요. 공고를 눌러 지원 상태를 기록해 보세요.'
    : `경력·근무지·마감 표기를 해석해 ${state.filters.region === 'all' ? '' : state.filters.region + '에서 '}신입이 지원할 수 있는 공고만 남겼어요`;
  $('#match-count').textContent = match;
  $('#review-count').textContent = count('review');
  $('#parse-rate').textContent = `${rate.percent}%`;
  $('#parse-rate').title = `${rate.total}개 항목 중 ${rate.ok}개 해석`;
  $('#soon-count').textContent = soon;
  $('#tab-match').textContent = match;
  $('#tab-review').textContent = count('review');
  $('#tab-exclude').textContent = count('exclude');
  $('#saved-count').textContent = state.bookmarks.filter(id => jobs.some(job => job.id === id)).length;

  const visible = scoped.filter(x => x.result.status === tab)
    .sort((a, b) => (daysLeft(a.job) ?? Infinity) - (daysLeft(b.job) ?? Infinity));
  $('#job-list').innerHTML = visible.length
    ? visible.map(x => row(x.job, x.result)).join('')
    : `<tr class="empty"><td colspan="6">${view === 'saved' ? '이 탭에 해당하는 스크랩 공고가 없어요.' : '이 탭에 해당하는 공고가 없어요. 필터를 바꿔 보세요.'}</td></tr>`;
  $('#footnote').textContent = `* 원문 표기는 kr-job-parser로 해석합니다. 해석하지 못한 항목은 버리지 않고 확인 필요로 남깁니다. 해석 성공률은 ${live ? '수집한' : '샘플'} ${jobs.length}건의 경력·근무지·마감 ${rate.total}개 항목 기준입니다.`;
  $('#colophon-note').textContent = live
    ? `출처: ${data.sources.map(source => source.label).join(', ')} · 수집 ${new Date(data.collectedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`
    : `샘플 기준일 ${today} · 실제 공고 아님`;
}

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
  $('#feed-view').hidden = next === 'alerts';
  $('#alerts-view').hidden = next !== 'alerts';
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === next;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  if (next === 'alerts') { fillForm($('#alert-form'), state.notifications); preview(); }
  render();
}
function preview() {
  const form = $('#alert-form');
  const matches = notificationCandidates(jobs, readForm(form));
  const channels = ['email', 'kakao'].filter(key => form.elements.namedItem(key).checked);
  $('#preview-caption').textContent = channels.length ? `입력한 조건에 맞는 샘플 공고 ${matches.length}건` : `선택한 채널이 없어요. 조건에 맞는 공고는 ${matches.length}건이에요.`;
  $('#alert-preview').innerHTML = matches.length
    ? matches.map(job => `<li>${escape(job.title)}<small>${escape(job.company)} · ${ddayLabel(job)} · ${escape(describeLocation(job.parsed.location))}</small></li>`).join('')
    : '<li class="muted">조건에 맞는 샘플 공고가 없어요.</li>';
}
function parsedTable(job) {
  const rows = [['경력', job.raw.experience, describeExperience(job.parsed.experience)], ['근무지', job.raw.location, describeLocation(job.parsed.location)], ['마감', job.raw.deadline, describeDeadline(job.parsed.deadline)]];
  return `<table class="parse-table"><caption>공고 원문 표기 → kr-job-parser 해석</caption><thead><tr><th scope="col">항목</th><th scope="col">원문</th><th scope="col">해석 결과</th></tr></thead><tbody>${rows.map(([label, raw, parsed]) => `<tr><th scope="row">${label}</th><td>“${escape(raw)}”</td><td class="${parsed === '해석 불가' ? 'unknown' : ''}">${escape(parsed)}</td></tr>`).join('')}</tbody></table>`;
}

fillForm($('#filter-form'), state.filters);
fillForm($('#alert-form'), state.notifications);
$('#filter-form').addEventListener('input', () => { state.filters = readForm($('#filter-form')); persist(); render(); });
$('#filter-form').addEventListener('submit', event => event.preventDefault());
$('#reset-filters').addEventListener('click', () => { state.filters = { ...defaults }; fillForm($('#filter-form'), state.filters); persist(); render(); });
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
  tab = button.dataset.tab;
  document.querySelectorAll('[data-tab]').forEach(other => { other.classList.toggle('active', other === button); other.setAttribute('aria-selected', other === button); });
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
  $('#dialog-content').innerHTML = `<span class="eyebrow">${live ? escape(job.source) + ' · 실제 공고' : 'FICTIONAL JOB · 샘플 공고'}</span><h2>${escape(job.title)}</h2><p class="muted">${escape(job.company)} · ${escape(describeLocation(job.parsed.location))} · ${escape(job.employment)}</p><p>${escape(job.description)}</p>${job.url ? `<p><a class="source-link" href="${escape(job.url)}" target="_blank" rel="noopener noreferrer">원문 공고 보기 ↗</a></p>` : ''}${parsedTable(job)}<p class="muted small">${escape(matchJob(job, state.filters).reason)} · 기술 일치는 지원 자격 충족을 보장하지 않아요.</p><label>내 지원 상태<select id="application-status">${['검토 중', '지원 예정', '지원 완료', '합격', '불합격', '지원 철회'].map(status => `<option${(state.applications[job.id] || '검토 중') === status ? ' selected' : ''}>${status}</option>`).join('')}</select></label>`;
  $('#application-status').addEventListener('change', event => { state.applications[job.id] = event.target.value; persist(); render(); });
  $('#job-dialog').showModal();
});
$('#close-dialog').addEventListener('click', () => $('#job-dialog').close());
render();
if (!storageAvailable) toast('저장된 설정을 읽을 수 없어 기본값으로 시작합니다.');
