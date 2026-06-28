"""
Scope the rebuild: how many Direct-Growth plans are in the full master list,
and how many would the OLD name-based categorizer have selected?

This tells us the API load for fetching authoritative categories, and gives
a first estimate of how many funds the old approach silently dropped.

No heavy API calls here — master list only.
"""
import requests
import re

# ---- OLD v5 categorizer (copied verbatim for audit) ----
EXCLUDE = [
    "bonus", "idcw", "dividend", "-div", " div ", "payout", "reinvest",
    "debt", "liquid", "overnight", "money market", "gilt", " bond", "bond ",
    "duration", "credit risk", "banking & psu", "corporate bond", "psu debt",
    "floating", "fixed maturity", "fmp", "interval", "arbitrage",
    "savings", "ultra short", "low duration", "treasury", "income plus",
    "hybrid", "balanced", "asset alloc", "multi asset", "equity savings",
    "retirement", "children", "solution", "regular savings", "dynamic bond",
    "life stage", "capital protection", "target maturity", "nifty sdl",
    "nifty g-sec", "g-sec", "constant maturity", "income fund",
]
intl_kw = ["nasdaq", "s&p 500", "s & p 500", "us equity", "u.s. ", "u.s opportun",
           "us opportun", "us bluechip", "us blue chip", "us flexible", "us specific",
           "us tech", "global", "international", "world ", "world gold", "world mining",
           "china", "taiwan", "europe", "european", "emerging market", "fang",
           "overseas", "developed", "pan europe", "asean", "japan", "brazil",
           "greater china", "global brand", "global consumer", "global innovation",
           "global equity"]

def old_categorize(name):
    n = name.lower()
    if any(x in n for x in EXCLUDE):
        return None
    if "direct" not in n or "growth" not in n:
        return None
    if any(x in n for x in intl_kw):
        return "International"
    if any(x in n for x in ["index", "nifty", "sensex", "bse "]):
        if any(x in n for x in ["pharma","healthcare","bank"," it ","auto","fmcg","infra","energy","metal","psu","consumption","manufacturing","momentum","quality","esg","defence","digital","realty","media","commodit","private bank","financial"]):
            return "Sectoral/Thematic"
        if "midcap" in n or "mid cap" in n: return "Index-MidCap"
        if "smallcap" in n or "small cap" in n: return "Index-SmallCap"
        if "next 50" in n or "next50" in n: return "Index-Other"
        if any(x in n for x in ["nifty 50","sensex","nifty50","nifty 100","top 50","largecap","large cap"]): return "Index-LargeCap"
        return "Index-Other"
    if "small cap" in n or "smallcap" in n: return "Small Cap"
    if "mid cap" in n or "midcap" in n: return "Mid Cap"
    if "large & mid" in n or "large and mid" in n or "largemid" in n: return "Large & Mid Cap"
    if "large cap" in n or "largecap" in n or "bluechip" in n or "blue chip" in n or "top 100" in n: return "Large Cap"
    if "flexi" in n: return "Flexi Cap"
    if "multi cap" in n or "multicap" in n: return "Multi Cap"
    if "elss" in n or "tax saver" in n or "taxsaver" in n or "long term equity" in n: return "ELSS"
    if "focused" in n: return "Focused"
    if "value" in n or "contra" in n: return "Value/Contra"
    if "dividend yield" in n: return "Dividend Yield"
    if any(x in n for x in ["pharma","healthcare","health care"]): return "Sectoral/Thematic"
    if any(x in n for x in ["bank","financial services","fin services"]): return "Sectoral/Thematic"
    if any(x in n for x in ["technology","tech fund"," it fund","digital"]): return "Sectoral/Thematic"
    if any(x in n for x in ["energy","power","infrastructure","infra "]): return "Sectoral/Thematic"
    if any(x in n for x in ["fmcg","consumption","consumer"]): return "Sectoral/Thematic"
    if any(x in n for x in ["auto ","automobile","metal","commodit","realty","real estate","transportation","logistics","mnc","media","tourism"]): return "Sectoral/Thematic"
    if any(x in n for x in ["quantamental","business cycle","special situation","manufacturing","innovation","opportunit","rural","esg","quant ","psu ","defence","housing","play"]): return "Sectoral/Thematic"
    return None

print("Fetching master list...")
master = requests.get("https://api.mfapi.in/mf", timeout=60).json()
print(f"Total schemes: {len(master)}")

def is_direct_growth(name):
    n = name.lower()
    return "direct" in n and "growth" in n

# A permissive Direct-Growth filter (superset, name-only, cheap)
dg = [m for m in master if is_direct_growth(m["schemeName"])]
print(f"Direct-Growth plans (name-based, permissive): {len(dg)}")

# Exclude obvious non-growth dividend variants that still contain 'growth' wording? keep permissive.
old_selected = [m for m in dg if old_categorize(m["schemeName"])]
print(f"OLD categorizer selected (from Direct-Growth): {len(old_selected)}")
print(f"Direct-Growth plans the OLD categorizer DROPPED: {len(dg) - len(old_selected)}")
print()
print("This DROPPED set is where silent misses hide. Next step audits it")
print("against AMFI authoritative scheme_category.")
