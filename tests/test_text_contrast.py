"""Coloured text must stay readable on every palette (WCAG AA, 4.5:1).

Tailwind's 500 and 600 shades of green, red, amber, blue, teal and sky are
3.2:1 to 4.4:1 on the site's light backgrounds. Light-mode text uses the 700
shade (800 for amber, whose 700 is 4.3:1 on tinted panels); dark mode gets a 400 (or brand 300) shade, because the palette accent
behind brand-600 is too dark to read on a near-black page.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STRING = re.compile(r"(['\"`])([^'\"`\n]*?)\1")
LOW = re.compile(r"(?<![:\w/-])text-(emerald|rose|red|amber|blue|teal|sky|green|brand)-(500|600)(?![\w/-])|(?<![:\w/-])text-amber-700(?![\w/-])")
NEEDS_DARK = re.compile(r"(?<![:\w/-])text-(emerald|rose|red|blue|teal|sky|green)-700(?![\w/-])|(?<![:\w/-])text-amber-800(?![\w/-])|(?<![:\w/-])text-brand-600(?![\w/-])")
# Pale badge backgrounds stay pale in dark mode, so their dark text is right there too.
PALE_BADGE = re.compile(r"(?<![:\w/-])bg-[a-z]+-(50|100)(?![\w/-])")


def class_strings():
    for path in sorted((ROOT / "src").rglob("*.ts*")):
        if "test" in path.name:
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for match in STRING.finditer(line):
                yield f"{path.relative_to(ROOT)}:{number}", match.group(2)


class TextContrastTests(unittest.TestCase):
    def test_no_low_contrast_text_shades(self):
        bad = [f"{where}: {text}" for where, text in class_strings()
               if any(m.group(0) != "text-brand-600" for m in LOW.finditer(text))]
        self.assertEqual(bad, [])

    def test_coloured_text_has_a_dark_mode_shade(self):
        bad = [f"{where}: {text}" for where, text in class_strings()
               if NEEDS_DARK.search(text) and "dark:text-" not in text and not PALE_BADGE.search(text)]
        self.assertEqual(bad, [])


if __name__ == "__main__":
    unittest.main()
