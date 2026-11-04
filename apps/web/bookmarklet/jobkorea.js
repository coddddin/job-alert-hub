/**
 * 잡코리아 채용 검색 화면에서 실행하는 북마클릿.
 *
 * - 화면에 이미 보이는 공고 카드의 경력·근무지·마감 표기를 kr-job-parser로 해석해 배지를 붙인다.
 * - 판정 조건은 잡코리아 주소(local, careerType)에서 읽는다. 잡코리아에서 필터를 바꾸면 조건도 따라간다.
 * - 어떤 데이터도 다른 곳으로 보내지 않는다. 사용자가 고른 오판 신고만 이 브라우저에 저장하고,
 *   사용자가 누를 때 파일로 내려받는다(공고 번호와 표기 글자만, 회사명·제목은 저장하지 않음).
 * - 페이지 글자는 모두 textContent로 다룬다(innerHTML 사용 안 함).
 */
import { conditionsFromJobkoreaUrl, judge } from '../lib/judge.js';
import { ATTR, findCards } from './cards.js';

/* global __PARSER_VERSION__ */
const PARSER_VERSION = typeof __PARSER_VERSION__ === 'string' ? __PARSER_VERSION__ : 'dev';
const STORE = 'job-alert-hub:reports';
const STATUS = {
  match: { label: '맞춤', mark: '✓', color: '#0a7d4f', bg: '#e6f6ee' },
  review: { label: '확인 필요', mark: '?', color: '#9a5b00', bg: '#fff3dc' },
  exclude: { label: '제외', mark: '✕', color: '#6b6b6b', bg: '#efefef' },
};

const seoulToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'style') Object.assign(node.style, value);
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  node.setAttribute(ATTR, '');
  return node;
}

