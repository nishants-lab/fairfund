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
  equity: displayStockName('x-exchange-ltd', 'X Exchange Ltd Equity'),
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


    def test_plan_suffix_names_only_a_stated_option(self):
        probe = """
import { planSuffix } from './scripts/research-pages.mjs'
console.log(JSON.stringify([
  planSuffix({ name: 'Sundaram Multi Cap Fund - Income Distribution CUM Capital Withdrawal ( )', fullName: 'Sundaram Multi Cap Fund - Direct Plan - Income Distribution CUM Capital Withdrawal Option (IDCW)' }),
  planSuffix({ name: 'X Multi Cap Fund', fullName: 'X Multi Cap Fund - Direct Plan - IDCW' }),
  planSuffix({ name: 'UTI - Dividend Yield Fund', fullName: 'UTI-Dividend Yield Fund.-Growth-Direct' }),
  planSuffix({ name: 'ICICI Prudential Nifty 50 Index Fund', fullName: 'ICICI Prudential Nifty 50 Index Fund - Direct Plan Cumulative Option' }),
  planSuffix({ name: 'HDFC Nifty 50 Index Fund', fullName: 'HDFC Nifty 50 Index Fund - Direct Plan' }),
  planSuffix({ name: 'Kotak Dividend Yield Fund', fullName: 'Kotak Dividend Yield Fund' }),
  planSuffix({ name: 'Y Fund Direct', fullName: 'Y Fund Direct Growth' }),
]))
"""
        r = subprocess.run([NODE, '--input-type=module', '-e', probe], cwd=ROOT, text=True, capture_output=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout), [' Direct', ' Direct IDCW', ' Direct Growth', ' Direct Growth', ' Direct', ' Direct', ''])


if __name__ == '__main__':
    unittest.main()
