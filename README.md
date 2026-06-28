# FairFund — Data-Backed Mutual Fund Research for India

Live site: [nishants-lab.github.io/fairfund](https://nishants-lab.github.io/fairfund/)

A data-driven mutual fund research tool that compares **838 active Indian equity funds** across fixed time windows, within their own category, using metrics that actually matter. No ads, no affiliate links, no sponsored rankings.

## What it does

- **Fair rankings** — every fund scored within its own category over the same time windows (1Y/3Y/5Y), so a small-cap isn'"'"'t penalized for being riskier than a large-cap
- **Forward-looking signals** — skill consistency (rolling alpha), capture ratios, regime stress-test performance, worst-case drawdown analysis
- **10 market regimes** — how each fund performed during COVID crash, 2022-24 bull run, H2 2025 rally, US-Iran war, post-war recovery, etc. with a "+ Compare" picker to benchmark against any other fund
- **Custom time-period analysis** — analyze any fund over ANY date range with live-computed CAGR, Sharpe, Sortino, max drawdown, and more
- **Fund comparison** — side-by-side metrics over a shared custom period + normalized growth chart + green-highlight on winner per metric
- **Verdict system** — automated plain-English assessment per fund (green/amber/red) based on quantitative signals, not opinion
- **Smart search** — autocomplete across all funds by name, AMC, or category
- **Dark/light mode** — remembers your choice
- **Mobile-first responsive** — works cleanly on all screen sizes

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Vite + React 18 + TypeScript |
| Styling | Tailwind CSS (class-based dark mode) |
| Charts | Recharts |
| Routing | React Router (HashRouter, works on any static host) |
| Data | Static JSON (funds.json + fund_analytics.json) |
| NAV history | Self-hosted cache (public/nav/*.json) + live mfapi.in fallback |
| Hosting | GitHub Pages (free) via GitHub Actions |
| Pipeline | Python (pandas, numpy) — offline batch compute |

## Data Pipeline

All analytics are pre-computed offline and shipped as static JSON:

| Script | Purpose |
|--------|---------|
| `scripts/build_analytics.py` | Main pipeline: computes regime returns, skill metrics, capture ratios, drawdown analysis for all 824 qualifying funds |
| `pipeline/detect_regimes.py` | Defines market regimes (known + auto-detected) |
| `pipeline/compute_metrics.py` | Fixed-window metric computation (CAGR, alpha, ranks) |
| `pipeline/compute_rankings.py` | Within-category percentile rankings |
| `pipeline/refresh.py` | Orchestrates daily NAV updates |
| `scripts/build_nav_files.py` | Generates per-fund NAV JSON files from raw data |

### Market Regimes (10 total)
COVID crash, post-COVID rally, 2021 consolidation, 2022 correction, 2022-24 bull run, mid-cap correction (Oct 2024), H2 2025 rally, US-Iran war, post-war recovery, plus auto-detected recent regimes.

## Forward Analytics (per fund)

Each fund page includes a "Forward-looking Signals" section with:

1. **Rank trajectory** — is the fund'"'"'s category rank improving or declining?
2. **Skill & consistency** — rolling 12-month alpha hit-rate (batting average)
3. **Capture ratios** — up-capture vs down-capture (does it capture gains but limit losses?)
4. **Regime stress test** — performance during each market regime with comparison capability
5. **Worst historical fall & recovery** — deepest drawdown, recovery time, comparison vs category median (tiered severity: green/amber/red)

## Getting Started

```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm run build      # production build into dist/
```

### Rebuilding analytics data

```bash
pip install pandas numpy
python scripts/build_analytics.py    # outputs src/data/fund_analytics.json
```

## Deployment

Deployed automatically via GitHub Actions on push to `main`. The workflow at `.github/workflows/deploy.yml` builds and publishes to GitHub Pages.

To deploy manually:
```bash
npm run build
# Upload dist/ to any static host
```

## Project Structure

```
src/
  components/     # Reusable UI (ForwardAnalytics, VerdictCard, InfoTip, etc.)
  pages/          # Route pages (Home, FundDetail, Compare, Explore, Methodology)
  lib/            # Data loading, metrics engine, formatting, verdict logic
  data/           # Static JSON datasets (funds.json, fund_analytics.json, regimes.json)
public/
  nav/            # Per-fund NAV history files (824 funds)
scripts/          # Python pipeline scripts
pipeline/         # Core pipeline modules
```

## Disclaimer

FairFund is an educational research tool, **not investment advice**. Past performance does not guarantee future returns. Always consult a qualified financial advisor before investing.