function loadReports() {
  try {
    const value = JSON.parse(localStorage.getItem(STORE) ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function saveReports(reports) {
  try { localStorage.setItem(STORE, JSON.stringify(reports)); return true; } catch { return false; }
}

function start() {
  const reports = loadReports();
  const state = { dim: true, counts: { match: 0, review: 0, exclude: 0 } };
  let popover = null;

  const style = el('style', { text: `
    [${ATTR}].jah-badge{all:unset;display:inline-flex;align-items:center;gap:4px;margin:0 6px 4px 0;padding:2px 8px;border-radius:999px;font:600 12px/1.6 system-ui,sans-serif;cursor:pointer;vertical-align:middle}
    [${ATTR}].jah-badge:focus-visible{outline:2px solid #1f5eff;outline-offset:2px}
    .jah-dim{opacity:.38;transition:opacity .2s}
    .jah-dim:hover{opacity:1}
    [${ATTR}].jah-pop{position:absolute;z-index:2147483646;width:320px;padding:14px;border-radius:12px;background:#fff;color:#1a1a1a;box-shadow:0 8px 30px rgba(0,0,0,.18);font:13px/1.5 system-ui,sans-serif}
    [${ATTR}].jah-pop table{width:100%;border-collapse:collapse;margin:8px 0}
    [${ATTR}].jah-pop td{padding:5px 4px;border-top:1px solid #eee;vertical-align:top}
    [${ATTR}].jah-pop button,[${ATTR}].jah-panel button{font:600 12px system-ui,sans-serif;padding:4px 8px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer}
    [${ATTR}].jah-panel{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:280px;padding:14px;border-radius:14px;background:#161616;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.3);font:13px/1.5 system-ui,sans-serif}
    [${ATTR}].jah-panel button{background:transparent;color:#fff;border-color:#555}
  ` });
  document.head.append(style);

  const conditionLine = el('div', { style: { color: '#bbb', margin: '4px 0 8px' } });
  const countLine = el('div', { style: { fontSize: '15px', fontWeight: '700' } });
  const reportButton = el('button', { type: 'button', onclick: exportReports });
  const message = el('div', { style: { color: '#ffcf7a', marginTop: '8px' } });
  const panel = el('div', { class: 'jah-panel', role: 'region', 'aria-label': 'Job Alert Hub 판정' }, [
    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
      el('strong', { text: 'Job Alert Hub' }),
      el('button', { type: 'button', text: '끄기', onclick: stop }),
    ]),
    conditionLine,
    countLine,
    el('div', { style: { display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' } }, [
      el('button', { type: 'button', text: '제외 흐리게 켜짐', onclick: event => { state.dim = !state.dim; event.target.textContent = `제외 흐리게 ${state.dim ? '켜짐' : '꺼짐'}`; scan(true); } }),
      reportButton,
    ]),
    message,
  ]);
  document.body.append(panel);

  function updateReportButton() { reportButton.textContent = `오판 신고 ${reports.length}건 내보내기`; reportButton.disabled = reports.length === 0; }

  function exportReports() {
    const file = { format: 'kr-job-parser/reports', version: 1, parser: PARSER_VERSION, exportedAt: new Date().toISOString(), items: reports };
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
    const link = el('a', { href: url, download: `kr-job-parser-reports-${seoulToday()}.json` });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function closePopover() { popover?.remove(); popover = null; }

  function openPopover(badge, { id }, verdict) {
    closePopover();
    const rows = verdict.fields.map(field => {
      const reported = reports.some(item => item.id === id && item.field === field.label && item.raw === field.raw);
      const button = el('button', { type: 'button', text: reported ? '신고함' : '틀렸어요' });
      button.disabled = reported;
      button.addEventListener('click', event => {
        event.stopPropagation();
        reports.push({ site: 'jobkorea', id, url: `https://www.jobkorea.co.kr/Recruit/GI_Read/${id}`, field: field.label, raw: field.raw, reading: field.reading, today: seoulToday(), reportedAt: new Date().toISOString() });
        message.textContent = saveReports(reports) ? '' : '이 브라우저에 저장하지 못했어요. 창을 닫기 전에 내보내 주세요.';
        button.textContent = '신고함'; button.disabled = true; updateReportButton();
      });
      const mark = field.ok === null ? '?' : field.ok ? '✓' : '✕';
      return el('tr', {}, [
        el('td', { text: field.label, style: { color: '#777', whiteSpace: 'nowrap' } }),
        el('td', {}, [el('div', { text: field.raw || '(표기 없음)' }), el('div', { text: `→ ${mark} ${field.reading}`, style: { color: '#555' } })]),
        el('td', { style: { textAlign: 'right' } }, [button]),
      ]);
    });
    popover = el('div', { class: 'jah-pop', role: 'dialog', 'aria-label': '판정 근거' }, [
      el('strong', { text: `${STATUS[verdict.status].label} · ${verdict.reasons.join(', ')}` }),
      el('table', {}, [el('tbody', {}, rows)]),
      el('div', { text: `kr-job-parser ${PARSER_VERSION} · 원문을 이 사이트 밖으로 보내지 않아요`, style: { color: '#999', fontSize: '11px' } }),
    ]);
    popover.addEventListener('click', event => event.stopPropagation());
    const box = badge.getBoundingClientRect();
    popover.style.top = `${box.bottom + window.scrollY + 6}px`;
    popover.style.left = `${Math.min(box.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - 340)}px`;
    document.body.append(popover);
  }

  let key = '';
  function scan(force = false) {
    observer.disconnect();
    const conditions = conditionsFromJobkoreaUrl(location.href);
    const nextKey = JSON.stringify([conditions, state.dim]);
    if (nextKey !== key) { force = true; key = nextKey; }
    conditionLine.textContent = `조건: ${conditions.regions.length ? conditions.regions.join('·') : '지역 전체'} · 경력무관 ${conditions.includeUnspecified ? '포함' : '제외'} (잡코리아 필터 기준)`;

    if (force) {
      for (const node of document.querySelectorAll(`.jah-badge[${ATTR}]`)) node.remove();
      for (const node of document.querySelectorAll('.jah-dim')) node.classList.remove('jah-dim');
    }
    const today = seoulToday();
    const cards = findCards(document);
    const counts = { match: 0, review: 0, exclude: 0 };
    for (const item of cards) {
      const verdict = judge(item.raw, conditions, today);
      counts[verdict.status] += 1;
      if (item.card.querySelector(`.jah-badge[${ATTR}]`)) continue;
      const look = STATUS[verdict.status];
      const badge = el('button', { type: 'button', class: 'jah-badge', title: verdict.reasons.join(', '), 'aria-label': `${look.label}: ${verdict.reasons.join(', ')}. 판정 근거 보기`, style: { color: look.color, background: look.bg } }, [`${look.mark} ${look.label}`]);
      badge.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); openPopover(badge, item, verdict); });
      item.title.parentElement?.insertBefore(badge, item.title);
      if (state.dim && verdict.status === 'exclude') item.card.classList.add('jah-dim');
    }
    state.counts = counts;
    countLine.textContent = cards.length
      ? `맞춤 ${counts.match} · 확인 ${counts.review} · 제외 ${counts.exclude}`
      : '이 화면에서 공고 카드를 찾지 못했어요';
    observer.observe(document.body, { childList: true, subtree: true });
  }

  let timer;
  const observer = new MutationObserver(mutations => {
    const ours = mutations.every(m => [...m.addedNodes, ...m.removedNodes].every(node => node.nodeType === 1 && node.hasAttribute?.(ATTR)));
    if (ours) return;
    clearTimeout(timer); timer = setTimeout(() => scan(), 300);
  });
  const onDocClick = () => closePopover();
  const onKey = event => { if (event.key === 'Escape') closePopover(); };
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);
  // 잡코리아는 필터를 바꾸면 페이지를 다시 그리지 않고 주소만 바꾸기도 한다.
  let lastHref = location.href;
  const urlTimer = setInterval(() => { if (location.href !== lastHref) { lastHref = location.href; scan(); } }, 800);

  function stop() {
    observer.disconnect(); clearTimeout(timer); clearInterval(urlTimer);
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
    closePopover();
    for (const node of document.querySelectorAll(`[${ATTR}]`)) node.remove();
    for (const node of document.querySelectorAll('.jah-dim')) node.classList.remove('jah-dim');
    delete window.__jobAlertHub;
  }

  updateReportButton();
  scan(true);
  return stop;
}

if (window.__jobAlertHub) {
  window.__jobAlertHub(); // 한 번 더 누르면 끈다.
} else if (!/(^|\.)jobkorea\.co\.kr$/u.test(location.hostname)) {
  const note = el('div', { text: 'Job Alert Hub: 잡코리아 채용 검색 화면에서 눌러 주세요.', style: { position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483647', padding: '12px 14px', borderRadius: '10px', background: '#161616', color: '#fff', font: '13px system-ui,sans-serif' } });
  document.body.append(note);
  setTimeout(() => note.remove(), 4000);
} else {
  window.__jobAlertHub = start();
}
