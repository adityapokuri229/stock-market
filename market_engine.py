import json

# =================================================================
# CONSTANTS
# =================================================================
TICKS_PER_SESSION = 1201  # 1201 ticks (0..1200) x 1s = 20:00 exactly, ending right after the tick-1200 news drop
TICK_SECONDS = 1
SESSIONS = 2

# =================================================================
# FACTOR SENSITIVITIES (betas) -- sourced from beta_matrix_final.csv.
# Order must match scoring.js's FACTORS list exactly.
# =================================================================
FACTORS = [
    'InterestRates', 'RegulatoryRisk', 'Oil', 'InflationReaction', 'GeopoliticalStability',
    'SemiconductorDemand', 'ConsumerDisc', 'InvestorConfidence', 'TechDevelopments', 'Aero', 'Healthcare'
]

SENSITIVITIES = {
    'TSMC':     [0, -0.3, 0, 0, 0.3, 0.85, 0, 0, 0, 0, 0],
    'FERRARI':  [-0.12, 0, -0.09, 0, 0, 0, 0.4, 0, 0, 0, 0],
    'LMT':      [0, 0, 0.11, 0, -0.4, -0.1, 0, -0.11, -0.15, 0.75, 0.13],
    'HDFC':     [-0.25, -0.2, -0.12, 0, 0, 0, 0.1, 0.08, 0, 0, 0],
    'PFE':      [0, -0.35, 0, 0, 0, 0, 0, 0, 0, 0, 0.75],
    'RELIANCE': [-0.2, 0, 0.3, 0.3, 0, 0, 0.2, 0, 0, 0, 0],
    'DKNG':     [-0.2, -0.4, 0, 0, 0, 0, 0.45, 0.3, 0.35, 0, 0],
    'SPACEX':   [0, -0.25, 0, 0, -0.2, 0.15, 0, 0.35, 0.6, 0.75, 0],
    'SAMSUNG':  [-0.3, -0.15, 0, 0, 0.2, 0.8, 0.15, 0, 0.2, 0, 0],
    'GOLD':     [-0.5, 0, 0.1, 0.3, -0.5, 0, 0, 0, 0, 0, 0],
    'OIL':      [0, 0, 0.9, 0.1, -0.3, 0, 0, 0, 0, 0, 0],
    'LITHIUM':  [-0.15, 0, 0, 0.15, 0, 0.35, 0.2, 0, 0.25, 0, 0],
}

def _sensitivities(ticker):
    pairs = (f"{f} {b:+g}" for f, b in zip(FACTORS, SENSITIVITIES[ticker]) if b != 0)
    return 'sensitivities: ' + ', '.join(pairs)

# =================================================================
# TICKER CONFIGURATION
# =================================================================
TICKER_CONFIG = [
    {'ticker': 'TSMC', 'company': 'TSMC', 'start_price': 7168.31, 'type': 'Equity', 'research': f"AI Player. {_sensitivities('TSMC')}"},
    {'ticker': 'FERRARI', 'company': 'Ferrari', 'start_price': 35942.28, 'type': 'Equity', 'research': f"Automobiles. {_sensitivities('FERRARI')}"},
    {'ticker': 'LMT', 'company': 'Lockheed Martin', 'start_price': 49878.82, 'type': 'Equity', 'research': f"Defense. {_sensitivities('LMT')}"},
    {'ticker': 'HDFC', 'company': 'HDFC', 'start_price': 824.50, 'type': 'Equity', 'research': f"Banking. {_sensitivities('HDFC')}"},
    {'ticker': 'PFE', 'company': 'Pfizer', 'start_price': 2304.14, 'type': 'Equity', 'research': f"Biotech. {_sensitivities('PFE')}"},
    {'ticker': 'RELIANCE', 'company': 'Reliance', 'start_price': 1310.00, 'type': 'Equity', 'research': f"FMCG. {_sensitivities('RELIANCE')}"},
    {'ticker': 'DKNG', 'company': 'Draft Kings', 'start_price': 2524.35, 'type': 'Equity', 'research': f"Entertainment. {_sensitivities('DKNG')}"},
    {'ticker': 'SPACEX', 'company': 'SpaceX', 'start_price': 13851.52, 'type': 'Equity', 'research': f"Aero/Space. {_sensitivities('SPACEX')}"},
    {'ticker': 'SAMSUNG', 'company': 'Samsung', 'start_price': 18123.06, 'type': 'Equity', 'research': f"Tech. {_sensitivities('SAMSUNG')}"},
    {'ticker': 'GOLD', 'company': 'Gold', 'start_price': 148290.00, 'type': 'Commodity', 'research': f"Precious Metal. {_sensitivities('GOLD')}"},
    {'ticker': 'OIL', 'company': 'Oil', 'start_price': 6807.55, 'type': 'Commodity', 'research': f"Energy. {_sensitivities('OIL')}"},
    {'ticker': 'LITHIUM', 'company': 'Lithium', 'start_price': 2179.26, 'type': 'Commodity', 'research': f"Industrial Metal. {_sensitivities('LITHIUM')}"}
]

