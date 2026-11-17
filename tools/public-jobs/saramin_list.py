"""Saramin public search-list extractor (no detail pages, no official API).

    python tools/public-jobs/saramin_list.py --out .scrapling-local/saramin            # live, bounded
    python tools/public-jobs/saramin_list.py --html page.html --query 백엔드 --out DIR   # offline

One list page (one request) carries up to 40 postings with title, company, location,
experience, education, employment, deadline and the site's own job tags. Requests are
sequential, at least 2 seconds apart, capped at 10 pages per run, and any non-200 status
stops the run with partial results saved. The User-Agent is the project's honest one.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
import time
from urllib.parse import parse_qs, quote, urlsplit

from scrapling import Selector

VERSION = "saramin-list/1"
FIELDS = ("company", "title", "location", "experience", "deadline", "education", "employment")
USER_AGENT = "JobAlertHubValidation/0.2"
SEARCH = "https://www.saramin.co.kr/zf_user/search/recruit"
DETAIL = "https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx={}"
# Developer-oriented searches. Page 1 of every query comes before page 2 of any query.
QUERIES = ("백엔드", "프론트엔드", "앱개발", "데이터엔지니어", "임베디드", "게임개발", "풀스택", "웹개발")
MAX_PAGES = 10
INTERVAL = 2.0

EXPERIENCE = re.compile(r"^(신입|경력)")
EDUCATION = re.compile(r"학력무관|↑|졸업|졸$|석사|박사")
EMPLOYMENT = re.compile(r"정규직|계약직|인턴|파견|위촉|프리랜서|아르바이트|병역특례|기간제|교육생|해외취업")


def clean(value):
    return " ".join(value.split()) if isinstance(value, str) else ""


def joined(node):
    # Search-word highlighting splits words into <b> nodes: "<b>개발</b>팀" must stay "개발팀".
    return clean("".join(node.xpath(".//text()[not(ancestor::script or ancestor::style or ancestor::button)]").getall()))


def search_url(query, page):
    if not clean(query) or not 1 <= page <= MAX_PAGES:
        raise ValueError("query must be non-empty and page within 1..10")
    return f"{SEARCH}?searchword={quote(clean(query))}&recruitPage={page}&recruitPageCount=40"


def detail_url(href):
    """Canonical detail URL from a list link (tracking parameters dropped)."""
    parsed = urlsplit(href)
    if parsed.netloc not in ("", "www.saramin.co.kr") or parsed.path != "/zf_user/jobs/relay/view":
        raise ValueError("Expected a Saramin detail link")
    ids = parse_qs(parsed.query).get("rec_idx", [])
    if len(ids) != 1 or not re.fullmatch(r"\d{1,12}", ids[0]):
        raise ValueError("Expected exactly one numeric rec_idx")
    return DETAIL.format(ids[0]), ids[0]


def resolve(candidates):
    values = {}
    for value, evidence in candidates:
        value = clean(value)
        if value:
            values.setdefault(value, evidence)
    if len(values) == 1:
        value, evidence = next(iter(values.items()))
        return {"value": value, "status": "extracted", "evidence": evidence}
    return {"value": None, "status": "conflict" if values else "missing", "evidence": None}


def extract_item(item, query, page_number, observed_at):
    warnings = []
    links = item.css(".job_tit a[href]")
    if len(links) != 1:
        raise ValueError("item without exactly one title link")
    url, external_id = detail_url(links[0].attrib["href"])
    if item.attrib.get("value") not in (None, external_id):
        raise ValueError("item id and title link disagree")
    candidates = {name: [] for name in FIELDS}
    candidates["title"] += [(links[0].attrib.get("title"), "dom:job_tit@title"), (joined(links[0]), "dom:job_tit")]
    for node in item.css(".corp_name"):
        candidates["company"].append((joined(node), "dom:corp_name"))
    for node in item.css(".job_date .date"):
        candidates["deadline"].append((joined(node), "dom:job_date"))
    # Condition spans are labelled by content, not position: location has area links.
    for span in item.css(".job_condition > span"):
        value = joined(span)
        if span.css('a[href*="area-recruit"]'):
            candidates["location"].append((value, "dom:job_condition/area"))
        elif EXPERIENCE.match(value):
            candidates["experience"].append((value, "dom:job_condition/experience"))
        elif EDUCATION.search(value):
            candidates["education"].append((value, "dom:job_condition/education"))
        elif EMPLOYMENT.search(value):
            candidates["employment"].append((value, "dom:job_condition/employment"))
        elif not re.search(r"\d\s*(만\s*)?원$|면접", value):
            warnings.append("job_condition:unlabelled")
    tags = []
    # Job-category links only; industry links ("제조업 회사본사") describe the company, not the role.
    for tag in item.css('.job_sector a[href*="/jobs/list/job-category"]'):
        value = joined(tag)
        if value and value not in tags:
            tags.append(value)
    sector = item.css(".job_sector")
    # "… 외" means the list shows only part of the site's tags for this posting.
    truncated = bool(sector) and bool(re.search(r"\s외\s", " " + clean(" ".join(sector[0].xpath("./text()").getall())) + " "))
    fields = {name: resolve(candidates[name]) for name in FIELDS}
    if fields["title"]["status"] == "conflict":
        warnings.append("title:attribute_text_differ")
    return {
        "externalId": external_id, "url": url, "observedAt": observed_at,
        "extractorVersion": VERSION, "query": clean(query), "page": page_number,
        "fields": fields, "tags": tags, "tagsTruncated": truncated,
        "warnings": sorted(set(warnings)),
    }


def extract_list(page, query, page_number, observed_at):
    """Return (observations, broken_item_count) for one search-result page."""
    jobs, broken = [], 0
    for item in page.css("#recruit_info_list div.item_recruit"):
        try:
            jobs.append(extract_item(item, query, page_number, observed_at))
        except (ValueError, KeyError):
            broken += 1
    return jobs, broken


class HttpStatusError(ValueError):
    def __init__(self, status):
        self.status = status
        super().__init__(f"HTTP {status}; no retry or redirect")


def fetch_page(url):
    from scrapling.fetchers import Fetcher
    page = Fetcher.get(url, timeout=20, retries=0, follow_redirects=False,
                       impersonate=None, stealthy_headers=False,
                       headers={"User-Agent": USER_AGENT})
    if page.status != 200:
        raise HttpStatusError(page.status)
    return page


def plan(queries, max_pages):
    """Round-robin (query, page) pairs within the page budget."""
    queries = [clean(q) for q in queries if clean(q)]
    pairs = []
    for page in range(1, MAX_PAGES + 1):
        for query in queries:
            if len(pairs) < min(max_pages, MAX_PAGES):
                pairs.append((query, page))
    return pairs


def absorb(known, job):
    """Fold a repeat sighting into the first one. The list shows a query-dependent subset (and order)
    of the site's tags, so equal fields mean the same posting and tags are unioned. Returns False
    when the fields disagree."""
    if known["fields"] != job["fields"]:
        return False
    known["tags"] = known["tags"] + [tag for tag in job["tags"] if tag not in known["tags"]]
    # One untruncated sighting already listed every tag.
    known["tagsTruncated"] = known["tagsTruncated"] and job["tagsTruncated"]
    return True


def run(queries, out, *, max_pages=MAX_PAGES, fetch=fetch_page, sleep=time.sleep, interval=INTERVAL, now=None):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=False)
    now = now or (lambda: datetime.now(timezone.utc).isoformat())
    by_id, order, attempts = {}, [], []
    exhausted, stopped = set(), None
    for query, number in plan(queries, max_pages):
        if query in exhausted:
            continue
        url = search_url(query, number)
        sleep(max(interval, INTERVAL))
        try:
            page = fetch(url)
            observed = now()
            jobs, broken = extract_list(page, query, number, observed)
            fresh = 0
            for job in jobs:
                known = by_id.get(job["externalId"])
                if known is None:
                    by_id[job["externalId"]] = [job]
                    order.append(job["externalId"])
                    fresh += 1
                elif not any(absorb(seen, job) for seen in known):
                    # Kept so the importer quarantines the whole identity; file order never decides.
                    known.append({**job, "warnings": sorted(set(job["warnings"] + ["duplicate:conflict"]))})
            result = {"query": query, "page": number, "httpStatus": 200, "observedAt": observed,
                      "items": len(jobs), "new": fresh, "brokenItems": broken}
            # Past the last page the site repeats or empties the list: stop this query only.
            if not jobs or fresh == 0:
                exhausted.add(query)
            if jobs == [] and broken:
                stopped = "structure_changed"
        except Exception as exc:  # noqa: BLE001 - every failure stops the run, without retry
            status = exc.status if isinstance(exc, HttpStatusError) else None
            result = {"query": query, "page": number, "httpStatus": status, "errorType": type(exc).__name__}
            blocked = status is None or status in (401, 403, 429) or status >= 500
            stopped = "access_or_service_error" if blocked else "unexpected_status"
        attempts.append(result)
        with (out / "attempts.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(result, ensure_ascii=False) + "\n")
        jobs = [job for key in order for job in by_id[key]]
        (out / "batch.json").write_text(json.dumps({"version": 1, "source": "saramin", "jobs": jobs}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False), flush=True)
        if stopped:
            break
    summary = {"extractorVersion": VERSION, "queries": list(queries), "maxPages": max_pages,
               "requested": len(attempts), "http200": sum(a["httpStatus"] == 200 for a in attempts),
               "unique": len(order), "stopped": stopped, "attempts": attempts}
    (out / "run.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--queries", default=",".join(QUERIES))
    parser.add_argument("--max-pages", type=int, choices=range(1, MAX_PAGES + 1), default=MAX_PAGES)
    parser.add_argument("--html", type=Path, help="offline: extract one saved list page")
    parser.add_argument("--query", default="개발", help="with --html: the search word of the saved page")
    args = parser.parse_args()
    if args.out.exists():
        parser.error("Output directory must be new")
    if args.html:
        jobs, broken = extract_list(Selector(args.html.read_text(encoding="utf-8")), args.query, 1, datetime.now(timezone.utc).isoformat())
        args.out.mkdir(parents=True)
        (args.out / "batch.json").write_text(json.dumps({"version": 1, "source": "saramin", "jobs": jobs}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"items": len(jobs), "brokenItems": broken}), flush=True)
        return 0 if jobs else 2
    result = run(args.queries.split(","), args.out, max_pages=args.max_pages)
    return 1 if result["stopped"] else 0


if __name__ == "__main__":
    sys.exit(main())
