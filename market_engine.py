"""
market_engine.py  --  Chakravyuh trading-game price engine (v6)
================================================================
The full v5 stochastic model from the Developer Handover, extended to the
12-name / 11-factor game and driven by the OFFICIAL content inputs:

  * News factor matrices : "NEWS FACTOR FACTOR MARTIX.xlsx" (13 Jul), both rounds
  * Beta matrix          : regression-estimated (2021-2026 data), hand-curated
  * Headlines            : the bullets already shipped on the website

Adapted from the handover version in two deliberate ways for this site:
  1. Ticks run every 1 real second (not 10) for a smoother live countdown --
     every per-tick stochastic constant below is rescaled from its native
     10-second calibration so the simulated statistics over any real-time
     window are unchanged (see "TICK RESCALING" in Section 2).
  2. Session 2 RESETS prices to a fresh book. Prices and the mean-reversion
     anchor are reset at the session boundary.

WHAT THE WEBSITE DEVELOPER NEEDS TO KNOW
----------------------------------------
Nothing changes on the site. Run this file once:

    python market_engine.py            # fresh random seed -> a brand-new game
    python market_engine.py 7          # pin a seed -> reproduce that exact game

It writes game_data.json in the same schema as before:
  * 2 sessions x 1201 ticks (2402 rows), 1 second per tick
  * meta.seed is saved so any game can be reproduced/approved
  * news items carry bullets (SHOW) + factor/score metadata (NEVER show)
  * universe research strings carry the factor sensitivities the players
    see on the Research tab (and the judge console parses)

THE MODEL IN ONE SENTENCE
-------------------------
Each tick every stock's return = drift + market move + news (factor shocks
x betas, exponentially decaying) + pull-back-to-fair-value + random noise,
and price grows by exp(return) so it can never go negative or sit still.
"""

import json
import sys
import numpy as np

# =====================================================================
# SECTION 1 -- THE CLOCK
# =====================================================================
TICK_SECONDS        = 1
MINUTES_PER_SESSION = 20
SESSIONS             = 2
SUBTICKS             = 60 // TICK_SECONDS               # ticks per minute (60 at 1s ticks)
# +1 so the on-site countdown reads exactly 20:00 at tick 0 and 0:00 at the
# last tick (ticksLeft = ticks_per_session - tickInSession - 1 in app.js/admin.js).
TICKS_PER_SESSION   = MINUTES_PER_SESSION * SUBTICKS + 1
TOTAL_TICKS         = TICKS_PER_SESSION * SESSIONS

# =====================================================================
# SECTION 2 -- GLOBAL KNOBS (v5 values, validated in simulation)
# =====================================================================
# TICK RESCALING -- the values below are calibrated for 10-second ticks.
# Running at 1-second ticks means 10x more ticks over the same real time, so
# every per-tick parameter is rescaled to keep the same real-world statistics
# (standard Euler-Maruyama discretization scaling): additive "drift-like"
# terms (drift, mean-reversion speed, news gain) scale linearly with tick
# duration; noise/volatility terms scale with sqrt(tick duration); a fixed
# real-world reference duration expressed in ticks (REF_TAU) scales inversely.
_CALIBRATED_TICK_SECONDS = 10.0
_DT_SCALE  = TICK_SECONDS / _CALIBRATED_TICK_SECONDS     # 0.1 at 1s ticks
_VOL_SCALE = np.sqrt(_DT_SCALE)                          # ~0.316 at 1s ticks