TICKERS = [c['ticker'] for c in TICKER_CONFIG]

# News drop timing: with 1s ticks, every real-world "12 old-ticks" (2 min) is now
# 120 ticks. Drop 1 @ tick 20, Drop 2 @ tick 120, then every 120 ticks (2 min).
# The Major Drop is followed by a 240-tick (4 min) gap before the next item, then
# the cadence returns to every 120 ticks: 20, 120, 240, 360, 480, 600(Major), 840, 960, 1080, 1200
EVENTS = {
    0: {
        20: {
            "factor": "Supply Chain",
            "bullets": [
                "Heavy flooding across parts of South America has disrupted operations at several major mining sites, tightening the supply outlook for key industrial metals used in battery and electronics manufacturing.",
                "A shortage of critical components has forced several chipmakers to scale back near-term production targets.",
                "Leading international banks have reported stronger-than-expected corporate borrowing activity, and commodity traders brace for increased volatility across raw material markets."
            ],
            "impacts": {"LITHIUM": 1.10, "TSMC": 0.95, "SAMSUNG": 0.95, "HDFC": 1.05}
        },
        120: {
            "factor": "Oil",
            "bullets": [
                "OPEC talks collapse without a deal to raise output, leaving producers short of targets.",
                "Consumer confidence beats expectations across major economies, with early strength in leisure spending — Ferrari's order backlog swells as luxury demand picks up.",
                "Pharma approval delays and rising Asian electricity costs continue to pressure manufacturing."
            ],
            "impacts": {"OIL": 1.15, "FERRARI": 1.08, "PFE": 0.92}
        },
        240: {
            "factor": "Geopolitical Stability",
            "bullets": [
                "Congestion at several major East Asian ports has worsened, increasing pressure on global manufacturing supply chains and raising input costs for automakers reliant on overseas parts.",
                "NATO members have begun discussions on expanding defence procurement amid rising geopolitical tensions, with early proposals also referencing increased investment in satellite and space-based surveillance capabilities.",
                "Currency volatility has also increased across Asian markets, prompting several central banks to modestly increase gold reserves as a hedging measure, while export-driven manufacturers reassess overseas pricing strategies and investors shift toward globally diversified firms."
            ],
            "impacts": {"TSMC": 0.97, "SAMSUNG": 0.97, "FERRARI": 0.95, "LMT": 1.06, "GOLD": 1.05}
        },
        360: {
            "factor": "Semiconductor Demand",
            "bullets": [
                "Semiconductor equipment manufacturers have reported record order books as chipmakers continue expanding production capacity, though several firms have flagged stretching lead times and rising customer concentration risk as a small number of buyers account for an outsized share of new orders.",
                "Telecommunications companies are accelerating investment in next-generation digital infrastructure, including expanded satellite connectivity partnerships.",
                "Governments approve large-scale power grid expansion projects to support rising industrial electricity demand."
            ],
            "impacts": {"TSMC": 1.08, "SAMSUNG": 1.08, "SPACEX": 1.05, "RELIANCE": 1.02}
        },
        480: {
            "factor": "Interest Rates",
            "bullets": [
                "Institutional investors and pension funds have continued increasing allocations toward high-growth sectors, though analysts note valuations in several of these areas are beginning to look stretched relative to historical norms.",
                "Defence stocks have attracted comparatively weaker capital inflows despite steady government contract activity.",
                "Market volatility remains near yearly lows, and venture capital firms have announced another wave of large funding rounds for technology and infrastructure startups, even as some investors quietly increase exposure to traditional safe-haven assets.",
                "Central bank surprises everyone with a hike in interest rates."
            ],
            "impacts": {"DKNG": 1.05, "TSMC": 0.96, "SAMSUNG": 0.96, "HDFC": 0.90, "LMT": 0.95}
        },
        600: {
            "factor": "Regulatory Risk",
            "bullets": [
                "Multiple mid-tier AI infrastructure and data-center firms default on loans as production is slashed across the board.",
                "Over the past year, these companies borrowed heavily to build server farms and chip capacity, betting that enterprise AI demand would keep growing exponentially.",
                "That demand never materialized at the scale investors expected, and with revenues falling short of debt obligations, several firms have now missed loan payments — payments that were backed more by speculative future valuations than real assets.",
                "Lenders are moving to freeze credit lines, and semiconductor suppliers are bracing for a wave of order cancellations as panic spreads through the AI supply chain.",
                "The situation is compounded by last week's rate hike, which is now making it far more expensive for struggling companies to borrow their way out of trouble.",
                "Rumours are also circulating that a group of major banks is quietly organizing a bailout for the hardest-hit AI firms, though confidence in the plan remains low.",
                "Investors are pulling out of risky tech stocks and rotating into healthcare and gold, seen as insulated from the credit crunch — defence names, still awaiting word on new contract funding, fail to catch a similar bid."
            ],
            "impacts": {"TSMC": 0.80, "SAMSUNG": 0.80, "HDFC": 0.85, "PFE": 1.10, "GOLD": 1.08, "DKNG": 0.90}
        },
        840: {
            "factor": "Investor Confidence",
            "bullets": [
                "Equity funds report their largest weekly outflows in over a year as investors pull back from speculative growth bets.",
                "Semiconductor order books thin further, with foundries confirming a handful of major clients account for most of the newly cancelled contracts.",
                "Oil prices ease slightly, however, as softer industrial demand forecasts offer rare relief to cost-sensitive manufacturers.",
                "The fiscal review has also led to a freeze in new defence orders."
            ],
            "impacts": {"DKNG": 0.92, "OIL": 0.90, "LMT": 0.90, "TSMC": 0.95, "SAMSUNG": 0.95}
        },
        960: {
            "factor": "Healthcare",
            "bullets": [
                "Borrowing costs hold at their post-hike level, with central banks reiterating no near-term reversal — a stance already well telegraphed.",
                "Regional lenders still warn refinancing remains difficult for distressed borrowers.",
                "Inflation data lands largely in line with forecasts, reinforcing expectations that rates stay elevated for longer.",
                "Amid the gloom, a major pharmaceutical company reports a successful late-stage drug trial, sending shares sharply higher as healthcare demand holds steady."
            ],
            "impacts": {"HDFC": 0.95, "PFE": 1.15}
        },
        1080: {
            "factor": "Credit",
            "bullets": [
                "Major lenders confirm emergency credit lines for struggling AI infrastructure firms, easing fears of a wider default wave.",
                "Regulators simultaneously open a formal inquiry into risk practices at these lenders, adding a note of caution.",
                "Investor sentiment still turns broadly positive into the close.",
                "Banks reopen credit lines for several distressed borrowers.",
                "Regulators signal a lighter touch on emergency lending rules, and bank stocks rally as the immediate freeze risk passes."
            ],
            "impacts": {"HDFC": 1.15, "TSMC": 1.08, "DKNG": 1.08, "SAMSUNG": 1.05}
        },
        1200: {
            "factor": "Credit",
            "bullets": ["Emergency credit lines confirmed", "Regulators use lighter touch", "Bank stocks rally"],
            "impacts": {"HDFC": 1.15, "TSMC": 1.08, "DKNG": 1.08, "SAMSUNG": 1.05}
        }
    },
    1: {
        20: {
            "factor": "Inflation Reaction",
            "bullets": [
                "Chinese naval drills restrict commercial shipping lanes near Taiwan's western industrial ports for a third consecutive day.",
                "Taiwan's defence ministry raises its alert status to the highest level since 1996.",
                "The Federal Reserve's latest statement flags \"elevated geopolitical inflation risk\" in its rate-path deliberations.",
                "U.S. Space Force finalizes an expanded classified contract for hardened satellite-constellation deployment across the Indo-Pacific."
            ],
            "impacts": {"TSMC": 0.90, "SPACEX": 1.15, "GOLD": 1.02}
        },
        120: {
            "factor": "Technological Developments",
            "bullets": [
                "Beijing imposes emergency export licensing on rare-earth mineral shipments, citing domestic supply-chain priorities.",
                "India finalizes a new long-term discounted crude oil supply agreement with Russia, adding to global supply.",
                "A major U.S. online sports-betting platform reports record quarterly betting volume.",
                "Regulators in the United States, European Union, and Japan open inquiries into the rare-earth licensing move."
            ],
            "impacts": {"LITHIUM": 1.20, "TSMC": 0.95, "DKNG": 1.10, "OIL": 0.92}
        },
        240: {
            "factor": "Aero",
            "bullets": [
                "A Taiwanese coast guard vessel collides with a Chinese destroyer during a live-fire drill; both governments blame the other.",
                "Taipei summons China's top diplomat in the first formal protest since the crisis began.",
                "The Pentagon issues an expedited $2.1 billion munitions procurement order under emergency wartime authority.",
                "Beijing threatens retaliatory tariffs on imported luxury goods from nations backing Taiwan."
            ],
            "impacts": {"TSMC": 0.85, "LMT": 1.15, "FERRARI": 0.90}
        },
        360: {
            "factor": "Healthcare",
            "bullets": [
                "Japan, Australia, and the Philippines announce joint naval patrols alongside U.S. forces already deployed to the region.",
                "The United States awards a new contract to expand wartime medical and pharmaceutical stockpiles.",
                "Washington temporarily waives select export-license requirements for allied defence suppliers to accelerate wartime production.",
                "Chip foundries outside Taiwan report a surge in emergency orders from customers seeking supply diversification."
            ],
            "impacts": {"PFE": 1.10, "SAMSUNG": 1.08, "TSMC": 0.95}
        },
        480: {
            "factor": "Geopolitical Stability",
            "bullets": [
                "China extends its blockade exercise around Taiwan indefinitely, restricting all commercial shipping through the strait.",
                "The Bank of England schedules an emergency policy session to weigh a coordinated dollar-liquidity swap-line expansion with the Fed and ECB.",
                "A commercial satellite operator detects an unidentified signal during constellation deployment that matches no known satellite or debris signature.",
                "Independent analysts suggest the reading could be an instrument artifact rather than a genuine detection."
            ],
            "impacts": {"TSMC": 0.85, "SPACEX": 1.08, "GOLD": 1.05}
        },
        600: {
            "factor": "Geopolitical Stability",
            "bullets": [
                "China formally declares a blockade of Taiwan, though initial terms exempt humanitarian and allied-flagged vessels — narrower in scope than the buildup's rhetoric had suggested.",
                "Within hours, Chinese and U.S.-allied forces exchange fire attempting to enforce or break the blockade, marking the formal outbreak of war.",
                "Japan, Australia, and the Philippines commit forces alongside the United States; Russia and North Korea publicly back China, while India declares formal non-alignment as a neutral trade and capital hub.",
                "Both governments impose sweeping wartime trade and export controls within hours of the declaration.",
                "The Taiwan and Malacca Straits see commercial shipping volumes collapse, driving oil to its sharpest single-day move in over a decade.",
                "The Fed, ECB, Bank of Japan, and Bank of England jointly launch a $500 billion coordinated dollar swap-line facility and expanded overnight repo operations.",
                "Amid the chaos, U.S. and Chinese space-tracking authorities jointly confirm that the unidentified signal detected days earlier is genuine and non-terrestrial in origin.",
                "Global equity markets tumble despite the swap-line intervention, with volatility gauges spiking to session extremes."
            ],
            "impacts": {"TSMC": 0.60, "SAMSUNG": 0.70, "OIL": 1.25, "SPACEX": 1.20, "GOLD": 1.15, "DKNG": 0.75, "HDFC": 0.80}
        },
        840: {
            "factor": "Aero",
            "bullets": [
                "The dollar swap-line facility begins easing funding stress, and short-term interest-rate expectations pull back from their post-declaration highs.",
                "Shipping insurers raise Indo-Pacific war-risk premiums to record levels, above prior Gulf-crisis peaks.",
                "A preliminary technical review suggests the earlier signal detection may have involved instrument calibration errors, reviving doubts about its authenticity.",
                "Several major defence contractors and pharmaceutical manufacturers flag capacity constraints, warning that simultaneous demand across three active fronts is straining both aerospace and medical-supply production lines."
            ],
            "impacts": {"OIL": 1.10, "LMT": 1.15, "PFE": 1.12, "HDFC": 1.05}
        },
        960: {
            "factor": "Technological Developments",
            "bullets": [
                "A follow-up analysis conclusively confirms the signal represents a genuine propulsion or energy breakthrough with major dual-use potential, resolving the earlier doubts.",
                "China moves to contest exclusive access to the infrastructure that detected it, threatening retaliation against the operator's international ground stations.",
                "Long-term energy-substitution concerns tied to the breakthrough weigh on oil futures even as near-term shipping risk remains elevated.",
                "Demand for next-generation computing capacity linked to the breakthrough accelerates sharply, and the Taiwan Strait conflict reaches an attritional lull as both sides pause for resupply, easing immediate market anxiety.",
                "Meanwhile, lawmakers open a war-profiteering audit of contractors."
            ],
            "impacts": {"SPACEX": 1.40, "OIL": 0.85, "TSMC": 1.15, "SAMSUNG": 1.15, "LMT": 0.90}
        },
        1080: {
            "factor": "Geopolitical Stability",
            "bullets": [
                "Unconfirmed reports of a partial Taiwan Strait ceasefire begin circulating through diplomatic channels, causing defence contractors to slide.",
                "A formal international export-control regime is imposed on the new propulsion/energy technology, with allied governments publicly split over access terms.",
                "Oil futures ease further on the ceasefire reports and continued long-term substitution concerns.",
                "Consumer sentiment surveys across major economies show their first improvement since the war began, even as commercialization of the new technology slows under the fresh restrictions."
            ],
            "impacts": {"TSMC": 1.20, "LMT": 0.85, "OIL": 0.90, "SPACEX": 0.85, "DKNG": 1.10, "FERRARI": 1.10}
        },
        1200: {
            "factor": "Geopolitical Stability",
            "bullets": ["Partial ceasefire reports circulate", "Export controls on new tech", "Consumer sentiment improves"],
            "impacts": {"TSMC": 1.20, "LMT": 0.85, "OIL": 0.90, "SPACEX": 0.85, "DKNG": 1.10, "FERRARI": 1.10}
        }
    }
}

