"""
AUM index — BUILD-TIME precompute.
==================================
Emits public/aum-index.json = { "<code>": aumCr, ... } for every fund that has an
AUM figure in its detail file. The Fund Landscape scatter (FundDetail + Explore)
needs AUM for ALL peers to size bubbles, but base funds.json carries only metrics;
AUM lives per-fund in public/fund-data/<code>.json (fund.aum.current). This rolls
those up into one small lookup the client fetches once.
"""
import os
import json
import glob

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
DETAIL_DIR = os.path.join(ROOT, "public", "fund-data")
OUT_PATH = os.path.join(ROOT, "public", "aum-index.json")


def main():
    index = {}
    for fpath in glob.glob(os.path.join(DETAIL_DIR, "*.json")):
        code = os.path.splitext(os.path.basename(fpath))[0]
        try:
            d = json.load(open(fpath, encoding="utf-8"))
        except Exception:
            continue
        aum = (d.get("aum") or {}).get("current")
        if isinstance(aum, (int, float)) and aum > 0:
            index[code] = round(float(aum), 1)
    tmp = OUT_PATH + ".tmp"
    json.dump(index, open(tmp, "w", encoding="utf-8"), separators=(",", ":"))
    os.replace(tmp, OUT_PATH)
    print(f"Wrote {OUT_PATH} with AUM for {len(index)} funds")


if __name__ == "__main__":
    main()
