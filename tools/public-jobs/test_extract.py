import json
from pathlib import Path
import unittest
from unittest.mock import patch

from scrapling import Selector
from extract import canonical_url, extract, fetch_page, FIELDS

URL = "https://www.jobkorea.co.kr/Recruit/GI_Read/10000001"
NOW = "2026-11-14T00:00:00Z"
HTML = (Path(__file__).parent / "fixtures/detail.html").read_text(encoding="utf-8")


def run(html):
    return extract(Selector(html), URL, NOW)


class ExtractionTests(unittest.TestCase):
    def test_five_fields_against_independent_expected_values(self):
        fields = run(HTML)["fields"]
        self.assertEqual({k: fields[k]["value"] for k in FIELDS}, {
            "company": "예시랩", "title": "백엔드 개발자", "location": "서울 금천구",
            "experience": "경력 (3년이상)", "deadline": "2026.12.04(금)",
        })
        self.assertIn("experience:dom_overrides_jsonld", run(HTML)["warnings"])

    def test_missing_is_not_invented_from_title_or_page_text(self):
        fields = run('<title>개발자 채용</title><h1>로그인</h1><p>서울 경력무관 상시채용</p>')["fields"]
        self.assertTrue(all(f["status"] == "missing" and f["value"] is None for f in fields.values()))

    def test_conflicting_title_is_quarantined(self):
        self.assertEqual(run(HTML.replace('<h1>백엔드 개발자</h1>', '<h1>다른 공고</h1>'))["fields"]["title"]["status"], "conflict")

    def test_deadline_inside_inactive_tab_is_preserved(self):
        html = HTML.replace('<div><div><span>마감일', '<div hidden><div><span>마감일')
        self.assertEqual(run(html)["fields"]["deadline"]["value"], "2026.12.04(금)")

    def test_malformed_json_does_not_crash(self):
        self.assertIn("invalid_json_ld", run('<script type="application/ld+json">bad</script>')["warnings"])

    def test_recommendation_is_not_this_job(self):
        self.assertIsNone(run(HTML.replace('GI_Read/10000001', 'GI_Read/999'))["fields"]["company"]["value"])

    def test_multilocation_and_object_experience(self):
        record = {"@type": ["JobPosting"], "url": URL, "title": "개발자", "hiringOrganization": {"name": "예시"},
                  "experienceRequirements": {"monthsOfExperience": 36},
                  "jobLocation": [{"address": {"streetAddress": "서울"}}, {"address": {"streetAddress": "부산"}}]}
        fields = run('<script type="application/ld+json">' + json.dumps([record]) + '</script>')["fields"]
        self.assertEqual(fields["location"]["value"], "서울 / 부산")
        self.assertIsNone(fields["experience"]["value"])
        self.assertIsNone(fields["deadline"]["value"])

    def test_duplicate_dom_values_conflict(self):
        extra = '<div data-sentry-component="QualificationItem"><span>경력</span><div>신입</div></div>'
        self.assertEqual(run(HTML + extra)["fields"]["experience"]["status"], "conflict")

    def test_dom_change_retains_explicit_structured_fallback(self):
        fields = run(HTML.replace('data-sentry-component', 'changed'))["fields"]
        self.assertEqual(fields["experience"]["value"], "경력")
        self.assertEqual(fields["experience"]["evidence"], "jsonld:experienceRequirements")

    def test_url_canonicalization_and_rejection(self):
        self.assertEqual(canonical_url(URL + '?tracking=1#top'), (URL, '10000001'))
        for url in ('http://www.jobkorea.co.kr/Recruit/GI_Read/1', 'https://evil.test/Recruit/GI_Read/1',
                    'https://user@www.jobkorea.co.kr/Recruit/GI_Read/1', URL + '/extra', 'file:///etc/passwd'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                canonical_url(url)

    def test_http_failures_stop_without_retry(self):
        with patch('scrapling.fetchers.Fetcher.get') as get:
            for status in (301, 403, 429, 500):
                get.return_value.status = status
                with self.assertRaises(ValueError):
                    fetch_page(URL)
            self.assertEqual(get.call_count, 4)
            self.assertEqual(get.call_args.kwargs['retries'], 0)
            self.assertFalse(get.call_args.kwargs['follow_redirects'])


if __name__ == '__main__':
    unittest.main()
