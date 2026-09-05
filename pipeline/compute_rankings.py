"""
Recompute within-category rankings and composite scores for all funds.
=====================================================================
Called by the daily refresh pipeline after NAV has been updated.

Formula (from Methodology page):
  score = geometric mean of within-category percentile ranks for:
    [sharpe, sortino, calmar, maxDrawdown (higher=less loss), alpha, cagr]
  catRank = rank by score within category (1 = best)

This script operates on the EXISTING metrics in funds.json (the 1Y/3Y/5Y blocks).
It does NOT recompute metrics from raw NAV - that's done by compute_metrics.py.
This only re-ranks based on whatever metrics are already present.

Usage:
  python pipeline/compute_rankings.py                # recompute from funds.json in-place
  python pipeline/compute_rankings.py --dry-run      # show changes without writing
"""
import json
import sys
import os
from math import log, exp
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
FUNDS_JSON = os.path.join(ROOT, "src", "data", "funds.json")

# The 6 metrics used in the composite score (all higher = better).
# maxDrawdown is negative, so higher (less negative) = less loss = better.
SCORE_METRICS = ["sharpe", "sortino", "calmar", "maxDrawdown", "alpha", "cagr"]

# Horizons to rank (each gets its own catRank + score)
HORIZONS = ["1Y", "3Y", "5Y"]

# Debt (cash-equivalent) categories rank on a different, honest basis: gross
# returns are near-identical, so cost dominates net return, size guards liquidity,
# and raw return is only a low-weight tie-breaker (it already embeds TER via NAV).
# Weights are tunable; they must sum to 1.0.
DEBT_CATS = {"Liquid", "Money Market"}
DEBT_WEIGHTS = {"ter": 0.70, "aum": 0.20, "cagr": 0.10}

# Arbitrage funds are equity-taxed but their return is arbitrage spread capture,
# not stock-picking, so the 6 equity risk-adjusted metrics are misleading. They
# rank on the same honest cost+return basis as debt, but with MORE weight on
# return: arbitrage spread-capture skill produces real CAGR dispersion (unlike
# near-identical liquid yields), while thin net returns still make TER decisive.
ARBITRAGE_CATS = {"Arbitrage"}
ARBITRAGE_WEIGHTS = {"ter": 0.45, "aum": 0.20, "cagr": 0.35}


def percentile_rank_higher(val, all_vals):
    """Fraction of peers with a strictly lower value. Range: [0, 1]."""
    n = len(all_vals)
    if n <= 1:
        return 0.5
    below = sum(1 for v in all_vals if v < val)
    return below / (n - 1)


def percentile_rank_lower(val, all_vals):
    """Fraction of peers with a strictly higher value (lower raw value = better)."""
    n = len(all_vals)
    if n <= 1:
        return 0.5
    above = sum(1 for v in all_vals if v > val)
    return above / (n - 1)


def debt_score(fund, m, ter_vals, aum_vals, cagr_vals, weights=DEBT_WEIGHTS):
    """Cost-anchored score for cash-equivalent funds. Weighted arithmetic mean of
    percentile ranks: cheaper TER, larger AUM, higher return. Missing TER/AUM
    fall back to a neutral 0.5 percentile so they neither help nor hurt."""
    ter = fund.get("expenseRatio")
    if isinstance(ter, str):
        try: ter = float(ter)
        except: ter = None
    aum = (fund.get("aum") or {}).get("current") if isinstance(fund.get("aum"), dict) else None
    p_ter = percentile_rank_lower(ter, ter_vals) if (ter is not None and ter_vals) else 0.5
    p_aum = percentile_rank_higher(aum, aum_vals) if (aum is not None and aum_vals) else 0.5
    p_cagr = percentile_rank_higher(m["cagr"], cagr_vals) if cagr_vals else 0.5
    w = weights
    return w["ter"] * p_ter + w["aum"] * p_aum + w["cagr"] * p_cagr


def geometric_mean_score(ranks):
    """Geometric mean of percentile ranks, with floor to prevent log(0)."""
    n = len(ranks)
    if n == 0:
        return 0.0
    # Floor at a small positive value so a single zero doesn't collapse the entire score
    floored = [max(r, 0.01) for r in ranks]
    return exp(sum(log(r) for r in floored) / n)


