"""Bounded, sequential validation run with durable per-attempt results."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import random
import time
from urllib.parse import urljoin

from scrapling.fetchers import Fetcher
from extract import canonical_url, extract, fetch_page, HttpStatusError

SEARCH = 'https://www.jobkorea.co.kr/recruit/joblist?menucode=search'


def reference_html(page):
    # Retain only relevant field markup for offline debugging, never whole pages.
    pieces = page.css('script[type="application/ld+json"], h1, h2, [data-sentry-component="RecruitmentItem"], [data-sentry-component="QualificationItem"]').getall()
    pieces += page.xpath('//*[not(*) and normalize-space(.)="마감일"]/parent::*/parent::*').getall()
    for node in page.css('[data-sentry-component="PositionJobView"] button[aria-controls]'):
        pieces.append('<div data-sentry-component="PositionJobView">' + node.get() + '</div>')
    return '<html><body>' + '\n'.join(pieces) + '</body></html>'


def run(links, out, *, fetch=fetch_page, sleep=time.sleep, interval=2):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=False)
    attempts, jobs = [], []
    stopped = None
    for url in links:
        sleep(interval)
        try:
            page = fetch(url)
            observed = datetime.now(timezone.utc).isoformat()
            job = extract(page, url, observed)
            jobs.append(job)
            identifier = job['externalId']
            (out / f'{identifier}.html').write_text(reference_html(page), encoding='utf-8')
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--count', type=int, choices=range(1, 51), default=40)
    parser.add_argument('--seed', type=int, default=20261114)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    if args.out.exists():
        parser.error('Output directory must be new')
    page = Fetcher.get(SEARCH, timeout=20, retries=0, follow_redirects=False,
                       impersonate=None, stealthy_headers=False,
                       headers={'User-Agent': 'JobAlertHubValidation/0.2'})
    if page.status != 200:
        raise HttpStatusError(page.status)
    links = set()
    for href in page.css('a[href*="GI_Read"]::attr(href)').getall():
        try:
            links.add(canonical_url(urljoin(SEARCH, href))[0])
        except ValueError:
            continue
    selected = sorted(links)
    random.Random(args.seed).shuffle(selected)
    result = run(selected[:args.count], args.out)
    result.update({'seed': args.seed, 'discovered': len(links), 'search': SEARCH})
    (args.out / 'run.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    return 1 if result['stopped'] else 0


if __name__ == '__main__':
    import sys
    sys.exit(main())
