#!/usr/bin/env python3
"""Isolated Scrapling verification. No portal bypass or production collection."""
from __future__ import annotations

import argparse
import json
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from urllib.robotparser import RobotFileParser

from scrapling import Selector
from scrapling.fetchers import Fetcher

DEMO_URL = "https://realpython.github.io/fake-jobs/"
JOBKOREA_URL = "https://www.jobkorea.co.kr/recruit/joblist?menucode=search"
USER_AGENT = "JobAlertHubValidation/0.1 (+https://github.com/coddddin/job-alert-hub)"


def extract_demo_jobs(page: Selector) -> list[dict[str, str]]:
    """Parse the public tutorial's example job listings, not real vacancies."""
    jobs = []
    for card in page.css(".card-content"):
        title = str(card.css("h2.title::text").get() or "").strip()
        company = str(card.css("h3.company::text").get() or "").strip()
        location = str(card.css("p.location::text").get() or "").strip()
        if title and company and location:
            jobs.append({"title": title, "company": company, "location": location})
    return jobs


def audit_robots(url: str) -> dict[str, object]:
    """Read robots.txt once and fail closed on errors/ambiguous policy."""
    split = urlsplit(url)
    robots_url = f"{split.scheme}://{split.netloc}/robots.txt"
    try:
        req = Request(robots_url, headers={"User-Agent": USER_AGENT})
        with urlopen(req, timeout=12) as response:
            status = response.status
            content = response.read(512_000).decode("utf-8", errors="replace")
        if status != 200:
            return {"robots_http_status": status, "robots_permission": "unknown"}
    except HTTPError as exc:
        return {"robots_http_status": exc.code, "robots_permission": "unknown"}
    except (URLError, TimeoutError, OSError) as exc:
        return {"robots_http_status": None, "robots_permission": "unknown", "error": type(exc).__name__}

    parser = RobotFileParser()
    parser.parse(content.splitlines())
    return {
        "robots_http_status": 200,
        "robots_permission": "allowed" if parser.can_fetch(USER_AGENT, url) else "disallowed",
    }


def verify_demo() -> dict[str, object]:
    response = Fetcher.get(DEMO_URL, timeout=15, retries=1)
    count = 0
    examples: list[dict[str, str]] = []
    if response.status == 200:
        jobs = extract_demo_jobs(response)
        count = len(jobs)
        examples = jobs[:3]
    return {
        "target": "realpython-fake-jobs",
        "is_real_job_data": False,
        "http_status": response.status,
        "extracted_count": count,
        "sample": examples,
        "passed": response.status == 200 and count >= 10,
    }


def audit_jobkorea() -> dict[str, object]:
    policy = audit_robots(JOBKOREA_URL)
    return {
        "target": "jobkorea",
        **policy,
        "fetch_attempted": False,
        "reason": "Read-only policy diagnostic; terms/reuse permissions need review. Do not bypass restrictions.",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=("demo", "jobkorea"), required=True)
    args = parser.parse_args()
    try:
        result = verify_demo() if args.target == "demo" else audit_jobkorea()
    except Exception as exc:
        result = {"target": args.target, "passed": False, "error_type": type(exc).__name__, "message": str(exc)[:200]}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if result.get("passed") is False else 0


if __name__ == "__main__":
    sys.exit(main())
