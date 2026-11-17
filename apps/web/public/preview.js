import { SIDO } from 'kr-job-parser';
import { previewJobs, filterPreview, sourceUrl, experienceSummary } from './lib/preview.js';

const $ = selector => document.querySelector(selector);
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
for (const sido of SIDO) {
  const option = element('option', sido); option.value = sido; $('#region').append(option);
}
const deadlineLabel = { rolling: '상시채용', 'until-filled': '채용 시 마감', unknown: '확인 필요' };
let sourceLabels = new Map();

function card(job) {
  const article = element('article');
  article.append(element('div', `${job.company} · ${sourceLabels.get(job.source) ?? job.source}`, 'company'), element('h2', job.title));
  const fields = element('dl', undefined, 'fields');
  const parsed = [experienceSummary(job.parsed.experience), job.locations.join(' · ') || '지역 확인 필요', job.deadline ?? deadlineLabel[job.deadlineKind]];
  for (const [index, key] of ['experience', 'location', 'deadline'].entries()) {
    const group = element('div');
    group.append(element('dt', ['경력', '근무지', '마감일'][index]), element('dd', job.raw[key] || '원문 없음'), element('dd', `해석: ${parsed[index]}`, 'parsed'));
    fields.append(group);
  }
  article.append(fields);
  if (/직무별|포지션별|부문별|상세.*참[고조]|상세요강|~|이하/.test(job.raw.experience)) {
    article.append(element('p', '세부 경력 조건이 있습니다. 원문과 모집 부문별 조건을 확인하세요.', 'state'));
  }
  const footer = element('footer');
  const url = sourceUrl(job.applyUrl);
  if (url) {
    const link = element('a', '원본 공고 보기 (새 창)'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; footer.append(link);
  }
  footer.append(element('span', job.closed ? '마감일 경과' : job.deadlineKind === 'unknown' ? '마감 확인 필요' : '마감일 기준 열림 · 조기 마감 가능', 'state'));
  article.append(footer); return article;
}

try {
  const response = await fetch('./data/live/snapshot.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('스냅샷을 불러오지 못했습니다.');
  const snapshot = await response.json();
  const jobs = previewJobs(snapshot);
  sourceLabels = new Map((snapshot.sources ?? []).map(source => [source.name, source.label]));
  for (const source of new Set(jobs.map(job => job.source))) {
    const option = element('option', sourceLabels.get(source) ?? source); option.value = source; $('#source').append(option);
  }
  function render() {
    const filtered = filterPreview(jobs, { keyword: $('#keyword').value, region: $('#region').value, experience: $('#experience').value, source: $('#source').value, includeClosed: $('#closed').checked });
    $('#summary').textContent = `${filtered.length} / ${jobs.length}건 · 기준일 ${snapshot.today} · 지역 미상은 확인 대상으로 유지합니다.`;
    $('#jobs').replaceChildren(...filtered.map(card));
    if (!filtered.length) $('#jobs').append(element('p', '조건에 맞는 공고가 없습니다. 필터를 변경해 보세요.'));
  }
  for (const control of document.querySelectorAll('input, select')) control.addEventListener('input', render);
  render();
} catch (error) {
  $('#summary').textContent = `${error.message} 샘플 데이터로 대체하지 않았습니다.`;
}
