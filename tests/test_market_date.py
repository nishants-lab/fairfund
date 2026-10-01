"""
Regression tests for the NAV date upper bound in the ingestion scripts.

Guards the bug class where a forward-dated (liquid fund) or malformed NAV date is
written into public/nav/{code}.json. Exercises the production helpers directly:
scripts/market_date.py, scripts/backfill_nav_gaps.py and scripts/update_nav_daily.py,
each driven end to end against a scratch NAV directory with a stubbed upstream
response and a fixed clock, so results do not depend on the day the test runs.

Network and sleep calls are replaced with unittest.mock.patch context managers, so
no module state leaks out of a test.

Scratch location: $FF_TEST_TMPDIR, else ~/.aki/tmp when present, else the OS temp
dir (so CI, which has no ~/.aki, still works).

Usage: python tests/test_market_date.py
"""
import json
import os
import sys
import tempfile
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from market_date import IST, is_iso_date, is_usable_nav_date, ist_today

# Fixed clock: every expected date below is derived from it.
FIXED_TODAY = "2026-10-01"
_T = datetime.strptime(FIXED_TODAY, "%Y-%m-%d")
D1 = (_T - timedelta(days=1)).strftime("%Y-%m-%d")
D2 = (_T - timedelta(days=2)).strftime("%Y-%m-%d")
D3 = (_T - timedelta(days=3)).strftime("%Y-%m-%d")
D5 = (_T - timedelta(days=5)).strftime("%Y-%m-%d")
TOMORROW = (_T + timedelta(days=1)).strftime("%Y-%m-%d")
BAD_DATE = "2026-02-30"

errors = []


def check(condition, msg):
    if condition:
        print(f"  PASS  {msg}")
    else:
        print(f"  FAIL  {msg}")
        errors.append(msg)


def scratch_base():
    override = os.environ.get("FF_TEST_TMPDIR")
    if override and os.path.isdir(override):
        return override
    aki_tmp = os.path.join(os.path.expanduser("~"), ".aki", "tmp")
    return aki_tmp if os.path.isdir(aki_tmp) else None


@contextmanager
def scratch_dir():
    with tempfile.TemporaryDirectory(prefix="ff-nav-dates-", dir=scratch_base()) as tmp:
        yield tmp


def iso_to_amfi(iso):
    y, m, d = iso.split("-")
    return f"{d}-{m}-{y}"


def write_nav(tmp, code, dates, navs):
    path = os.path.join(tmp, f"{code}.json")
    with open(path, "w") as f:
        json.dump({"d": list(dates), "v": list(navs), "u": dates[-1]}, f)
    return path


def read_json(path):
    with open(path) as f:
        return json.load(f)


class _FakeResponse:
    """Minimal stand-in for urllib's HTTPResponse context manager."""

    def __init__(self, payload):
        self.status = 200
        self._payload = json.dumps(payload).encode()

    def read(self):
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_ist_today_boundary():
    """The India calendar date, not the runner's UTC date."""
    utc = timezone.utc
    # 19:00 UTC on 30 Sep is 00:30 on 1 Oct in India.
    check(ist_today(datetime(2026, 9, 30, 19, 0, tzinfo=utc)) == "2026-10-01",
          "ist_today: 2026-09-30T19:00Z -> 2026-10-01")
    check(ist_today(datetime(2026, 9, 30, 18, 29, 59, tzinfo=utc)) == "2026-09-30",
          "ist_today: 2026-09-30T18:29:59Z -> 2026-09-30")
    check(ist_today(datetime(2026, 9, 30, 18, 30, tzinfo=utc)) == "2026-10-01",
          "ist_today: 2026-09-30T18:30Z -> 2026-10-01")
    # A naive datetime is read as UTC (what datetime.now() yields on CI runners).
    check(ist_today(datetime(2026, 9, 30, 19, 0)) == "2026-10-01",
          "ist_today: naive datetimes are treated as UTC")
    # IST has no DST: the offset is the same in January and July.
    check(datetime(2026, 1, 1, tzinfo=IST).utcoffset() == timedelta(hours=5, minutes=30)
          and datetime(2026, 7, 1, tzinfo=IST).utcoffset() == timedelta(hours=5, minutes=30),
          "IST offset is +05:30 year round")


def test_is_iso_date():
    for ok in ("2026-10-01", "2024-02-29", "1999-12-31"):
        check(is_iso_date(ok) is True, f"is_iso_date accepts {ok}")
    for bad in ("2026-02-30", "2026-13-01", "2026-00-10", "2026-10-32",
                "01-10-2026", "2026-1-01", "2026-10-01T00:00:00", "", None, 20261001):
        check(is_iso_date(bad) is False, f"is_iso_date rejects {bad!r}")


def test_is_usable_nav_date():
    check(is_usable_nav_date(FIXED_TODAY, FIXED_TODAY) is True, "today is usable")
    check(is_usable_nav_date(D1, FIXED_TODAY) is True, "past date is usable")
    check(is_usable_nav_date(TOMORROW, FIXED_TODAY) is False, "tomorrow is rejected")
    check(is_usable_nav_date("2027-01-01", FIXED_TODAY) is False, "far future is rejected")
    check(is_usable_nav_date(BAD_DATE, FIXED_TODAY) is False, "malformed date is rejected")


