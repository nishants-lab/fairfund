"""One-off: re-filter already-captured holdings-history snapshots to drop
non-positive / cash / payables line items that the first capture stored raw.
Idempotent — safe to run repeatedly. After this, future captures stay clean
because capture_holdings_snapshot.norm_holdings filters at source."""
import os, json

HERE = os.path.dirname(os.path.abspath(__file__))
HIST_DIR = os.path.abspath(os.path.join(HERE, "..", "mf-website-v2", "public", "holdings-history"))

CASH_KEYS = ("net payable", "net receivable", "net current asset", "treps",
             "reverse repo", "cash", "cblo", "margin", "triparty")
DROP_INSTR = {"futures", "options", "index derivatives", "repo", "reverse repo",
              "treasury bills", "treasury bill", "cblo", "tri-party repo"}


def keep(h):
    p = h.get("pct")
    if p is None or p <= 0:
        return False
    low = (h.get("name") or "").lower()
    if any(k in low for k in CASH_KEYS):
        return False
    if (h.get("instrument") or "").strip().lower() in DROP_INSTR:
        return False
    return True


def main():
    files = [f for f in os.listdir(HIST_DIR) if f.endswith(".json") and not f.startswith("_")]
    changed = 0
    removed_total = 0
    deduped_total = 0
    for fn in files:
        p = os.path.join(HIST_DIR, fn)
        rec = json.load(open(p, encoding="utf-8"))
        touched = False
        for pd, snap in rec.get("snapshots", {}).items():
            hs = snap.get("holdings") or []
            cleaned = []
            seen = set()
            for h in hs:
                if not keep(h):
                    continue
                k = h.get("key") or (h.get("name") or "").lower()
                if k in seen:
                    deduped_total += 1
                    continue
                seen.add(k)
                cleaned.append(h)
            if len(cleaned) != len(hs):
                removed_total += len(hs) - len(cleaned)
                snap["holdings"] = cleaned
                touched = True
        if touched:
            json.dump(rec, open(p, "w", encoding="utf-8"), separators=(",", ":"))
            changed += 1
    print(f"Cleaned {changed} files; removed {removed_total} line items "
          f"({deduped_total} duplicates).")


if __name__ == "__main__":
    main()
