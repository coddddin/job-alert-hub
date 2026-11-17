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

    def test_section_headings_are_not_company_names(self):
        html = HTML.replace('</body>', '<h2>총 1개의 포지션</h2><h2>접수기간 · 방법</h2><h2>기업정보</h2></body>')
        self.assertEqual(run(html)['fields']['company']['value'], '예시랩')

    def test_company_header_mismatch_is_still_a_conflict(self):
        self.assertEqual(run(HTML.replace('<h2>예시랩</h2>', '<h2>다른 회사</h2>'))['fields']['company']['status'], 'conflict')

    def test_position_badges_preserve_years_and_ignore_other_badges(self):
        html = HTML.replace('</body>', '<div data-sentry-component="PositionJobView"><button aria-controls="p"><span data-slot="badge">경력1년↑</span><span data-slot="badge">정규직</span></button></div></body>')
        self.assertEqual(run(html)['fields']['experience']['value'], '경력1년↑')

    def test_conflicting_positions_are_not_declared_open_to_all_new_graduates(self):
        html = HTML.replace('</body>', '<div data-sentry-component="PositionJobView"><button aria-controls="p"><span data-slot="badge">신입</span></button><button aria-controls="q"><span data-slot="badge">경력3년↑</span></button></div></body>')
        self.assertEqual(run(html)['fields']['experience']['status'], 'conflict')
        self.assertIn('experience:varies_by_position', run(html)['warnings'])

    def test_definition_list_retains_early_closing_condition(self):
        html = HTML.replace('<div><div><span>마감일</span></div><div><span>2026.12.04(금)<br></span></div></div>',
                            '<dl><div><dt>마감일</dt><dd>2026.12.04(금)<span>채용 시 마감</span></dd></div></dl>')
        self.assertEqual(run(html)['fields']['deadline']['value'], '2026.12.04(금) 채용 시 마감')

    def test_deadline_inside_inactive_tab_is_preserved(self):
        html = HTML.replace('<div><div><span>마감일', '<div hidden><div><span>마감일')
        self.assertEqual(run(html)["fields"]["deadline"]["value"], "2026.12.04(금)")

    def test_malformed_json_does_not_crash(self):
        self.assertIn("invalid_json_ld", run('<script type="application/ld+json">bad</script>')["warnings"])

    def test_recommendation_is_not_this_job(self):
        self.assertIsNone(run(HTML.replace('GI_Read/10000001', 'GI_Read/999'))["fields"]["company"]["value"])

    def test_signals_come_from_this_jobs_app_state_only(self):
        def push(text):
            return '<script>self.__next_f.push(' + json.dumps([1, text], ensure_ascii=False) + ')</script>'
        def query(job_id, skills, keywords, note):
            return json.dumps({"dehydratedAt": 1, "state": {"data": {"base": {"overview": {"recruitment": {"workFields": ["서버"]}}},
                "extension": {"common": {"jobId": int(job_id), "skills": [{"name": s} for s in skills],
                "keywords": [{"name": k} for k in keywords], "adminInputEtc": {"adminInputJobTypeEtc": [note]}}}}},
                "queryKey": ["JOBS", job_id]}, ensure_ascii=False, separators=(",", ":"))
        other = query("999", ["간호"], ["조리"], "다른 공고")
        own = query("10000001", ["Spring", "Kotlin"], ["백엔드개발자"], "")
        state = '[' + other + ',' + own + ']'
        field = '<div data-sentry-component="RecruitmentField"><span>모집분야</span><span>백엔드, 서버</span></div>'
        # The app state arrives split across several push chunks.
        html = HTML.replace('</body>', field + push(state[:50]) + push(state[50:]) + '</body>')
        job = run(html)
        self.assertEqual(job["extractorVersion"], "jobkorea-detail/2")
        self.assertEqual(job["signals"], {"skills": ["Spring", "Kotlin"], "duties": None, "jobNames": ["백엔드", "서버", "백엔드개발자"]})
        self.assertNotIn("signals:app_state_missing", job["warnings"])

    def test_signals_without_app_state_keep_visible_fields_and_warn(self):
        field = '<div data-sentry-component="RecruitmentField"><span>모집분야</span><span>프론트엔드</span></div>'
        job = run(HTML.replace('</body>', field + '</body>'))
        self.assertEqual(job["signals"], {"skills": [], "duties": None, "jobNames": ["프론트엔드"]})
        self.assertIn("signals:app_state_missing", job["warnings"])
        self.assertNotIn("signals", run('<h1>로그인</h1>'))

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
        self.assertEqual(run(HTML.replace('</body>', extra + '</body>'))["fields"]["experience"]["status"], "conflict")

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