def test_backfill_never_writes_future_points():
    """backfill_nav_gaps.main() fills a real hole but refuses future/malformed dates."""
    import backfill_nav_gaps as bf

    payload = {"data": [
        {"date": iso_to_amfi(TOMORROW), "nav": "104.0"},   # AMFI forward-dated
        {"date": iso_to_amfi(BAD_DATE), "nav": "103.5"},   # malformed
        {"date": iso_to_amfi(D1), "nav": "103.0"},
        {"date": iso_to_amfi(D2), "nav": "102.0"},         # fills the hole
        {"date": iso_to_amfi(D3), "nav": "101.0"},
    ]}

    with scratch_dir() as tmp:
        path = write_nav(tmp, "999999", [D3, D1], [101.0, 103.0])
        with mock.patch.object(bf, "NAV_DIR", tmp), \
             mock.patch.object(bf, "CHECK_ONLY", False), \
             mock.patch.object(bf, "ONE_CODE", None), \
             mock.patch.object(bf, "ist_today", return_value=FIXED_TODAY), \
             mock.patch.object(bf.time, "sleep"), \
             mock.patch.object(bf.urllib.request, "urlopen",
                               return_value=_FakeResponse(payload)):
            bf.main()
        healed = read_json(path)

    check(healed["d"] == [D3, D2, D1], f"backfill filled the hole only: {healed['d']}")
    check(healed["v"] == [101.0, 102.0, 103.0], f"values kept in order: {healed['v']}")
    check(TOMORROW not in healed["d"], "backfill: future date not written")
    check(BAD_DATE not in healed["d"], "backfill: malformed date not written")
    check(healed["u"] == D1, f"backfill: u points at the newest stored date: {healed['u']}")
    check(all(is_usable_nav_date(dt, FIXED_TODAY) for dt in healed["d"]),
          "backfill: every stored date is valid and not in the future")


def test_daily_updater_write_boundary():
    """update_nav_daily.main() appends today's NAV and gap days, never a
    forward-dated or malformed one, on both the direct and the backfill path."""
    import update_nav_daily as un

    # AMFI: 'gap' is 5 days behind (triggers the mfapi gap backfill), 'fwd' gets a
    # next-day stamped NAV (the liquid-fund case). Padding keeps the >=1000-row
    # completeness guard satisfied.
    amfi = {"111111": (FIXED_TODAY, 110.0), "222222": (TOMORROW, 220.0)}
    for i in range(1000):
        amfi[f"9{i:06d}"] = (FIXED_TODAY, 1.0)

    history = {
        D3: 103.0,
        D1: 105.0,
        FIXED_TODAY: 110.0,
        TOMORROW: 111.0,   # must never be appended
        BAD_DATE: 99.0,    # must never be appended
    }

    with scratch_dir() as tmp:
        gap_path = write_nav(tmp, "111111", [D5], [100.0])
        fwd_path = write_nav(tmp, "222222", [FIXED_TODAY], [219.0])
        ledger_path = os.path.join(tmp, "nav_staleness.json")
        with mock.patch.object(un, "NAV_DIR", tmp), \
             mock.patch.object(un, "LEDGER_PATH", ledger_path), \
             mock.patch.object(un, "ist_today", return_value=FIXED_TODAY), \
             mock.patch.object(un, "fetch_amfi", return_value=amfi), \
             mock.patch.object(un, "fetch_mfapi_history", return_value=history):
            un.main()
        gap = read_json(gap_path)
        fwd = read_json(fwd_path)
        manifest = read_json(os.path.join(tmp, "_manifest.json"))

    check(gap["d"] == [D5, D3, D1, FIXED_TODAY], f"daily: gap filled through today: {gap['d']}")
    check(gap["v"] == [100.0, 103.0, 105.0, 110.0], f"daily: gap values in order: {gap['v']}")
    check(TOMORROW not in gap["d"], "daily: future date not written on the backfill path")
    check(BAD_DATE not in gap["d"], "daily: malformed date not written on the backfill path")
    check(fwd["d"] == [FIXED_TODAY], f"daily: forward-dated AMFI NAV not appended: {fwd['d']}")
    check(fwd["u"] == FIXED_TODAY, f"daily: u stays at the market date: {fwd['u']}")
    check(manifest.get("111111") == FIXED_TODAY and manifest.get("222222") == FIXED_TODAY,
          f"daily: manifest holds non-future dates: {manifest}")
    check(all(is_usable_nav_date(dt, FIXED_TODAY) for dt in gap["d"] + fwd["d"]),
          "daily: every stored date is valid and not in the future")


if __name__ == "__main__":
    print("=" * 52)
    print("FairFund NAV Date Guard Tests")
    print("=" * 52)
    print()
    test_ist_today_boundary()
    test_is_iso_date()
    test_is_usable_nav_date()
    test_backfill_never_writes_future_points()
    test_daily_updater_write_boundary()
    print()
    print("=" * 52)
    if errors:
        print(f"FAILED: {len(errors)} error(s)")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    print("ALL PASSED")
    sys.exit(0)
