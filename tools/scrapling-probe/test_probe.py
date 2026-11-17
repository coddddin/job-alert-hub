import unittest

from scrapling import Selector

from probe import extract_demo_jobs


class ExtractDemoJobsTests(unittest.TestCase):
    def test_extract_valid_cards_and_skip_incomplete(self):
        page = Selector("""
        <main>
          <div class="card-content">
            <h2 class="title">Python Developer</h2>
            <h3 class="company">Example Company</h3>
            <p class="location">Seoul</p>
          </div>
          <div class="card-content">
            <h2 class="title">Incomplete</h2>
            <h3 class="company">No location</h3>
          </div>
        </main>
        """)
        self.assertEqual(
            extract_demo_jobs(page),
            [{"title": "Python Developer", "company": "Example Company", "location": "Seoul"}],
        )

    def test_empty_page(self):
        self.assertEqual(extract_demo_jobs(Selector("<html><body></body></html>")), [])


if __name__ == "__main__":
    unittest.main()