DRIFT        = 6.2e-5     * _DT_SCALE   # per-tick baseline tilt
REF_TAU      = 36.0       / _DT_SCALE   # reference decay, in ticks (fixed real-world duration)
GAIN_SCALE   = 0.16       * _DT_SCALE   # master "how much news matters" dial
KAPPA        = 0.08       * _DT_SCALE   # mean-reversion spring
PERM_FRAC    = 0.35                     # 35% of a shock permanently moves fair value (dimensionless)
SCORE_SPREAD = 0.20                     # randomness of a headline's realised score (dimensionless)
IDIO_MULT    = 1.6        * _VOL_SCALE  # stock private-noise loudness
MKT_VOL      = 0.004      * _VOL_SCALE  # shared market wiggle per tick
GAIN_RAW     = 0.050                    # per-event gain before GAIN_SCALE (dimensionless base)
TAU_MIN      = 5.0                      # per-event decay, minutes (real-world unit, not rescaled)
GAIN_TAU_FR  = 0.10                     # per-game jitter on gain & tau (dimensionless fraction)
BETA_SPREAD  = 0.05                     # per-game jitter on betas (dimensionless)

# =====================================================================
# SECTION 3 -- THE 11 FACTORS
# =====================================================================
# Names are single words (CamelCase) because the judge console parses
# them out of the research strings with a \w+ regex.
FACTORS = ["InterestRates", "RegulatoryRisk", "Oil", "InflationReaction",
           "GeopoliticalStability", "SemiconductorDemand", "ConsumerDisc",
           "InvestorConfidence", "TechDevelopments", "Aero", "Healthcare"]
NF = len(FACTORS)
FIDX = {f: i for i, f in enumerate(FACTORS)}
# short aliases used in the matrices below
_A = dict(IR="InterestRates", Reg="RegulatoryRisk", Oil="Oil",
          Infl="InflationReaction", Geo="GeopoliticalStability",
          Sem="SemiconductorDemand", Cons="ConsumerDisc",
          InvC="InvestorConfidence", Tech="TechDevelopments",
          Aero="Aero", Hlth="Healthcare")

FACTOR_VOL = np.array([.005, .004, .006, .004, .004, .006, .004, .005, .005, .004, .004]) * _VOL_SCALE

_C = np.eye(NF)
def _cor(a, b, r):
    i, j = FIDX[_A[a]], FIDX[_A[b]]
    _C[i, j] = _C[j, i] = r
_cor("IR", "Infl", 0.35); _cor("Oil", "Infl", 0.30); _cor("Sem", "Tech", 0.35)
_cor("InvC", "Cons", 0.30); _cor("InvC", "Tech", 0.25); _cor("Geo", "InvC", 0.25)
_cor("Geo", "Oil", -0.25); _cor("Aero", "Geo", -0.30); _cor("IR", "InvC", -0.20)
_w, _V = np.linalg.eigh(_C)                        # PSD repair
_C = _V @ np.diag(np.clip(_w, 1e-6, None)) @ _V.T
_d = np.sqrt(np.diag(_C)); FACTOR_CORR = _C / np.outer(_d, _d)

