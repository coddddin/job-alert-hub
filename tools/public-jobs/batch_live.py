"""Bounded, sequential validation run with durable per-attempt results."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import random
import time
from urllib.parse import quote, urljoin

from scrapling.fetchers import Fetcher
from extract import canonical_url, extract, fetch_page, HttpStatusError

SEARCH = 'https://www.jobkorea.co.kr/recruit/joblist?menucode=search'


def reference_html(page):
    # Retain only relevant field markup for offline debugging, never whole pages.
    pieces = page.css('script[type="application/ld+json"], h1, h2, [data-sentry-component="RecruitmentItem"], [data-sentry-component="QualificationItem"], [data-sentry-component="RecruitmentField"]').getall()
    pieces += page.xpath('//*[not(*) and normalize-space(.)="마감일"]/parent::*/parent::*').getall()
    for node in page.css('[data-sentry-component="PositionJobView"] button[aria-controls]'):
        pieces.append('<div data-sentry-component="PositionJobView">' + node.get() + '</div>')
    return '<html><body>' + '\n'.join(pieces) + '</body></html>'


RETRY_WAIT = 15


def fetch_once_more(fetch, url, sleep, wait):
    """One retry after a pause for network-level errors only (see saramin_list.fetch_once_more).
    HTTP statuses, including blocking signals, are never retried."""
    try:
        return fetch(url)
    except HttpStatusError:
        raise
    except Exception:  # noqa: BLE001
        sleep(wait)
        return fetch(url)


def run(links, out, *, fetch=fetch_page, sleep=time.sleep, interval=2, reference=reference_html, retry_wait=RETRY_WAIT):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=False)
    attempts, jobs = [], []
    stopped = None
    for url in links:
        sleep(interval)
        try:
            page = fetch_once_more(fetch, url, sleep, retry_wait)
            observed = datetime.now(timezone.utc).isoformat()
            job = extract(page, url, observed)
            jobs.append(job)
            identifier = job['externalId']
            (out / f'{identifier}.html').write_text(reference(page), encoding='utf-8')
            result = {'url': url, 'httpStatus': 200, 'observedAt': observed,
                      'requiredFieldsPresent': all(job['fields'][f]['value'] for f in ('company', 'title'))}
        except Exception as exc:
            status = exc.status if isinstance(exc, HttpStatusError) else None
            result = {'url': url, 'httpStatus': status, 'errorType': type(exc).__name__}
            # Redirect/404 are individual exclusions. Blocking, service errors,
            # unexpected exceptions and network failures stop the complete run.
            if status is None or status in (401, 403, 429) or status >= 500:
                stopped = 'access_or_service_error'
        attempts.append(result)
        with (out / 'attempts.jsonl').open('a', encoding='utf-8') as stream:
            stream.write(json.dumps(result, ensure_ascii=False) + '\n')
        (out / 'batch.json').write_text(json.dumps({'version': 1, 'source': 'jobkorea', 'jobs': jobs}, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({'attempted': len(attempts), **result}), flush=True)
        if stopped:
            break
    summary = {'requested': len(links), 'attempted': len(attempts), 'http200': len(jobs),
               'stopped': stopped, 'attempts': attempts}
    (out / 'run.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    return summary


KEYWORD_SEARCH = 'https://www.jobkorea.co.kr/Search/?stext={query}&tabType=recruit&Page_No=1'


def search_links(url):
    page = Fetcher.get(url, timeout=20, retries=0, follow_redirects=False,
                       impersonate=None, stealthy_headers=False,
                       headers={'User-Agent': 'JobAlertHubValidation/0.2'})
    if page.status != 200:
        raise HttpStatusError(page.status)
    links = []
    for href in page.css('a[href*="GI_Read"]::attr(href)').getall():
        try:
            link = canonical_url(urljoin(url, href))[0]
        except ValueError:
            continue
        if link not in links:
            links.append(link)
    return links


def discover(queries, seen, count, *, fetch=search_links, sleep=time.sleep, interval=2):
    """Keyword searches (one page each), then round-robin across queries so every query
    contributes; already seen IDs are skipped so the detail budget goes to new postings.
    A blocking or service error stops discovery and keeps what was found."""
    per_query, searched, stopped = [], [], None
    for query in queries:
        sleep(interval)
        url = KEYWORD_SEARCH.format(query=quote(query))
        try:
            links = fetch(url)
        except Exception as exc:
            status = exc.status if isinstance(exc, HttpStatusError) else None
            searched.append({'query': query, 'httpStatus': status, 'errorType': type(exc).__name__})
            if status is None or status in (401, 403, 429) or status >= 500:
                stopped = 'access_or_service_error'
                break
            continue
        fresh = [link for link in links if canonical_url(link)[1] not in seen]
        searched.append({'query': query, 'httpStatus': 200, 'links': len(links), 'new': len(fresh)})
        per_query.append(fresh)
    # Each round every query adds its next link not already taken, so a duplicate never costs a turn.
    selected, cursors = [], [0] * len(per_query)
    while len(selected) < count and any(c < len(links) for c, links in zip(cursors, per_query)):
        for i, links in enumerate(per_query):
            while cursors[i] < len(links) and links[cursors[i]] in selected:
                cursors[i] += 1
            if cursors[i] < len(links) and len(selected) < count:
                selected.append(links[cursors[i]])
                cursors[i] += 1
    return selected, searched, stopped


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--count', type=int, choices=range(1, 51), default=40)
    parser.add_argument('--seed', type=int, default=20261114)
    parser.add_argument('--queries', default='', help='comma separated search words (collection plan); empty = generic list')
    parser.add_argument('--seen', type=Path, help='file of recently seen external IDs to skip')
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    if args.out.exists():
        parser.error('Output directory must be new')
    seen = set()
    if args.seen and args.seen.exists():
        seen = {line.strip() for line in args.seen.read_text(encoding='utf-8').splitlines() if line.strip()}
    queries = [q.strip() for q in args.queries.split(',') if q.strip()]
    if queries:
        selected, searched, stopped = discover(queries, seen, args.count)
        if stopped and not selected:
            args.out.mkdir(parents=True, exist_ok=False)
            (args.out / 'run.json').write_text(json.dumps({'stopped': stopped, 'searched': searched}, indent=2), encoding='utf-8')
            return 1
        result = run(selected, args.out)
        result.update({'queries': queries, 'searched': searched, 'skippedSeen': len(seen), 'searchStopped': stopped})
        (args.out / 'run.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        return 1 if result['stopped'] or stopped else 0
    links = search_links(SEARCH)
    selected = [link for link in sorted(links) if canonical_url(link)[1] not in seen]
    random.Random(args.seed).shuffle(selected)
    result = run(selected[:args.count], args.out)
    result.update({'seed': args.seed, 'discovered': len(links), 'search': SEARCH, 'skippedSeen': len(seen)})
    (args.out / 'run.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    return 1 if result['stopped'] else 0


if __name__ == '__main__':
    import sys
    sys.exit(main())
