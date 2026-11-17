#!/usr/bin/env python3
"""One-time, non-evasive JobKorea accessibility diagnostic using Scrapling.

This is NOT a production crawler. It does not bypass blocking, rotate proxies,
log in, reproduce job descriptions, or store raw HTML.
"""
from __future__ import annotations

import json
import time
from urllib.parse import urljoin, urlsplit

from scrapling.fetchers import Fetcher
from probe import JOBKOREA_URL, USER_AGENT, audit_robots

DETAIL_URL = "https://www.jobkorea.co.kr/Recruit/GI_Read/48683167"
FETCH_HEADERS = {"User-Agent": USER_AGENT}


def summarize_page(url: str) -> dict[str, object]:
    """One public GET with no browser automation or restriction workarounds."""
    response = Fetcher.get(
        url, timeout=15, retries=0, headers=FETCH_HEADERS, stealthy_headers=False
    )
    status = response.status
    if status != 200:
        return {"http_status": status, "html_parsed": False}
    title = str(response.css("title::text").get() or "").strip()
    og_title = str(response.css('meta[property="og:title"]::attr(content)').get() or "").strip()
    headings = [
        str(v).strip() for v in response.css("h1::text").getall()
        if str(v).strip()
    ]
    job_links = {
        urljoin(url, str(href))
        for href in response.css('a[href*="GI_Read"]::attr(href)').getall()
        if str(href) and urlsplit(urljoin(url, str(href))).hostname == "www.jobkorea.co.kr"
    }
    return {
        "http_status": status,
        "html_parsed": True,
        "page_title_excerpt": title[:90],
        "open_graph_title_excerpt": og_title[:90],
        "headings_found": len(headings),
        "job_detail_links_found": len(job_links),
        "has_visible_heading_text": bool(headings),
    }


def main() -> None:
    audit = audit_robots(JOBKOREA_URL)
    result: dict[str, object] = {
        "target": "jobkorea",
        "scope": "two single requests: public search page and one historical closed job detail",
        "policy_signal": audit,
        "reuse_permission_verified": False,
        "raw_page_archived": False,
        "stealth_or_bypass_used": False,
    }
    if audit.get("robots_permission") != "allowed":
        result["outcome"] = "skipped; robots could not be verified as allowing the request"
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return
    for label, url in (
        ("search_page", JOBKOREA_URL),
        ("historical_detail_page", DETAIL_URL),
    ):
        detail_audit = audit_robots(url) if label == "historical_detail_page" else audit
        if detail_audit.get("robots_permission") != "allowed":
            result[label] = {"outcome": "skipped; robots not allowed"}
            continue
        try:
            result[label] = summarize_page(url)
        except Exception as exc:
            result[label] = {
                "outcome": "request_error",
                "error_type": type(exc).__name__,
                "message": str(exc)[:140],
            }
        if label == "search_page":
            time.sleep(2)
    result["outcome"] = "diagnostic finished; not evidence of permission for ongoing crawling"
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
