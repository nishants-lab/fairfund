"""
Groww scheme lookups that prove which fund a payload belongs to.
=================================================================
WHY (2026-10-21): two failure modes put wrong or stale holdings on the site.

1. Wrong fund. Legacy slugs were matched by name, so eight funds pointed at a
   sibling's Groww page (DSP Nifty 50 -> DSP Nifty Next 50, SBI Nifty IT -> SBI
   Nifty, Tata Value -> Tata Ethical, ...). The capture trusted the slug, so
   those funds showed another fund's holdings, AUM, expense ratio and managers.
2. Renamed page. When a fund is renamed Groww answers the old slug with HTTP 308
   and a JSON body whose search_id is the new slug. urllib raised on the 308, the
   capture logged fetch_failed, and 30 funds kept a June or July portfolio.

Every Groww scheme payload carries the AMFI scheme_code, which is the identity
the site uses. fetch_scheme_verified follows rename redirects and only returns a
payload whose scheme_code is the fund's own code. Nothing else is trusted.
"""
import json
import time
import urllib.error
import urllib.request

SCHEME_URL = "https://groww.in/v1/api/data/mf/web/v2/scheme/search/"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "application/json"}
MAX_REDIRECTS = 3


def scheme_matches(code, payload):
    """True only when the payload's own scheme_code is this fund's AMFI code.

    scheme_code alone decides. direct_scheme_code names the direct plan of the
    scheme on the page, so a regular-plan page (same holdings, higher expense
    ratio) or a contradictory payload would pass a check that also accepted it.
    A payload with no scheme_code is not accepted: absence is not proof.
    """
    if not isinstance(payload, dict):
        return False
    want = str(code).strip()
    got = payload.get("scheme_code")
    return bool(want) and got not in (None, "") and str(got).strip() == want


def groww_get(slug, timeout=25, retries=4, sleep=time.sleep):
    """One Groww scheme lookup.

    Returns (kind, value):
      ("ok", payload)        200 with a JSON payload
      ("redirect", slug)     308 whose body names the scheme's current slug
      ("not_found", None)    404
      ("failed", None)       anything else after retries
    """
    for attempt in range(retries):
        try:
            req = urllib.request.Request(SCHEME_URL + slug, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return "ok", json.loads(r.read().decode("utf-8", errors="replace"))
        except urllib.error.HTTPError as e:
            if e.code in (301, 302, 307, 308):
                try:
                    body = json.loads(e.read().decode("utf-8", errors="replace"))
                except Exception:
                    body = {}
                new = (body or {}).get("search_id")
                if new and new != slug:
                    return "redirect", new
                return "failed", None
            if e.code == 404:
                return "not_found", None
            if e.code in (429, 403):
                sleep(min(2 ** (attempt + 2), 30))
                continue
            sleep(0.5 * (2 ** attempt))
        except Exception:
            sleep(0.5 * (2 ** attempt))
    return "failed", None


def fetch_scheme_verified(code, slug, get=groww_get):
    """Fetch a scheme by slug, follow renames, and prove identity.

    Returns a dict:
      status  "ok"                payload belongs to `code`, slug unchanged
              "renamed"           payload belongs to `code`; `slug` is the new slug
              "identity_mismatch" the page is a different scheme; payload withheld
              "not_found" | "fetch_failed" | "redirect_loop"
      slug    the slug that produced the payload (the new one after a rename)
      payload the scheme payload, only for ok / renamed
      got     the scheme_code Groww returned, for mismatch reporting
    """
    seen = [slug]
    current = slug
    for _ in range(MAX_REDIRECTS + 1):
        kind, value = get(current)
        if kind == "redirect":
            if value in seen:
                return {"status": "redirect_loop", "slug": current, "payload": None, "got": None}
            seen.append(value)
            current = value
            continue
        if kind == "not_found":
            return {"status": "not_found", "slug": current, "payload": None, "got": None}
        if kind != "ok":
            return {"status": "fetch_failed", "slug": current, "payload": None, "got": None}
        got = value.get("scheme_code") if isinstance(value, dict) else None
        if not scheme_matches(code, value):
            return {"status": "identity_mismatch", "slug": current, "payload": None, "got": got}
        return {"status": "renamed" if current != slug else "ok", "slug": current,
                "payload": value, "got": got}
    return {"status": "redirect_loop", "slug": current, "payload": None, "got": None}