# =====================================================================
# SECTION 4 -- THE 12 TRADEABLES
# =====================================================================
# px = start price (INR, as on the current site) | vol = idio vol per tick
# mkt = market beta | betas = factor sensitivities (regression-estimated,
# sanitized; RegulatoryRisk/GeopoliticalStability and the SpaceX row are
# documented hand-set values -- see "Website Completion Handover" Part 4.2)
STOCKS = {
 "TSMC":     dict(px=7168.31,  vol=.008, mkt=1.40, company="TSMC",            type="Equity",
                  betas={"SemiconductorDemand": .85, "GeopoliticalStability": .30, "RegulatoryRisk": -.30}),
 "FERRARI":  dict(px=35942.28, vol=.006, mkt=0.96, company="Ferrari",         type="Equity",
                  betas={"ConsumerDisc": .40, "InterestRates": -.12, "Oil": -.09}),
 "LMT":      dict(px=49878.82, vol=.005, mkt=0.22, company="Lockheed Martin", type="Equity",
                  betas={"Aero": .75, "GeopoliticalStability": -.40, "Oil": .11, "SemiconductorDemand": -.10,
                         "InvestorConfidence": -.11, "TechDevelopments": -.15, "Healthcare": .13}),
 "HDFC":     dict(px=824.50,   vol=.006, mkt=0.66, company="HDFC Bank",       type="Equity",
                  betas={"InterestRates": -.25, "RegulatoryRisk": -.20, "Oil": -.12, "ConsumerDisc": .10,
                         "InvestorConfidence": .08}),
 "PFE":      dict(px=2304.14,  vol=.005, mkt=0.40, company="Pfizer",          type="Equity",
                  betas={"Healthcare": .75, "RegulatoryRisk": -.35}),
 "RELIANCE": dict(px=1310.00,  vol=.006, mkt=0.50, company="Reliance",        type="Equity",
                  betas={"Oil": .30, "InflationReaction": .30, "InterestRates": -.20, "ConsumerDisc": .20}),
 "DKNG":     dict(px=2524.35,  vol=.010, mkt=1.60, company="DraftKings",      type="Equity",
                  betas={"ConsumerDisc": .45, "RegulatoryRisk": -.40, "TechDevelopments": .35,
                         "InvestorConfidence": .30, "InterestRates": -.20}),
 "SPACEX":   dict(px=13851.52, vol=.009, mkt=1.20, company="SpaceX",          type="Equity",
                  betas={"Aero": .75, "TechDevelopments": .60, "InvestorConfidence": .35,
                         "RegulatoryRisk": -.25, "GeopoliticalStability": -.20, "SemiconductorDemand": .15}),
 "SAMSUNG":  dict(px=18123.06, vol=.007, mkt=0.50, company="Samsung",         type="Equity",
                  betas={"SemiconductorDemand": .80, "InterestRates": -.30, "GeopoliticalStability": .20,
                         "TechDevelopments": .20, "ConsumerDisc": .15, "RegulatoryRisk": -.15}),
 "GOLD":     dict(px=148290.00, vol=.003, mkt=0.13, company="Gold",           type="Commodity",
                  betas={"InterestRates": -.50, "GeopoliticalStability": -.50, "InflationReaction": .30, "Oil": .10}),
 "OIL":      dict(px=6807.55,  vol=.006, mkt=0.10, company="Oil",             type="Commodity",
                  betas={"Oil": .90, "InflationReaction": .10, "GeopoliticalStability": -.30}),
 "LITHIUM":  dict(px=2179.26,  vol=.009, mkt=1.03, company="Lithium",         type="Commodity",
                  betas={"SemiconductorDemand": .35, "TechDevelopments": .25, "ConsumerDisc": .20,
                         "InterestRates": -.15, "InflationReaction": .15}),
}
TICKERS = list(STOCKS.keys()); NT = len(TICKERS)

# =====================================================================
# SECTION 5 -- THE NEWS (official factor matrices, 13 Jul version)
# =====================================================================
# One drop = one news card. Timing is specified in legacy 10-second ticks
# (e.g., legacy_tick=12 means it fires at 120 real seconds).
# Scores are TARGETS in [-1,1]; the engine draws the realised score around them.
def D(legacy_tick, name, scores, bullets):
    return dict(legacy_tick=legacy_tick, name=name,
                scores={_A[k]: v for k, v in scores.items()}, bullets=bullets)

