"""
Indian-market calendar date: the upper bound for every NAV date the pipeline
ingests.

GitHub Actions runners are UTC, so `datetime.now()` there is up to 5h30m behind
the Indian market clock. Between 00:00 and 05:30 IST that yields a "today" one
day early, which would reject a NAV legitimately published for the current
market date. IST is UTC+05:30 all year (no DST), so the market date is a fixed
offset from the UTC instant and needs no tz database.
"""
import re
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))
ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def ist_today(now=None):
    """Today's date in India as YYYY-MM-DD."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(IST).strftime("%Y-%m-%d")


def is_iso_date(value):
    """True for a YYYY-MM-DD string that is also a real calendar date."""
    if not isinstance(value, str) or not ISO_DATE_RE.match(value):
        return False
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return False
    return True


def is_usable_nav_date(value, today_iso=None):
    """True when `value` is a well-formed date at or before the Indian market
    date. Future-dated NAV (AMFI stamps some liquid funds with the next business
    day) and malformed dates must never enter a stored series."""
    if not is_iso_date(value):
        return False
    return value <= (today_iso or ist_today())
