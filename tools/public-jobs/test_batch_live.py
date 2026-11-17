import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from scrapling import Selector
from batch_live import run
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
