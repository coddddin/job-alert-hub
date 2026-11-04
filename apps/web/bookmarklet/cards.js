/**
 * 잡코리아 검색 화면에서 공고 카드를 찾는다.
 *
 * 잡코리아는 Tailwind 클래스명(rounded-2xl, text-typo-c1-13 …)을 쓰는데 이런 이름은 화면을 고칠 때마다 바뀐다.
 * 그래서 클래스에 기대지 않고 두 가지만 가정한다.
 *   1. 공고마다 `/Recruit/GI_Read/<번호>` 링크가 하나 이상 있다.
 *   2. 카드 안의 경력·근무지·마감은 각각 하나의 말단 요소에 짧은 글자로 들어 있다.
 */
import { pickJobkoreaFields } from '../lib/judge.js';

/** 북마클릿이 만든 요소 표시. 다시 훑을 때 자기 요소를 공고로 착각하지 않게 한다. */
export const ATTR = 'data-jah';
const POST = /\/Recruit\/GI_Read\/(\d+)/;
const LINKS = 'a[href*="/Recruit/GI_Read/"]';

const postId = anchor => POST.exec(anchor.getAttribute('href') ?? '')?.[1];
const idsIn = node => new Set([...node.querySelectorAll(LINKS)].map(postId).filter(Boolean));

/**
 * 공고 번호별로 링크를 모아, 그 번호의 링크만 담은 가장 큰 상자를 카드로 본다.
 * @param {Document | Element} root
 * @returns {{ id: string, card: Element, title: Element, raw: { experience: string, location: string, deadline: string } }[]}
 */
export function findCards(root) {
  const byId = new Map();
  for (const anchor of root.querySelectorAll(LINKS)) {
    if (anchor.closest(`[${ATTR}]`)) continue;
    const id = postId(anchor);
    if (id) byId.set(id, [...(byId.get(id) ?? []), anchor]);
  }
  const top = root.body ?? root;
  const cards = [];
  for (const [id, anchors] of byId) {
    let card = anchors[0];
    while (card.parentElement && !anchors.every(anchor => card.contains(anchor))) card = card.parentElement;
    while (card.parentElement && card.parentElement !== top && idsIn(card.parentElement).size === 1) card = card.parentElement;
    if (idsIn(card).size !== 1) continue;
    // 링크 글자가 가장 긴 것이 제목이다(로고 링크는 비어 있고 회사명 링크는 짧다).
    const title = anchors.reduce((best, anchor) => (anchor.textContent.trim().length > best.textContent.trim().length ? anchor : best));
    const texts = [...card.querySelectorAll('span, p, div')]
      .filter(node => node.children.length === 0 && !node.closest(`[${ATTR}]`))
      .map(node => node.textContent);
    cards.push({ id, card, title, raw: pickJobkoreaFields(texts) });
  }
  return cards;
}
