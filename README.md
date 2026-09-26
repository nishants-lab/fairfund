# FairFund — Data-Backed Mutual Fund Research for India

Live site: [nishants-lab.github.io/fairfund](https://nishants-lab.github.io/fairfund/)

A data-driven mutual fund research tool that compares **989 active Indian mutual funds** (equity, liquid, money market and arbitrage) across fixed time windows, within their own category, using metrics that actually matter. No ads, no affiliate links, no sponsored rankings.

## What it does

- **Fair rankings** — every fund scored within its own category over the same time windows (1Y/3Y/5Y), so a small-cap is not penalized for being riskier than a large-cap
- **Custom time-period analysis** — analyze any fund over ANY date range with live-computed CAGR, Sharpe, Sortino, max drawdown, and more
- **Fund comparison** — side-by-side metrics over a shared custom period + normalized growth chart + green-highlight on winner per metric
- **Forward-looking signals** — skill consistency (rolling alpha), capture ratios, regime stress-test performance, worst-case drawdown analysis
- **8 market regimes** — how each fund performed during the COVID crash, the 2022-24 bull run, the 2025 recovery rally, the 2026 correction, etc. with a "+ Compare" picker to benchmark against any other fund
- **Verdict system** — automated plain-English assessment per fund (green/amber/red) based on quantitative signals, not opinion
- **Portfolio moves scoring** — tracks what each fund added and exited, then scores how those moves performed post-change (smart moves vs questionable moves)
- **Management quality** — manager track record across all their funds, median alpha, and category beat rate
- **Holdings analysis** — stock-level disclosure with sector breakdown, MoM weight changes, and holdings overlap between any two funds
- **Liquid / money market / arbitrage coverage** — cost-anchored scoring (expense ratio 45%, return-vs-peers 35%, AUM 20%) within SEBI sub-category peer sets
- **Portfolio import** — upload a CAMS statement (PDF) to see your real portfolio analyzed with live NAV, day change, XIRR, and gain/loss per holding
- **Smart search** — autocomplete across all funds by name, AMC, or category with natural-language intent parsing
- **Per-fund social cards** — every fund has a unique 1200x630 OG image for rich unfurling on WhatsApp, Twitter, Slack, etc.
- **SEO-friendly fund shells** — 989 crawlable HTML pages with per-fund meta tags and sitemap.xml for Google indexing
- **Dark/light mode** — remembers your choice
- **Mobile-first responsive** — works cleanly on all screen sizes
- **PWA** — installable as a home-screen app with offline support

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Vite + React 18 + TypeScript |
| Styling | Tailwind CSS (class-based dark mode) |
| Charts | Recharts |
| Routing | React Router (HashRouter, works on any static host) |
| Data | Static JSON (funds.json + fund_analytics.json) |
| NAV history | Self-hosted cache (public/nav/*.json) + live mfapi.in fallback |
| OG images | satori + @resvg/resvg-js (build-time PNG generation) |
| Hosting | GitHub Pages (free) via GitHub Actions |
| Pipeline | Python (pandas, numpy) — offline batch compute |

## Data Pipeline

All analytics are pre-computed offline and shipped as static JSON:

| Script | Purpose |
|--------|---------|
| `scripts/build_analytics.py` | Main pipeline: computes regime returns, skill metrics, capture ratios, drawdown analysis for all qualifying equity funds |
| `pipeline/detect_regimes.py` | Defines market regimes (known + auto-detected) |
| `pipeline/compute_metrics.py` | Fixed-window metric computation (CAGR, alpha, ranks) |
| `pipeline/compute_rankings.py` | Within-category percentile rankings |
| `pipeline/refresh.py` | Orchestrates daily NAV updates |

### Market Regimes (8 total)
COVID crash, COVID recovery, 2022 correction, 2022-24 bull run, 2024-25 correction, 2025 recovery rally,
2026 correction, post-correction drift, plus auto-detected recent regimes.

Every regime must clear a magnitude bar (at least an 8% net index move or an 8% drawdown within the
window) and its `market` label must match what the benchmark actually did. `detect_regimes.py` fails the
build otherwise, so short non-events and mislabelled windows cannot ship. A deliberately flat, choppy
stretch is labelled `mixed` and is exempt from the magnitude bar.

## Build Pipeline

The production build runs five stages:

```
tsc -b                          # type-check
vite build                      # bundle app into dist/
node scripts/gen-og-images.mjs  # render 989 per-fund OG PNGs (satori + resvg)
node scripts/gen-unfurls.mjs    # emit 989 fund + 4 section crawlable HTML shells
node scripts/gen-sitemap.mjs    # generate sitemap.xml from the shells
```

## Forward Analytics (per fund)

Each fund page includes a "Forward-looking Signals" section with:

1. **Rank trajectory** — is the fund's category rank improving or declining?
2. **Skill and consistency** — rolling 12-month alpha hit-rate (batting average)
3. **Capture ratios** — up-capture vs down-capture (does it capture gains but limit losses?)
4. **Regime stress test** — performance during each market regime with comparison capability
5. **Worst historical fall and recovery** — deepest drawdown, recovery time, comparison vs category median (tiered severity: green/amber/red)
6. **Modeled return distribution** — histogram of all rolling N-year returns with percentile range

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
  components/     # Reusable UI (ForwardAnalytics, VerdictCard, PortfolioMoves, etc.)
  pages/          # Route pages (Home, FundDetail, Compare, Explore, Movers, Portfolio, etc.)
  lib/            # Data loading, metrics engine, formatting, verdict logic
  data/           # Static JSON datasets (funds.json, fund_analytics.json, regimes.json)
public/
  nav/            # Per-fund NAV history files (989 funds)
scripts/
  gen-og-images.mjs   # Per-fund social card image generator
  gen-unfurls.mjs     # Crawlable HTML shell generator for OG tags
  gen-sitemap.mjs     # Sitemap generator
  build_analytics.py  # Python analytics pipeline
pipeline/             # Core pipeline modules
```

## Disclaimer

FairFund is an educational research tool, **not investment advice**. We are not a SEBI-registered investment adviser. Past performance does not guarantee future returns. Always consult a qualified financial advisor before investing.