def build_game():
    universe = []
    for c in TICKER_CONFIG:
        universe.append({
            'ticker': c['ticker'],
            'company': c['company'],
            'start_price': c['start_price'],
            'type': c['type'],
            'research': c['research']
        })
        
    start_prices = {c['ticker']: c['start_price'] for c in TICKER_CONFIG}
    
    meta = {
        'seed': 0, # deterministic
        'sessions': SESSIONS,
        'ticks_per_session': TICKS_PER_SESSION,
        'tick_seconds': TICK_SECONDS,
        'tickers': TICKERS,
        'start_prices': start_prices
    }
    
    rows = []
    current_prices = dict(start_prices)
    
    for s in range(SESSIONS):
        for t in range(TICKS_PER_SESSION):
            news_output = []
            if s in EVENTS and t in EVENTS[s]:
                event = EVENTS[s][t]
                # Apply impacts
                for ticker, impact in event['impacts'].items():
                    current_prices[ticker] = current_prices[ticker] * impact
                
                news_output.append({
                    'bullets': event['bullets'],
                    'factor': event['factor'],
                    'ticker': None,
                    'score': 1.0 # default dummy score for UI
                })
            
            # Format prices
            formatted_prices = {k: round(v, 2) for k, v in current_prices.items()}
            
            rows.append({
                'session': s,
                'tick': t,
                'prices': formatted_prices,
                'news': news_output
            })
            
    game_data = {
        'meta': meta,
        'universe': universe,
        'rows': rows
    }
    
    with open('game_data.json', 'w') as f:
        json.dump(game_data, f, indent=2)
        
    print(f"Generated deterministic game_data.json with {SESSIONS} sessions and {TICKS_PER_SESSION} ticks per session.")

if __name__ == '__main__':
    build_game()
