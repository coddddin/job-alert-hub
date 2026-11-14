"""Opt-in bounded sample: one search page and at most three details, two seconds apart.

Prints field evidence for human labelling, not an automated accuracy claim.
No raw HTML archive, production writes, credentials, or recurring schedule.
"""
import argparse
from datetime import datetime, timezone
import json
import time
from urllib.parse import urljoin

from scrapling.fetchers import Fetcher
from extract import canonical_url, extract, fetch_page


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--count', type=int, choices=(1, 2, 3), default=2)
    args = parser.parse_args()
    url = 'https://www.jobkorea.co.kr/recruit/joblist?menucode=search'
    page = Fetcher.get(url, timeout=20, retries=0, follow_redirects=False,
                       impersonate=None, stealthy_headers=False,
                       headers={'User-Agent': 'JobAlertHubValidation/0.2'})
    if page.status != 200:
        raise ValueError(f'HTTP {page.status}; stopping sample')
    links = set()
    for href in page.css('a[href*="GI_Read"]::attr(href)').getall():
        try:
            links.add(canonical_url(urljoin(url, href))[0])
        except ValueError:
            continue
    samples = []
    errors = []
    for link in sorted(links)[:args.count]:
        time.sleep(2)
        try:
            detail = fetch_page(link)
        except Exception as exc:
            errors.append({'url': link, 'errorType': type(exc).__name__, 'message': str(exc)[:200]})
            break
        observation = extract(detail, link, datetime.now(timezone.utc).isoformat())
        # Separate DOM reference, including inactive tab markup, for manual review.
        reference = {name: detail.css(selector).getall() for name, selector in [('company', 'h2'), ('title', 'h1')]}
        for name, label in [('location', '근무지주소'), ('experience', '경력'), ('deadline', '마감일')]:
            reference[name] = detail.xpath('//*[not(*) and normalize-space(.)="' + label + '"]/parent::*/parent::*').getall()
        samples.append({'observation': observation, 'reference': reference})
    print(json.dumps({'detailLinks': len(links), 'samples': samples, 'errors': errors}, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == '__main__':
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
