import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest

from scrapling import Selector
from saramin_list import FIELDS, HttpStatusError, detail_url, extract_list, plan, run, search_url

HTML = (Path(__file__).parent / "fixtures/saramin-list.html").read_text(encoding="utf-8")
NOW = "2026-11-17T00:00:00+00:00"


def page():
    return Selector(HTML)


class ExtractTests(unittest.TestCase):
    def test_list_fields_tags_and_canonical_url_against_expected_values(self):
        jobs, broken = extract_list(page(), "백엔드", 1, NOW)
        self.assertEqual([j["externalId"] for j in jobs], ["90000001", "90000002", "90000004"])  # ad block excluded
        self.assertEqual(broken, 1)  # item without a link is counted, not invented
        first = jobs[0]
        self.assertEqual(first["url"], "https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=90000001")
        self.assertEqual({k: first["fields"][k]["value"] for k in FIELDS}, {
            "company": "(주)예시클라우드", "title": "예시클라우드 백엔드 개발자 채용", "location": "서울 강남구",
            "experience": "신입·경력", "deadline": "~ 11/30(월)", "education": "대졸↑", "employment": "정규직",
        })
        self.assertEqual(first["tags"], ["백엔드/서버개발", "Java", "Spring"])
        self.assertTrue(first["tagsTruncated"])
        self.assertEqual(first["warnings"], [])
        self.assertEqual((first["extractorVersion"], first["query"], first["page"]), ("saramin-list/1", "백엔드", 1))

    def test_industry_links_salary_and_missing_fields(self):
        jobs, _ = extract_list(page(), "개발", 1, NOW)
        second, fourth = jobs[1], jobs[2]
        self.assertEqual(second["tags"], ["생산직"])
        self.assertFalse(second["tagsTruncated"])
        self.assertEqual(second["warnings"], [])  # "10,320 원" is salary, not an unknown condition
        self.assertEqual(second["fields"]["deadline"]["value"], "17시마감")
        for name in ("location", "experience", "education", "employment"):
            self.assertEqual(fourth["fields"][name], {"value": None, "status": "missing", "evidence": None})
        self.assertEqual(fourth["warnings"], ["job_condition:unlabelled"])

    def test_urls_are_strict(self):
        self.assertEqual(detail_url("https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=5&x=1")[1], "5")
        for bad in ("https://evil.example/zf_user/jobs/relay/view?rec_idx=5", "/zf_user/jobs/relay/view?rec_idx=a",
                    "/zf_user/jobs/relay/view?rec_idx=1&rec_idx=2"):
            with self.assertRaises(ValueError):
                detail_url(bad)
        self.assertIn("searchword=%EB%B0%B1%EC%97%94%EB%93%9C&recruitPage=2", search_url("백엔드", 2))
        with self.assertRaises(ValueError):
            search_url("백엔드", 11)
        self.assertEqual(plan(["a", "b"], 3), [("a", 1), ("b", 1), ("a", 2)])
        self.assertEqual(len(plan(["a"], 99)), 10)
        self.assertEqual(plan(["a", "b", "c"], 2, offset=4), [("b", 1), ("c", 1)])  # rotation by day


class RunTests(unittest.TestCase):
    def run_with(self, responses, queries=("백엔드", "앱개발"), max_pages=10):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        out = Path(directory.name) / "run"
        calls, sleeps = [], []
        responses = iter(responses)

        def fetch(url):
            calls.append(url)
            result = next(responses)
            if isinstance(result, Exception):
                raise result
            return result
        with contextlib.redirect_stdout(io.StringIO()):
            summary = run(list(queries), out, max_pages=max_pages, fetch=fetch, sleep=sleeps.append, interval=0, now=lambda: NOW)
        return summary, out, calls, sleeps

    def test_block_stops_and_saves_partial_results_with_minimum_interval(self):
        summary, out, calls, sleeps = self.run_with([page(), HttpStatusError(429)])
        self.assertEqual(len(calls), 2)
        self.assertEqual(sleeps, [2.0, 2.0])  # interval=0 is raised to the 2-second floor
        self.assertEqual(summary["stopped"], "access_or_service_error")
        batch = json.loads((out / "batch.json").read_text(encoding="utf-8"))
        self.assertEqual((batch["source"], len(batch["jobs"])), ("saramin", 3))
        self.assertEqual(len((out / "attempts.jsonl").read_text().splitlines()), 2)
        with self.assertRaises(FileExistsError):
            run([], out)

    def test_repeated_pages_end_a_query_tags_are_unioned_and_conflicting_duplicates_kept(self):
        changed = Selector(HTML.replace("~ 11/30(월)", "~ 12/01(화)").replace(">생산직<", ">품질관리<"))
        summary, out, calls, _ = self.run_with([page(), changed, page()], max_pages=4)
        # 백엔드 p1, 앱개발 p1 (one changed duplicate, nothing new), 백엔드 p2 (nothing new); 앱개발 p2 skipped.
        self.assertEqual(len(calls), 3)
        self.assertIsNone(summary["stopped"])
        jobs = json.loads((out / "batch.json").read_text(encoding="utf-8"))["jobs"]
        self.assertEqual([j["externalId"] for j in jobs], ["90000001", "90000001", "90000002", "90000004"])
        self.assertIn("duplicate:conflict", jobs[1]["warnings"])
        self.assertEqual(jobs[2]["tags"], ["생산직", "품질관리"])  # same fields, another visible tag subset

    def test_network_failure_gets_one_retry_then_stops(self):
        # 2026-11-24: 한 번의 연결 지연(20초 초과)으로 회차 전체가 멈췄다. 네트워크 오류만 15초 뒤 한 번 더.
        summary, out, calls, sleeps = self.run_with([TimeoutError(), page()], queries=("백엔드",), max_pages=1)
        self.assertEqual((len(calls), summary["http200"], summary["stopped"]), (2, 1, None))
        self.assertEqual(sleeps, [2.0, 15.0])
        self.assertTrue(summary["attempts"][0]["retried"])
        summary, _, calls, _ = self.run_with([TimeoutError(), TimeoutError()])
        self.assertEqual((len(calls), summary["http200"], summary["stopped"]), (2, 0, "access_or_service_error"))
        # HTTP 상태(차단 신호 포함)는 재시도하지 않는다.
        summary, _, calls, _ = self.run_with([HttpStatusError(429)])
        self.assertEqual((len(calls), summary["stopped"]), (1, "access_or_service_error"))
        summary, _, calls, _ = self.run_with([HttpStatusError(302)])
        self.assertEqual((len(calls), summary["stopped"]), (1, "unexpected_status"))


if __name__ == "__main__":
    unittest.main()
