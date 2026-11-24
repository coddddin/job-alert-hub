import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from scrapling import Selector
from batch_live import discover, run
from extract import HttpStatusError

HTML = (Path(__file__).parent / 'fixtures/detail.html').read_text(encoding='utf-8')
URL = 'https://www.jobkorea.co.kr/Recruit/GI_Read/10000001'


class BatchTests(unittest.TestCase):
    def test_redirect_skipped_then_block_stops_and_saves_partial_results(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / 'run'
            responses = iter([HttpStatusError(307), Selector(HTML), HttpStatusError(429)])
            calls = []
            def fetch(url):
                calls.append(url)
                result = next(responses)
                if isinstance(result, Exception):
                    raise result
                return result
            with contextlib.redirect_stdout(io.StringIO()):
                result = run([URL] * 4, out, fetch=fetch, sleep=lambda _: None)
            self.assertEqual(len(calls), 3)
            self.assertEqual(result['http200'], 1)
            self.assertEqual(result['stopped'], 'access_or_service_error')
            self.assertEqual(len((out / 'attempts.jsonl').read_text().splitlines()), 3)
            self.assertEqual(len(json.loads((out / 'batch.json').read_text(encoding='utf-8'))['jobs']), 1)
            with self.assertRaises(FileExistsError):
                run([], out)

    def test_network_failure_stops_without_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            def fetch(_):
                raise TimeoutError()
            with contextlib.redirect_stdout(io.StringIO()):
                result = run([URL] * 3, Path(directory) / 'run', fetch=fetch, sleep=lambda _: None)
            self.assertEqual(result['attempted'], 1)
            self.assertEqual(result['http200'], 0)

class RetryTests(unittest.TestCase):
    def test_network_error_gets_one_retry_but_blocking_status_does_not(self):
        with tempfile.TemporaryDirectory() as directory:
            responses = iter([TimeoutError(), Selector(HTML), HttpStatusError(429)])
            def fetch(url):
                result = next(responses)
                if isinstance(result, Exception):
                    raise result
                return result
            sleeps = []
            with contextlib.redirect_stdout(io.StringIO()):
                result = run([URL, URL], Path(directory) / 'run', fetch=fetch, sleep=sleeps.append)
            self.assertEqual(result['http200'], 1)  # timeout → retried → 200
            self.assertEqual(sleeps, [2, 15, 2])
            self.assertEqual(result['stopped'], 'access_or_service_error')  # 429 is not retried


class DiscoverTests(unittest.TestCase):
    def test_round_robin_skips_seen_ids_and_stops_on_block(self):
        link = lambda n: f'https://www.jobkorea.co.kr/Recruit/GI_Read/{n}'
        pages = {'%EB%B0%B1%EC%97%94%EB%93%9C': [link(1), link(2), link(3)], 'AI': [link(2), link(4)]}
        def fetch(url):
            query = url.split('stext=')[1].split('&')[0]
            if query == 'blocked':
                raise HttpStatusError(429)
            return pages[query]
        selected, searched, stopped = discover(['백엔드', 'AI', 'blocked', 'never'], {'1'}, 3, fetch=fetch, sleep=lambda _: None)
        self.assertEqual(selected, [link(2), link(4), link(3)])  # 1 was seen; each query contributes in turn
        self.assertEqual(stopped, 'access_or_service_error')
        self.assertEqual([s['query'] for s in searched], ['백엔드', 'AI', 'blocked'])  # stops before 'never'
