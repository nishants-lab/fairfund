"""Stock display names (src/data/stock_names.json, scripts/research-pages.mjs)."""
import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which('node') or r'C:\Program Files\nodejs\node.exe'

PROBE = """
import { displayStockName, currentStock, isRawStockName, stockSlug } from './scripts/research-pages.mjs'
const out = {
  piramal: currentStock({ key: 'dewan-housing-finance-corporation-ltd', name: 'DEWAN HOUSING FINANCE CORP. LTD. EQ' }),
  aadhar: currentStock({ key: 'aadhar-housing-finance-ltd', name: 'DHFL VYSYA HOUSING FINANCE LIMITED EQ' }),
  hdb: displayStockName('hdb-financial-services-ltd', 'HDB FINANCIAL SERVICES LIMITED EQ'),
  suffix: displayStockName('new-co-ltd', 'New Co Ltd EQ NEW FV RS.2/-'),
  equity: displayStockName('x-ltd', 'X Exchange Ltd Equity'),
  plain: displayStockName('infosys-ltd', 'Infosys Ltd.'),
  raw: [isRawStockName('TATA CAPITAL LIMITED EQ'), isRawStockName('Infosys Ltd'), isRawStockName('ITC Ltd'), isRawStockName('DOMS Industries Ltd.')],
  slug: stockSlug('Aadhar Housing Finance Ltd'),
}
console.log(JSON.stringify(out))
"""


class StockNameTests(unittest.TestCase):
    def test_every_rename_is_sourced(self):
        data = json.loads((ROOT / 'src/data/stock_names.json').read_text(encoding='utf-8'))
        for slug, r in data['renames'].items():
            self.assertTrue(r['name'] and r['formerly'] and r['source'], slug)
        for slug, name in data['display'].items():
            self.assertFalse(name.isupper(), slug)
            self.assertNotRegex(name, r'\s(EQ|Equity)\b', slug)

    def test_names_resolve(self):
        r = subprocess.run([NODE, '--input-type=module', '-e', PROBE], cwd=ROOT, text=True, capture_output=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        self.assertEqual(out['piramal'], {'name': 'Piramal Finance Ltd', 'formerly': 'Dewan Housing Finance Corporation Ltd'})
        self.assertEqual(out['aadhar'], {'name': 'Aadhar Housing Finance Ltd', 'formerly': 'DHFL Vysya Housing Finance Ltd'})
        self.assertEqual(out['hdb'], 'HDB Financial Services Ltd')
        self.assertEqual(out['suffix'], 'New Co Ltd')
        self.assertEqual(out['equity'], 'X Exchange Ltd')
        self.assertEqual(out['plain'], 'Infosys Ltd.')
        self.assertEqual(out['raw'], [True, False, False, False])
        self.assertEqual(out['slug'], 'aadhar-housing-finance-ltd')


if __name__ == '__main__':
    unittest.main()
