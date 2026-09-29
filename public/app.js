import { jobs } from '/data/jobs.js';
import { defaults, matchJob, notificationCandidates } from '/lib/matching.js';
import { initialState, sanitizeState, storageKey } from '/lib/state.js';

const $ = selector => document.querySelector(selector);
let state = initialState();
let storageAvailable = true;
try { state = sanitizeState(JSON.parse(localStorage.getItem(storageKey))); } catch { storageAvailable = false; }
let view = 'feed';
let tab = 'match';
let toastTimer;
const roles = ['all', '프론트엔드', '백엔드', '풀스택', '모바일', '게임', '데이터·AI', '임베디드'];
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
for (const select of [$('#filter-role'), $('#alert-role')]) {
  select.innerHTML = roles.map(role => `<option value="${role}">${role === 'all' ? '개발 분야 전체' : role}</option>`).join('');
}
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
    if (control.type === 'checkbox') control.checked = value;
    else control.value = value;
  }
}
function readForm(form) {
  const data = new FormData(form);
  return { role: data.get('role'), region: data.get('region'), keyword: data.get('keyword').trim(), includeUnspecified: data.has('includeUnspecified') };
}
function experience(job) { return ({ new: '신입', unspecified: '경력무관', experienced: '경력 필수', unknown: '경력 미상' })[job.experience]; }
function card(job, result) {
  const saved = state.bookmarks.includes(job.id);
  return `<article class="job-card"><div class="company-logo ${job.color}" aria-hidden="true">${job.initials}</div><div class="job-main"><div class="company-line">${escape(job.company)} <span class="source">${job.source}</span></div><button class="job-title" data-detail="${job.id}">${escape(job.title)}</button><div class="job-meta"><span>${job.locations.length ? job.locations.join('·') : '근무지 미상'} ${job.area}</span><span>${experience(job)}</span><span>${job.employment}</span></div><div class="tags"><span class="tag match">${result.status === 'review' ? '조건 확인 필요' : experience(job) === '신입' ? '신입 지원 명시' : '경력무관'}</span>${job.skills.map(skill => `<span class="tag">${escape(skill)}</span>`).join('')}${state.applications[job.id] ? `<span class="tag">${state.applications[job.id]}</span>` : ''}</div></div><div class="job-side"><button class="save" data-save="${job.id}" aria-pressed="${saved}" aria-label="${escape(job.company)} 스크랩">${saved ? '◆ 저장됨' : '◇ 스크랩'}</button><span class="deadline">${job.deadline ? '~ ' + job.deadline.slice(5).replace('-', '.') : '채용 시 마감'}</span></div></article>`;
}
function render() {
  const results = jobs.map(job => ({ job, result: matchJob(job, state.filters) }));
  const eligible = results.filter(({ job }) => view !== 'saved' || state.bookmarks.includes(job.id));
  $('#match-count').innerHTML = `${eligible.filter(x => x.result.status === 'match').length} <small>개</small>`;
  $('#review-count').innerHTML = `${eligible.filter(x => x.result.status === 'review').length} <small>개</small>`;
  $('#alert-count').innerHTML = `${notificationCandidates(jobs, state.notifications).length} <small>개</small>`;
  $('#saved-count').textContent = state.bookmarks.filter(id => jobs.some(j => j.id === id)).length;
  const visible = eligible.filter(x => x.result.status === tab);
  $('#result-count').textContent = `${visible.length}개 · 샘플 데이터`;
  $('#job-list').innerHTML = visible.length ? visible.map(x => card(x.job, x.result)).join('') : `<div class="empty"><h2>${view === 'saved' ? '현재 조건에 맞는 스크랩이 없어요' : '현재 조건에 맞는 공고가 없어요'}</h2><p class="muted">${view === 'saved' ? '관심 공고를 스크랩하거나 목록 필터를 조정해 보세요.' : '개발 분야나 검색어를 바꾸거나, 확인 필요 탭을 살펴보세요.'}</p></div>`;
  $('#feed-title').textContent = view === 'saved' ? '마음에 담아 둔 기회' : '나에게 맞는, 다음 기회';
  $('#feed-subtitle').textContent = view === 'saved' ? '스크랩한 공고에 현재 목록 필터를 적용합니다. 공고를 눌러 지원 상태도 기록해 보세요.' : '여러 곳의 공고를 한눈에. 중요한 기회에만 집중하세요.';
}
function switchView(next) {
  view = next;
  $('#feed-view').hidden = next === 'alerts'; $('#alerts-view').hidden = next !== 'alerts';
  document.querySelectorAll('[data-view]').forEach(button => { button.classList.toggle('active', button.dataset.view === next); button.setAttribute('aria-current', button.dataset.view === next ? 'page' : 'false'); });
  $('#breadcrumb').textContent = ({ feed: '공고 모아보기', saved: '스크랩', alerts: '알림 설정' })[next];
  if (next === 'alerts') { fillForm($('#alert-form'), state.notifications); preview(); }
  render();
}
function preview() {
  const matches = notificationCandidates(jobs, readForm($('#alert-form')));
  const channels = ['email', 'kakao'].filter(key => $('#alert-form').elements.namedItem(key).checked);
  $('#preview-caption').textContent = channels.length ? `입력한 조건에 맞는 샘플 공고 ${matches.length}개` : `선택한 채널이 없습니다. 조건 일치 공고는 ${matches.length}개입니다.`;
  $('#alert-preview').innerHTML = matches.length ? matches.map(job => `<div class="preview-item"><strong>${escape(job.company)}</strong><br>${escape(job.title)}<small>${job.locations.join('·')} · ${experience(job)} · ${job.employment}</small></div>`).join('') : '<p class="muted">조건에 맞는 샘플 공고가 없습니다.</p>';
}
fillForm($('#filter-form'), state.filters); fillForm($('#alert-form'), state.notifications);
$('#filter-form').addEventListener('input', () => { state.filters = readForm($('#filter-form')); persist(); render(); });
$('#filter-form').addEventListener('submit', event => event.preventDefault());
$('#reset-filters').addEventListener('click', () => { state.filters = { ...defaults }; fillForm($('#filter-form'), state.filters); persist(); render(); });
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
$('#go-alerts').addEventListener('click', () => switchView('alerts'));
for (const [id, status] of [['matched-tab', 'match'], ['review-tab', 'review']]) {
  $('#' + id).addEventListener('click', () => {
    tab = status;
    for (const button of document.querySelectorAll('.tab')) { button.classList.toggle('active', button.id === id); button.setAttribute('aria-pressed', button.id === id); }
    render();
  });
}
$('#alert-form').addEventListener('input', preview);
$('#alert-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = $('#alert-form');
  state.notifications = { ...readForm(form), frequency: form.elements.frequency.value, email: form.elements.email.checked, kakao: form.elements.kakao.checked };
  if (persist()) toast('알림 설정을 저장했습니다. 실제 발송은 하지 않습니다.');
  render();
});
$('#job-list').addEventListener('click', event => {
  const save = event.target.closest('[data-save]');
  if (save) {
    const id = save.dataset.save;
    if (state.bookmarks.includes(id)) state.bookmarks = state.bookmarks.filter(value => value !== id);
    else state.bookmarks.push(id);
    persist(); render(); return;
  }
  const detail = event.target.closest('[data-detail]');
  if (!detail) return;
  const job = jobs.find(value => value.id === detail.dataset.detail);
  $('#dialog-content').innerHTML = `<span class="eyebrow">FICTIONAL JOB / 샘플 공고</span><h2>${escape(job.title)}</h2><p class="muted">${escape(job.company)} · ${job.locations.join('·') || '근무지 미상'} ${job.area}</p><p>${escape(job.description)}</p><p class="muted">${matchJob(job, state.filters).reason} · 기술 일치는 지원 자격 충족을 보장하지 않습니다.</p><label class="block-label">내 지원 상태<select id="application-status">${['검토 중', '지원 예정', '지원 완료', '합격', '불합격', '지원 철회'].map(status => `<option${(state.applications[job.id] || '검토 중') === status ? ' selected' : ''}>${status}</option>`).join('')}</select></label><p class="form-help">가상 공고라 원문 링크와 실제 지원 기능은 없습니다. 상태는 연습용으로 저장됩니다.</p>`;
  $('#application-status').addEventListener('change', event => { state.applications[job.id] = event.target.value; persist(); render(); });
  $('#job-dialog').showModal();
});
$('#close-dialog').addEventListener('click', () => $('#job-dialog').close());
render();
if (!storageAvailable) toast('저장된 설정을 읽을 수 없어 기본값으로 시작합니다.');