SESSION_NEWS = {
 # ---------------- SESSION 1: STOCK MARKET ROUND ----------------
 0: [
  D(0, "Intro", dict(IR=-.30, Reg=-.15, Infl=-.45, Sem=.75, Cons=.45, InvC=.90, Tech=.75), [
    "Investor sentiment reaches its highest level in years as disinflation eases pressure on central banks.",
    "Corporations pursue aggressive capital expenditure in technology, automation, and digital infrastructure; semiconductor manufacturers run near full capacity.",
    "Growth sectors outperform while a small contingent of analysts flags signs of speculative excess."]),
  D(2, "D1", dict(IR=.20, Infl=.45, Sem=-.30, Aero=-.10), [
    "Heavy flooding across parts of South America has disrupted operations at several major mining sites, tightening the supply outlook for key industrial metals used in battery and electronics manufacturing.",
    "A shortage of critical components has forced several chipmakers to scale back near-term production targets.",
    "Leading international banks have reported stronger-than-expected corporate borrowing activity, and commodity traders brace for increased volatility across raw material markets."]),
  D(12, "D2", dict(Reg=.30, Oil=.30, Infl=.45, Geo=-.10, InvC=.75, Tech=.30, Hlth=-.45), [
    "OPEC talks collapse without a deal to raise output, leaving producers short of targets.",
    "Consumer confidence beats expectations across major economies, with early strength in leisure spending — Ferrari's order backlog swells as luxury demand picks up.",
    "Pharma approval delays and rising Asian electricity costs continue to pressure manufacturing."]),
  D(24, "D3", dict(Oil=.10, Infl=.60, Geo=-.45, Cons=-.30, InvC=-.30, Tech=.30, Aero=.75), [
    "Congestion at several major East Asian ports has worsened, increasing pressure on global manufacturing supply chains and raising input costs for automakers reliant on overseas parts.",
    "NATO members have begun discussions on expanding defence procurement amid rising geopolitical tensions, with early proposals also referencing increased investment in satellite and space-based surveillance capabilities.",
    "Currency volatility increases across Asian markets, prompting several central banks to modestly increase gold reserves as a hedging measure."]),
  D(36, "D4", dict(Reg=.10, Sem=.90, Tech=.60, Aero=.30), [
    "Semiconductor equipment manufacturers report record order books as chipmakers continue expanding production capacity, though several firms flag stretching lead times and rising customer concentration risk.",
    "Telecommunications companies accelerate investment in next-generation digital infrastructure, including expanded satellite connectivity partnerships.",
    "Governments approve large-scale power grid expansion projects to support rising industrial electricity demand."]),
  D(48, "D5", dict(IR=-.10, InvC=.30, Tech=.45, Aero=-.40), [
    "Institutional investors continue increasing allocations toward high-growth sectors, though analysts note valuations are beginning to look stretched relative to historical norms.",
    "Defence stocks attract comparatively weaker capital inflows despite steady government contract activity.",
    "Market volatility sits near yearly lows as venture capital announces another wave of large funding rounds.",
    "Central bank surprises everyone with a hike in interest rates."]),
  D(60, "MAJOR", dict(IR=.90, Reg=.45, Oil=-.45, Infl=.60, Sem=-.95, Cons=-.45, InvC=-.95, Tech=-.95, Aero=.60), [
    "Multiple mid-tier AI infrastructure and data-center firms default on loans as production is slashed across the board.",
    "These companies borrowed heavily to build server farms and chip capacity, betting enterprise AI demand would keep growing exponentially; that demand never materialized at scale.",
    "Lenders move to freeze credit lines, and semiconductor suppliers brace for a wave of order cancellations as panic spreads through the AI supply chain.",
    "Last week's rate hike is now making it far more expensive for struggling companies to borrow their way out of trouble.",
    "Rumours circulate that major banks are quietly organizing a bailout for the hardest-hit AI firms, though confidence in the plan remains low.",
    "Investors pull out of risky tech stocks and rotate into healthcare and gold, seen as insulated from the credit crunch."]),
  D(84, "D6", dict(Oil=-.45, Sem=-.75, InvC=-.75, Tech=-.45), [
    "Equity funds report their largest weekly outflows in over a year as investors pull back from speculative growth bets.",
    "Semiconductor order books thin further, with foundries confirming a handful of major clients account for most of the newly cancelled contracts.",
    "Oil prices ease as softer industrial demand forecasts offer rare relief to cost-sensitive manufacturers.",
    "The fiscal review has also led to a freeze in new defence orders."]),
  D(96, "D7", dict(IR=.75, Oil=.30, Infl=.90, InvC=-.45, Hlth=.90), [
    "Borrowing costs climb further as central banks signal no immediate reversal on tightening; regional lenders warn refinancing remains difficult for distressed borrowers.",
    "Inflation data comes in hotter than expected, driven by persistent logistics and energy costs, dampening hopes of an early policy pivot.",
    "Amid the gloom, a major pharmaceutical company reports a successful late-stage drug trial, sending shares sharply higher."]),
  D(108, "D8", dict(IR=-.30, Reg=.75, Sem=.30, InvC=.75, Tech=.45), [
    "Major lenders confirm emergency credit lines for struggling AI infrastructure firms, easing fears of a wider default wave; bank stocks rally as the immediate freeze risk passes.",
    "Regulators simultaneously open a formal inquiry into risk practices at these lenders, adding a note of caution.",
    "Investor sentiment still turns broadly positive into the close."]),
 ],
 # ---------------- SESSION 2: WAR ROUND ----------------
 1: [
  D(0, "BU1", dict(IR=.40, Infl=.40, Geo=-.50, Aero=.30), [
    "Chinese naval drills restrict commercial shipping lanes near Taiwan's western industrial ports for a third consecutive day.",
    "Taiwan's defence ministry raises its alert status to the highest level since 1996.",
    "The Federal Reserve's latest statement flags \"elevated geopolitical inflation risk\" in its rate-path deliberations.",
    "U.S. Space Force finalizes an expanded classified contract for hardened satellite-constellation deployment across the Indo-Pacific."]),
  D(12, "BU2", dict(Reg=.50, Oil=-.40, Cons=.30), [
    "Beijing imposes emergency export licensing on rare-earth mineral shipments, citing domestic supply-chain priorities.",
    "India finalizes a new long-term discounted crude oil supply agreement with Russia, adding to global supply.",
    "A major U.S. online sports-betting platform reports record quarterly betting volume.",
    "Regulators in the United States, European Union, and Japan open inquiries into the rare-earth licensing move."]),
  D(24, "BU3", dict(Geo=-.60, Cons=-.35, Aero=.60), [
    "A Taiwanese coast guard vessel collides with a Chinese destroyer during a live-fire drill; both governments blame the other.",
    "Taipei summons China's top diplomat in the first formal protest since the crisis began.",
    "The Pentagon issues an expedited $2.1 billion munitions procurement order under emergency wartime authority.",
    "Beijing threatens retaliatory tariffs on imported luxury goods from nations backing Taiwan."]),
  D(36, "BU4", dict(Reg=-.40, Sem=.50, Aero=.50, Hlth=.40), [
    "Japan, Australia, and the Philippines announce joint naval patrols alongside U.S. forces already deployed to the region.",
    "The United States awards a new contract to expand wartime medical and pharmaceutical stockpiles.",
    "Washington temporarily waives select export-license requirements for allied defence suppliers to accelerate wartime production.",
    "Chip foundries outside Taiwan report a surge in emergency orders from customers seeking supply diversification."]),
  D(48, "BU5", dict(IR=.50, Geo=-.70, Tech=.25, Aero=-.30), [
    "China extends its blockade exercise around Taiwan indefinitely, restricting all commercial shipping through the strait.",
    "The Bank of England schedules an emergency policy session to weigh a coordinated dollar-liquidity swap-line expansion with the Fed and ECB.",
    "A commercial satellite operator detects an unidentified signal during constellation deployment that matches no known satellite or debris signature.",
    "Independent analysts suggest the reading could be an instrument artifact rather than a genuine detection."]),
  D(54, "MAJOR", dict(Reg=.50, Oil=.75, Geo=.30, InvC=-.50, Aero=.70), [
    "China formally declares a blockade of Taiwan, though initial terms exempt humanitarian and allied-flagged vessels — narrower in scope than the buildup's rhetoric had suggested.",
    "Within hours, Chinese and U.S.-allied forces exchange fire attempting to enforce or break the blockade, marking the formal outbreak of war.",
    "Japan, Australia, and the Philippines commit forces alongside the United States; Russia and North Korea publicly back China, while India declares formal non-alignment.",
    "The Taiwan and Malacca Straits see commercial shipping volumes collapse, driving oil to its sharpest single-day move in over a decade.",
    "The Fed, ECB, Bank of Japan, and Bank of England jointly launch a $500 billion coordinated dollar swap-line facility.",
    "U.S. and Chinese space-tracking authorities jointly confirm the unidentified signal detected days earlier is genuine and non-terrestrial in origin.",
    "Global equity markets tumble despite the swap-line intervention."]),
  D(78, "AFT1", dict(IR=-.40, Oil=.50, Sem=-.30, Tech=-.30, Aero=-.40, Hlth=-.30), [
    "The dollar swap-line facility begins easing funding stress, and short-term interest-rate expectations pull back from their post-declaration highs.",
    "Shipping insurers raise Indo-Pacific war-risk premiums to record levels, above prior Gulf-crisis peaks.",
    "A preliminary technical review suggests the earlier signal detection may have involved instrument calibration errors, reviving doubts about its authenticity.",
    "Several major defence contractors and pharmaceutical manufacturers flag capacity constraints as demand strains production lines."]),
  D(90, "AFT2", dict(Reg=.50, Oil=-.60, Sem=.60, InvC=.40, Tech=.60, Aero=-.40), [
    "A follow-up analysis conclusively confirms the signal represents a genuine propulsion or energy breakthrough with major dual-use potential.",
    "China moves to contest exclusive access to the infrastructure that detected it, threatening retaliation against the operator's international ground stations.",
    "Long-term energy-substitution concerns tied to the breakthrough weigh on oil futures even as near-term shipping risk remains elevated.",
    "Demand for next-generation computing capacity accelerates sharply; the Taiwan Strait conflict reaches an attritional lull as both sides pause for resupply.",
    "Lawmakers open a war-profiteering audit of defence contractors."]),
  D(102, "AFT3", dict(Reg=.40, Oil=-.30, Geo=.50, Cons=.30, Tech=-.35, Aero=-.60), [
    "Unconfirmed reports of a partial Taiwan Strait ceasefire begin circulating through diplomatic channels, causing defence contractors to slide.",
    "A formal international export-control regime is imposed on the new propulsion/energy technology, with allied governments publicly split over access terms.",
    "Oil futures ease further on the ceasefire reports and continued long-term substitution concerns.",
    "Consumer sentiment surveys across major economies show their first improvement since the war began."]),
 ],
}

