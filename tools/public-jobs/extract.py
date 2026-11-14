"""Versioned, offline-first extraction. Network access is an explicit CLI option."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit

from scrapling import Selector

FIELDS = ("company", "title", "location", "experience", "deadline")
VERSION = "jobkorea-detail/1"


def clean(value):
    return " ".join(value.split()) if isinstance(value, str) else ""


def canonical_url(url):
    parsed = urlsplit(url)
    match = re.fullmatch(r"/Recruit/GI_Read/(\d+)/?", parsed.path, re.I)
    if (parsed.scheme != "https" or parsed.netloc != "www.jobkorea.co.kr" or not match):
        raise ValueError("Expected a public JobKorea detail HTTPS URL")
    return f"https://www.jobkorea.co.kr/Recruit/GI_Read/{match[1]}", match[1]


def postings(value):
    if isinstance(value, list):
        for item in value:
            yield from postings(item)
    elif isinstance(value, dict):
        types = value.get("@type", [])
        if types == "JobPosting" or isinstance(types, list) and "JobPosting" in types:
            yield value
        yield from postings(value.get("@graph", []))


def text(node, include_inactive_tab=False):
    # Do not include map buttons, scripts, styles or hidden auxiliary text.
    hidden = '' if include_inactive_tab else ' or ancestor::*[@hidden] or ancestor::*[@aria-hidden="true"]'
    return clean(" ".join(node.xpath('.//text()[not(ancestor::button or ancestor::script or ancestor::style' + hidden + ')]').getall()))


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


def extract(page, url, observed_at):
    url, external_id = canonical_url(url)
    candidates = {name: [] for name in FIELDS}
    warnings = []
    records = []
    for script in page.css('script[type="application/ld+json"]::text').getall():
        try:
            records.extend(postings(json.loads(script)))
        except (ValueError, TypeError):
            warnings.append("invalid_json_ld")
    # Never use another job's recommendation metadata.
    selected = []
    for record in records:
        try:
            if canonical_url(record.get("url", ""))[0] == url:
                selected.append(record)
        except (ValueError, TypeError, AttributeError):
            continue
    for record in selected:
        org = record.get("hiringOrganization")
        candidates["company"].append((org.get("name") if isinstance(org, dict) else None, "jsonld:hiringOrganization.name"))
        candidates["title"].append((record.get("title"), "jsonld:title"))
        locations = record.get("jobLocation", [])
        locations = locations if isinstance(locations, list) else [locations]
        addresses = []
        for location in locations:
            address = location.get("address") if isinstance(location, dict) else None
            if isinstance(address, dict):
                parts = [clean(address.get(k)) for k in ("addressRegion", "addressLocality", "streetAddress")]
                addresses.append(" ".join(p for p in parts if p))
        candidates["location"].append((" / ".join(a for a in addresses if a), "jsonld:jobLocation.address"))
        candidates["experience"].append((record.get("experienceRequirements"), "jsonld:experienceRequirements"))
        candidates["deadline"].append((record.get("validThrough"), "jsonld:validThrough"))
    # Headings are corroboration only; never interpret a generic page title as a job.
    if selected:
        for field, selector in (("title", "h1"), ("company", "h2")):
            for node in page.css(selector):
                if text(node):
                    candidates[field].append((text(node), f"dom:{selector}"))
    for field, label, component in (
        ("location", "근무지주소", "RecruitmentItem"),
        ("experience", "경력", "QualificationItem"),
    ):
        selector = f'//*[@data-sentry-component="{component}"]/*[1][normalize-space(.)="{label}"]/following-sibling::*'
        dom = [(text(node), f"dom:{component}/{label}") for node in page.xpath(selector)]
        if any(value for value, _ in dom):
            structured = resolve(candidates[field])["value"]
            if structured and structured != resolve(dom)["value"]:
                warnings.append(f"{field}:dom_overrides_jsonld")
            candidates[field] = dom
    # A labelled deadline is more precise than an unlabelled date anywhere on the page.
    deadline_nodes = page.xpath('//*[not(*) and normalize-space(.)="마감일"]/parent::*/following-sibling::*')
    dom_deadlines = [(text(node, True), "dom:마감일") for node in deadline_nodes if re.search(r"\d{4}[.-]\d{2}[.-]\d{2}|상시|채용시", text(node, True))]
    if dom_deadlines:
        candidates["deadline"] = dom_deadlines
    return {
        "externalId": external_id, "url": url, "observedAt": observed_at,
        "extractorVersion": VERSION,
        "fields": {name: resolve(candidates[name]) for name in FIELDS},
        "warnings": sorted(set(warnings)),
    }


def fetch_page(url):
    from scrapling.fetchers import Fetcher
    canonical_url(url)
    page = Fetcher.get(url, timeout=20, retries=0, follow_redirects=False,
                       impersonate=None, stealthy_headers=False,
                       headers={"User-Agent": "JobAlertHubValidation/0.2"})
    if page.status != 200:
        raise ValueError(f"HTTP {page.status}; no retry or redirect")
    return page


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--html", type=Path)
    mode.add_argument("--live", action="store_true")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    canonical_url(args.url)
    page = fetch_page(args.url) if args.live else Selector(args.html.read_text(encoding="utf-8"))
    job = extract(page, args.url, datetime.now(timezone.utc).isoformat())
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"version": 1, "source": "jobkorea", "jobs": [job]}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0 if all(job["fields"][f]["value"] for f in ("company", "title")) else 2


if __name__ == "__main__":
    sys.exit(main())
