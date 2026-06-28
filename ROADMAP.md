# FairFund Product Roadmap
_Created: 2026-06-28_

## Current State (What We Have)

### Data Architecture
- **838 funds** across 18 categories
- **Static in funds.json:** Rankings (catRank, score), alpha, batting average, capture ratios, regime analysis, holdings snapshot, stock moves (smart score)
- **Computed live (client-side):** CAGR, Sharpe, Sortino, Max DD, Volatility, rolling returns distribution, outcome cones, drawdown recovery
- **NAV:** Self-hosted cache (public/nav/*.json) + live mfapi.in with 4s timeout fallback
- **Holdings history:** Monthly Groww scrape -> public/holdings-history/{code}.json (accumulating snapshots)
- **Stock moves:** Post-move returns via Yahoo Finance price data -> smart score per fund

### Existing Pipeline Scripts
| Script | What it does | Trigger |
|--------|-------------|---------|
| `update_nav_daily.py` | Appends daily NAV from AMFI NAVAll.txt | Manual / CI weekdays |
| `sync_nav_files.py` | Creates nav files for new funds (mfapi.in) | Manual |
| `capture_holdings_snapshot.py` | Captures current portfolio from Groww | Manual / monthly |
| `build_stock_moves.py` | Computes adds/exits + post-move returns | Manual / monthly |

### What's Missing for "Product"
1. **No automated refresh** - someone runs scripts manually
2. **Rankings frozen** at anchor date - no automatic recomputation
3. **No user accounts** - can't save watchlists, portfolios
4. **No revenue mechanism** - no premium tier, no ads
5. **No admin interface** - adding a fund = edit JSON + rerun pipeline
6. **Holdings history** exists but UI only shows latest + stock moves (no time-series view)
7. **No mobile app** - responsive web only

---

## Phase 1: Automation + Admin (Week 1-2)

### 1A. GitHub Actions - Fully Automated Data Pipeline

```
Daily (weekdays 10:30 PM IST):
  1. update_nav_daily.py - append today's NAV
  2. Rebuild funds.json rankings (NEW: compute_rankings.py)
  3. Deploy to GitHub Pages

Monthly (1st of month):
  1. capture_holdings_snapshot.py - new portfolio data
  2. build_stock_moves.py - recompute smart scores
  3. Commit + deploy
```

**What's needed:**
- `pipeline/compute_rankings.py` - recompute catRank, alpha, composite score from fresh NAV (port the existing logic from your initial data generation script)
- Wire existing scripts into the GitHub Actions workflow (already created: `.github/workflows/refresh-data.yml`)
- The "anchored May 29" problem disappears - anchor updates daily

### 1B. Admin Page (Add/Remove Funds)

**Architecture:** A protected `/admin` route in the React app that:
1. Accepts an AMFI scheme code
2. Validates it (fetches metadata from AMFI/mfapi)
3. Shows preview: fund name, category, NAV history length
4. On confirm: triggers a GitHub Actions workflow via API (`workflow_dispatch`)
5. The workflow runs `pipeline/refresh.py --add-fund CODE`, commits, deploys

**Why GitHub Actions (not a backend)?**
- Zero infrastructure cost
- The "database" is just JSON in git
- Admin auth = GitHub repo write access (you)
- Later: migrate to a real backend when user accounts arrive

**Admin page features:**
- Add fund by AMFI code
- Remove fund (hide from dataset)
- Force refresh all rankings
- View pipeline run history (link to GitHub Actions)
- Holdings coverage dashboard (how many funds have stock-level data)

### 1C. Holdings Time-Series UI

You already accumulate snapshots. The UI enhancement:
- **Timeline view:** Show portfolio changes month-over-month
- **Diff view:** Side-by-side "Added / Exited / Increased / Decreased" (you have the data in stockMoves)
- **Sector rotation chart:** Pie/bar showing sector weight shift over time
- **Smart score badge:** "This manager's recent moves were 73% smart" (already computed)

---

## Phase 2: Revenue (Week 3-4)

### Revenue Model: Freemium + Affiliate Hybrid

**Free tier (current features):**
- Browse all 838 funds
- Basic metrics (CAGR, Sharpe, category rank)
- Compare up to 2 funds
- Holdings (latest snapshot only)

**Premium tier (Rs 199/month or Rs 1,499/year):**
- Rolling returns distribution + outcome cones
- Holdings change history (full timeline)
- Smart score + stock move analysis
- Compare unlimited funds
- Portfolio tracker (enter your holdings, see aggregated analytics)
- SIP outcome simulator with your actual fund mix
- Alerts: "Fund dropped out of top 5" / "Max DD exceeded threshold"
- Export to PDF/Excel
- Ad-free

**Affiliate revenue (immediate, zero-cost):**
- "Invest in this fund" buttons -> link to Groww/Kuvera/MFUtility with affiliate tracking
- Groww affiliate program pays Rs 150-300 per new demat account
- Kuvera pays per SIP started
- Non-intrusive and aligned with user intent

**Implementation:**
- Auth: Firebase Auth (Google sign-in, free tier covers 50K MAU)
- Payment: Razorpay Subscription (Rs 0 setup, 2% per transaction)
- Feature gating: React context that checks subscription status
- No backend needed initially - Firebase + Razorpay webhooks + GitHub Pages

---

## Phase 3: Mobile App (Week 5-6)

### Capacitor (Recommended Path)

```
Your React app (unchanged)
       |
Capacitor shell (WebView + native bridges)
       |
Android APK -> Play Store
```

**Why Capacitor over TWA:**
- Push notifications (Firebase Cloud Messaging)
- Offline mode (Capacitor Storage + Service Worker)
- Share sheet integration
- Biometric lock (optional, for portfolio data)
- App feels native (status bar, splash screen, navigation gestures)

**Play Store requirements:**
- Privacy policy page
- App icons (512x512, 192x192)
- Feature graphic (1024x500)
- Screenshots (phone + tablet)
- Data safety form
- Rs 2,085 one-time developer registration fee

---

## Phase 4: Growth Features (Month 2+)

- **Portfolio Tracker:** User enters funds + amounts, shows total XIRR, allocation, overlap
- **SIP Tracker:** Actual performance vs outcome cone projection
- **Alerts:** Push when fund drops rank, NAV hits ATH, DD threshold breached
- **Fund Manager Intelligence:** Track manager changes, tenure, performance under new mgmt
- **Tax-Aware Returns:** LTCG/STCG impact, harvest opportunities
- **Weekly Digest Email:** "Your watchlist this week"

---

## Technical Decisions

### Stay on GitHub Pages (for now)
- Zero hosting cost, CDN-backed
- Git = database (auditable, versioned)
- Migrate to Cloudflare Pages/Vercel when you need SSR or API routes

### When to Add a Backend
Trigger: user accounts. Then add Firebase (auth + Firestore) or Supabase.
Keep fund data static (JSON) - it's public and cacheable.
Backend only stores: user preferences, watchlists, portfolio, subscription status.

### Domain
- Register `fairfund.in` (Rs 699/year)
- Custom domain on GitHub Pages is free (CNAME)
- Helps SEO significantly vs subdomain path

---

## Revenue Timeline Estimate

| Month | Action | Revenue |
|-------|--------|---------|
| 1 | Launch affiliate links (Groww/Kuvera) | Rs 0-5K |
| 2 | Premium tier live (Razorpay) | Rs 5-15K |
| 3 | Play Store app + push notifications | Rs 15-30K |
| 6 | 1000 premium subscribers target | Rs 2L/month |

The Indian MF research space is underserved. Most tools are either too complex
(ValueResearch) or too superficial (Groww/Paytm). FairFund's "forward-looking,
probability-based" angle is genuinely differentiated.
