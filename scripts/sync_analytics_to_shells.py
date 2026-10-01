"""Synchronize shared analytics from the producer into the detail files.

build_analytics writes both fund_analytics.json and funds.json. These must agree
before this sync can treat either as the latest producer output. Only the six
shared fields are replaced; rollingAlpha and other detail extensions survive.
No AUM, expense ratio, investment info, holdings or management fields are touched.

--dry-run reports pending changes without writing. --check also exits nonzero
when changes are pending. All inputs are preflighted before any file is written;
each changed file is replaced atomically. Missing records/shells fail closed.
"""
import argparse
from copy import deepcopy
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FA_PATH = ROOT / 'src/data/fund_analytics.json'
FUNDS_PATH = ROOT / 'src/data/funds.json'
DETAIL_DIR = ROOT / 'public/fund-data'
SHARED_KEYS = ('rankTrajectory', 'battingAverage', 'capture', 'alpha', 'meanReversion', 'regimes')


def shared(record):
    return {key: record[key] for key in SHARED_KEYS if key in record}


def plan_updates():
    records = json.loads(Path(FA_PATH).read_text(encoding='utf-8'))
    funds = json.loads(Path(FUNDS_PATH).read_text(encoding='utf-8'))['funds']
    if not isinstance(records, dict):
        raise ValueError('Analytics producer output must be an object')
    pending = []
    seen = set()
    for fund in funds:
        code = str(fund['code'])
        if not code.isdigit() or code in seen:
            raise ValueError(f'Invalid or duplicate index code: {code}')
        seen.add(code)
        index = fund.get('analytics', {})
        # The producer omits funds without enough month-end NAV history. Missing
        # source + empty index is a valid no-analytics state, not stale fallback.
        if code not in records:
            if not isinstance(index, dict) or shared(index):
                raise ValueError(f'Missing producer analytics for populated index {code}; rebuild analytics')
            source = {}
        elif not isinstance(records[code], dict):
            raise ValueError(f'Invalid producer analytics for {code}')
        else:
            source = records[code]
        if not isinstance(index, dict) or shared(index) != shared(source):
            raise ValueError(f'Producer/index analytics disagree for {code}; rebuild from one snapshot')
        if 'rollingAlpha' in source or 'rollingAlpha' in index:
            raise ValueError(f'rollingAlpha must remain detail-only: {code}')
        path = Path(DETAIL_DIR) / f'{code}.json'
        detail = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(detail, dict):
            raise ValueError(f'Invalid detail object for {code}')
        existing = detail.get('analytics')
        if existing is not None and not isinstance(existing, dict):
            raise ValueError(f'Invalid detail analytics for {code}')
        merged = deepcopy(existing or {})
        for key in SHARED_KEYS:
            merged.pop(key, None)
        merged.update(deepcopy(shared(source)))
        if existing != merged:
            updated = deepcopy(detail)
            updated['analytics'] = merged
            pending.append((path, updated))
    return len(funds), pending


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--dry-run', action='store_true')
    mode.add_argument('--check', action='store_true')
    args = parser.parse_args(argv)
    total, pending = plan_updates()
    print(f'Shared analytics: {len(pending)} of {total} detail files need synchronization')
    if args.dry_run or args.check:
        print('No files written.')
        return 1 if args.check and pending else 0
    for path, detail in pending:
        temporary = path.with_suffix('.json.tmp')
        try:
            temporary.write_text(json.dumps(detail, separators=(',', ':'), ensure_ascii=False), encoding='utf-8')
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)
    print(f'Synchronized {len(pending)} detail files; detail-only extensions preserved.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
