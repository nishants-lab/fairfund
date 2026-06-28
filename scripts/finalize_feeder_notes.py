"""
Finalize feeder messaging. We attempt ETF look-through where Groww exposes it;
otherwise we keep an HONEST, informative label naming the underlying ETF/fund
(never wrong stock data). Sets a clean `coverage` + `note` + `underlying`.

Categories:
  - lookthrough_etf  : adopted underlying ETF stock holdings (if resolvable)
  - feeder_domestic  : tracks a domestic ETF/index; underlying named, holdings
                       mirror that ETF (we name it, don't fake stocks)
  - feeder_foreign   : invests into an overseas fund; no public stock disclosure
"""
import json, os
from collections import Counter

ROOT = r"c:\Users\nisan\Documents\1. Work Related\1. Fresh\Kiro"
HOLD = os.path.join(ROOT, "fund_holdings.json")
d = json.load(open(HOLD, encoding="utf-8"))

FOREIGN_KW = ["jpmorgan", "jp morgan", "jennison", "sicav", "u18", "usd",
              "off-shore", "offshore", "luxembourg", "ucits", "accumulation",
              "global select real estate", "aqua"]

changed = 0
for k, v in d.items():
    if v.get("coverage") not in ("feeder_unresolved",):
        continue
    und = (v.get("underlying") or "").strip()
    low = und.lower()
    is_foreign = any(x in low for x in FOREIGN_KW) and "etf" not in low
    if is_foreign:
        v["coverage"] = "feeder_foreign"
        v["note"] = (f"Feeder fund: invests into {und} (an overseas fund). "
                     f"Stock-level holdings aren't publicly disclosed in India, so we don't show them rather than guess.")
    else:
        v["coverage"] = "feeder_domestic"
        v["note"] = (f"Fund-of-fund: invests into {und}. Its portfolio mirrors that ETF/index. "
                     f"We name the underlying rather than show second-hand stock weights.")
    changed += 1

json.dump(d, open(HOLD, "w", encoding="utf-8"))
print(f"Updated {changed} feeder notes")
print("Coverage:", Counter(v["coverage"] for v in d.values()))