# =====================================================================
# SECTION 6 -- THE ENGINE (v5 maths; do not edit below this line)
# =====================================================================
class MarketEngine:
    def __init__(self, seed):
        self.rng = np.random.default_rng(seed)
        self.L = np.linalg.cholesky(FACTOR_CORR)

        # per-game draws, frozen for the whole game
        self.beta = np.zeros((NT, NF))
        for i, tk in enumerate(TICKERS):
            for f, tgt in STOCKS[tk]["betas"].items():
                b = self.rng.normal(tgt, BETA_SPREAD)
                if np.sign(b) != np.sign(tgt) and tgt != 0:
                    b = np.sign(tgt) * abs(b)
                self.beta[i, FIDX[f]] = b
        self.mkt_beta = np.clip(
            self.rng.normal([STOCKS[tk]["mkt"] for tk in TICKERS], 0.05), 0.05, 1.7)
        self.start_px = np.array([STOCKS[tk]["px"] for tk in TICKERS], float)
        self.idio_vol = np.array([STOCKS[tk]["vol"] for tk in TICKERS], float)

        # build per-session event lists: one decaying shock per non-zero cell
        self.sessions = {}
        for s, drops in SESSION_NEWS.items():
            evs = []
            for drop in drops:
                fire = drop["legacy_tick"] * 10  # Legacy ticks were 10s each
                for f, tgt in drop["scores"].items():
                    g   = abs(self.rng.normal(GAIN_RAW, GAIN_TAU_FR * GAIN_RAW)) * GAIN_SCALE
                    tau = max(1.0, self.rng.normal(TAU_MIN, GAIN_TAU_FR * TAU_MIN)) * SUBTICKS
                    evs.append(dict(fire=fire, k=FIDX[f], target=tgt, gain=g,
                                    tau=tau, score=None, drop=drop["name"]))
            self.sessions[s] = evs

    def run_session(self, s, px=None, anchor=None):
        # Prices/anchor carry through continuously across sessions on this site
        # (only the news cycle resets) -- pass None to start a fresh book.
        px = self.start_px.copy() if px is None else px.copy()
        anchor = self.start_px.copy() if anchor is None else anchor.copy()
        events = self.sessions[s]
        drops = {d["name"]: d for d in SESSION_NEWS[s]}
        rows = []
        for t in range(TICKS_PER_SESSION):
            fired_drops = []
            fshock = np.zeros(NF)
            for e in events:
                if e["fire"] == t and e["score"] is None:
                    e["score"] = float(np.clip(
                        self.rng.normal(e["target"], SCORE_SPREAD), -1, 1))
                    if e["drop"] not in fired_drops:
                        fired_drops.append(e["drop"])
                if e["score"] is not None and t >= e["fire"]:
                    fshock[e["k"]] += (e["score"] * e["gain"] *
                                       np.exp(-(t - e["fire"]) / e["tau"]) *
                                       (REF_TAU / e["tau"]))
            F = (self.L @ self.rng.standard_normal(NF)) * FACTOR_VOL + fshock
            M = MKT_VOL * self.rng.standard_normal()
            N = self.beta @ F
            anchor *= np.exp(PERM_FRAC * N)
            R = KAPPA * (np.log(anchor) - np.log(px))
            idio = IDIO_MULT * self.idio_vol * self.rng.standard_normal(NT)
            px = px * np.exp(DRIFT + self.mkt_beta * M + N + R + idio)

            news = []
            for name in fired_drops:
                d = drops[name]
                realised = {f: round(next(e["score"] for e in events
                                          if e["drop"] == name and e["k"] == FIDX[f]), 3)
                            for f in d["scores"]}
                dom = max(realised, key=lambda f: abs(realised[f]))
                news.append(dict(bullets=d["bullets"], factor=dom, ticker=None,
                                 score=realised[dom], factor_scores=realised))
            rows.append(dict(session=s, tick=t,
                             prices={tk: round(float(p), 2)
                                     for tk, p in zip(TICKERS, px)},
                             news=news))
        return rows, px, anchor

