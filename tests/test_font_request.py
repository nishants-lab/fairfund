"""The home page should not download font files it barely uses."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class FontRequestTests(unittest.TestCase):
    def test_newsreader_is_requested_upright_only(self):
        # The italic face is a second ~147 KB file. Only five rank numbers on
        # Home were italic, and the browser can slant those without it.
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        urls = re.findall(r'href="(https://fonts\.googleapis\.com/css2\?[^"]+)"', html)
        self.assertEqual(len(urls), 1, urls)
        newsreader = re.search(r"family=Newsreader:([^&]+)", urls[0]).group(1)
        self.assertNotIn("ital", newsreader)


if __name__ == "__main__":
    unittest.main()