def recompute_rankings(data, dry_run=False):
    """Recompute catRank and score for all funds, all horizons."""
    funds = data["funds"]
    changes = {"rank_changes": 0, "score_changes": 0, "funds_ranked": 0}

    for horizon in HORIZONS:
        # Group funds by category (only those with this horizon's metrics)
        by_cat = {}
        for f in funds:
            if horizon not in f.get("metrics", {}):
                continue
            m = f["metrics"][horizon]
            # Need all 6 score metrics present
            if not all(k in m and m[k] is not None for k in SCORE_METRICS):
                continue
            cat = f["category"]
            if cat not in by_cat:
                by_cat[cat] = []
            by_cat[cat].append(f)

        for cat, cat_funds in by_cat.items():
            n = len(cat_funds)
            if n < 2:
                # Single fund in category: rank 1, score 1.0
                for f in cat_funds:
                    f["metrics"][horizon]["catRank"] = 1
                    f["metrics"][horizon]["catSize"] = 1
                    f["metrics"][horizon]["score"] = 1.0
                continue

            # Compute composite score for each fund
            scored = []
            if cat in DEBT_CATS or cat in ARBITRAGE_CATS:
                # Cost-anchored ranking for cash-equivalent AND arbitrage funds.
                _w = ARBITRAGE_WEIGHTS if cat in ARBITRAGE_CATS else DEBT_WEIGHTS
                def _ter_of(f):
                    t = f.get("expenseRatio")
                    if isinstance(t, str):
                        try: return float(t)
                        except: return None
                    return t
                ter_vals = [t for t in (_ter_of(f) for f in cat_funds) if t is not None]
                aum_vals = [ (f.get("aum") or {}).get("current") for f in cat_funds
                             if isinstance(f.get("aum"), dict) and (f.get("aum") or {}).get("current") is not None ]
                cagr_vals = [f["metrics"][horizon]["cagr"] for f in cat_funds]
                for f in cat_funds:
                    m = f["metrics"][horizon]
                    score = debt_score(f, m, ter_vals, aum_vals, cagr_vals, _w)
                    scored.append((score, f))
            else:
                # Equity/other: geometric mean of 6 risk-adjusted percentile ranks.
                metric_values = {}
                for metric in SCORE_METRICS:
                    metric_values[metric] = [f["metrics"][horizon][metric] for f in cat_funds]
                for f in cat_funds:
                    m = f["metrics"][horizon]
                    ranks = []
                    for metric in SCORE_METRICS:
                        prank = percentile_rank_higher(m[metric], metric_values[metric])
                        ranks.append(prank)
                    score = geometric_mean_score(ranks)
                    scored.append((score, f))

            # Sort descending by score -> assign ranks
            scored.sort(key=lambda x: -x[0])
            for i, (score, f) in enumerate(scored):
                new_rank = i + 1
                old_rank = f["metrics"][horizon].get("catRank")
                old_score = f["metrics"][horizon].get("score")
                new_score = round(score, 3)

                if old_rank != new_rank:
                    changes["rank_changes"] += 1
                if old_score != new_score:
                    changes["score_changes"] += 1

                f["metrics"][horizon]["catRank"] = new_rank
                f["metrics"][horizon]["catSize"] = n
                f["metrics"][horizon]["score"] = new_score
                changes["funds_ranked"] += 1

            # Also update the category-level stats in the top-level categories block
            cagrs = [f["metrics"][horizon]["cagr"] for f in cat_funds]
            cagrs.sort()
            median_idx = len(cagrs) // 2
            median_cagr = cagrs[median_idx] if len(cagrs) % 2 else (cagrs[median_idx-1] + cagrs[median_idx]) / 2

            if horizon == "3Y" and cat in data.get("categories", {}):
                f["metrics"][horizon]["catMedianCagr"] = round(median_cagr, 2)
                # Update each fund's catMedianCagr
                for f2 in cat_funds:
                    f2["metrics"][horizon]["catMedianCagr"] = round(median_cagr, 2)

    return changes


def update_category_metadata(data):
    """Update top-level category stats (fundCount, medianCagr5Y, topCagr5Y)."""
    funds = data["funds"]
    cats = data.get("categories", {})

    # Keep every fund's top-level categorySize in sync with actual membership.
    from collections import Counter
    cat_counts = Counter(f["category"] for f in funds)
    for f in funds:
        f["categorySize"] = cat_counts[f["category"]]

    for cat_key, cat_info in cats.items():
        cat_funds = [f for f in funds if f["category"] == cat_key]
        cat_info["fundCount"] = len(cat_funds)

        # 5Y stats
        cagrs_5y = [f["metrics"]["5Y"]["cagr"] for f in cat_funds
                    if "5Y" in f.get("metrics", {}) and "cagr" in f["metrics"]["5Y"]]
        if cagrs_5y:
            cagrs_5y.sort()
            mid = len(cagrs_5y) // 2
            cat_info["medianCagr5Y"] = round(
                cagrs_5y[mid] if len(cagrs_5y) % 2 else (cagrs_5y[mid-1] + cagrs_5y[mid]) / 2, 2
            )
            cat_info["topCagr5Y"] = round(max(cagrs_5y), 2)


def main():
    dry_run = "--dry-run" in sys.argv

    if not os.path.exists(FUNDS_JSON):
        print(f"ERROR: {FUNDS_JSON} not found")
        sys.exit(1)

    with open(FUNDS_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)

    print(f"Loaded {len(data['funds'])} funds from {FUNDS_JSON}")
    print(f"Current anchor: {data.get('anchor', 'unknown')}")

    changes = recompute_rankings(data, dry_run=dry_run)
    update_category_metadata(data)

    print(f"\nRanking results:")
    print(f"  Funds ranked: {changes['funds_ranked']}")
    print(f"  Rank changes: {changes['rank_changes']}")
    print(f"  Score changes: {changes['score_changes']}")

    if dry_run:
        print("\n--dry-run: no file written.")
        return

    # Update anchor and generation date
    data["anchor"] = date.today().isoformat()
    data["generatedAt"] = date.today().isoformat()

    with open(FUNDS_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))

    print(f"\nWrote updated {FUNDS_JSON}")
    print(f"New anchor: {data['anchor']}")


if __name__ == "__main__":
    main()