# =====================================================================
# SECTION 7 -- EXPORT
# =====================================================================
def build_game(seed=None):
    if seed is None:
        seed = int(np.random.SeedSequence().generate_state(1)[0] % 2_147_483_647)
    eng = MarketEngine(seed=seed)
    rows = []
    px = anchor = None
    for s in range(SESSIONS):
        session_rows, px, anchor = eng.run_session(s, px, anchor)
        rows.extend(session_rows)

    universe = [dict(ticker=tk, company=STOCKS[tk]["company"],
                     start_price=STOCKS[tk]["px"], type=STOCKS[tk]["type"],
                     research=f"{STOCKS[tk]['company']} -- sensitivities: " +
                              ", ".join(f"{f} {b:+.2f}"
                                        for f, b in STOCKS[tk]["betas"].items()))
                for tk in TICKERS]
    return dict(
        meta=dict(seed=seed, sessions=SESSIONS, ticks_per_session=TICKS_PER_SESSION,
                  tick_seconds=TICK_SECONDS, tickers=TICKERS,
                  start_prices={tk: STOCKS[tk]["px"] for tk in TICKERS}),
        universe=universe, rows=rows)


if __name__ == "__main__":
    seed = int(sys.argv[1]) if len(sys.argv) > 1 else None
    game = build_game(seed=seed)
    with open("game_data.json", "w") as f:
        json.dump(game, f)
    print(f"seed={game['meta']['seed']}  rows={len(game['rows'])}")
    for s in range(SESSIONS):
        last = [r for r in game["rows"] if r["session"] == s][-1]["prices"]
        print(f"\nSession {s+1} returns (from true game start):")
        for tk in TICKERS:
            base = STOCKS[tk]["px"]
            print(f"  {tk:9s} {base:>10.2f} -> {last[tk]:>10.2f}  ({(last[tk]/base-1)*100:+6.1f}%)")
