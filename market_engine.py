import json

# =================================================================
# CONSTANTS
# =================================================================
TICKS_PER_SESSION = 130
TICK_SECONDS = 10
SESSIONS = 2

# =================================================================
# TICKER CONFIGURATION
# =================================================================
TICKER_CONFIG = [
    {'ticker': 'TSMC', 'company': 'TSMC', 'start_price': 7168.31, 'type': 'Equity', 'research': 'AI Player'},
    {'ticker': 'FERRARI', 'company': 'Ferrari', 'start_price': 35942.28, 'type': 'Equity', 'research': 'Automobiles'},
    {'ticker': 'LMT', 'company': 'Lockheed Martin', 'start_price': 49878.82, 'type': 'Equity', 'research': 'Defense'},
    {'ticker': 'HDFC', 'company': 'HDFC', 'start_price': 824.50, 'type': 'Equity', 'research': 'Banking'},
    {'ticker': 'PFE', 'company': 'Pfizer', 'start_price': 2304.14, 'type': 'Equity', 'research': 'Biotech'},
    {'ticker': 'RELIANCE', 'company': 'Reliance', 'start_price': 1310.00, 'type': 'Equity', 'research': 'FMCG'},
    {'ticker': 'DKNG', 'company': 'Draft Kings', 'start_price': 2524.35, 'type': 'Equity', 'research': 'Entertainment'},
    {'ticker': 'SPACEX', 'company': 'SpaceX', 'start_price': 13851.52, 'type': 'Equity', 'research': 'Aero/Space'},
    {'ticker': 'SAMSUNG', 'company': 'Samsung', 'start_price': 18123.06, 'type': 'Equity', 'research': 'Tech'},
    {'ticker': 'GOLD', 'company': 'Gold', 'start_price': 148290.00, 'type': 'Commodity', 'research': 'Precious Metal'},
    {'ticker': 'OIL', 'company': 'Oil', 'start_price': 6807.55, 'type': 'Commodity', 'research': 'Energy'},
    {'ticker': 'LITHIUM', 'company': 'Lithium', 'start_price': 2179.26, 'type': 'Commodity', 'research': 'Industrial Metal'}
]

TICKERS = [c['ticker'] for c in TICKER_CONFIG]

# News drop timing: Drop 1 @ tick 2, Drop 2 @ tick 12, then every 12 ticks.
# The Major Drop (6th event) is followed by a 24-tick gap before the next item,
# then the cadence returns to every 12 ticks: 2, 12, 24, 36, 48, 60(Major), 84, 96, 108, 120
EVENTS = {
    0: {
        2: {
            "factor": "Supply Chain",
            "bullets": [
                "Heavy flooding across parts of South America has disrupted operations at several major mining sites, tightening the supply outlook for key industrial metals used in battery and electronics manufacturing.",
                "A shortage of critical components has forced several chipmakers to scale back near-term production targets.",
                "Leading international banks have reported stronger-than-expected corporate borrowing activity, and commodity traders brace for increased volatility across raw material markets."
            ],
            "impacts": {"LITHIUM": 1.10, "TSMC": 0.95, "SAMSUNG": 0.95, "HDFC": 1.05}
        },
        12: {
            "factor": "Oil",
            "bullets": [
                "OPEC talks collapse without a deal to raise output, leaving producers short of targets.",
                "Consumer confidence beats expectations across major economies, with early strength in leisure spending — Ferrari's order backlog swells as luxury demand picks up.",
                "Pharma approval delays and rising Asian electricity costs continue to pressure manufacturing."
            ],
            "impacts": {"OIL": 1.15, "FERRARI": 1.08, "PFE": 0.92}
        },
        24: {
            "factor": "Geopolitical Stability",
            "bullets": [
                "Congestion at several major East Asian ports has worsened, increasing pressure on global manufacturing supply chains and raising input costs for automakers reliant on overseas parts.",
                "NATO members have begun discussions on expanding defence procurement amid rising geopolitical tensions, with early proposals also referencing increased investment in satellite and space-based surveillance capabilities.",
                "Currency volatility has also increased across Asian markets, prompting several central banks to modestly increase gold reserves as a hedging measure, while export-driven manufacturers reassess overseas pricing strategies and investors shift toward globally diversified firms."
            ],
            "impacts": {"TSMC": 0.97, "SAMSUNG": 0.97, "FERRARI": 0.95, "LMT": 1.06, "GOLD": 1.05}
        },
        36: {
            "factor": "Semiconductor Demand",
            "bullets": [
                "Semiconductor equipment manufacturers have reported record order books as chipmakers continue expanding production capacity, though several firms have flagged stretching lead times and rising customer concentration risk as a small number of buyers account for an outsized share of new orders.",
                "Telecommunications companies are accelerating investment in next-generation digital infrastructure, including expanded satellite connectivity partnerships.",
                "Governments approve large-scale power grid expansion projects to support rising industrial electricity demand."
            ],
            "impacts": {"TSMC": 1.08, "SAMSUNG": 1.08, "SPACEX": 1.05, "RELIANCE": 1.02}
        },
        48: {
            "factor": "Interest Rates",
            "bullets": [
                "Institutional investors and pension funds have continued increasing allocations toward high-growth sectors, though analysts note valuations in several of these areas are beginning to look stretched relative to historical norms.",
                "Defence stocks have attracted comparatively weaker capital inflows despite steady government contract activity.",
                "Market volatility remains near yearly lows, and venture capital firms have announced another wave of large funding rounds for technology and infrastructure startups, even as some investors quietly increase exposure to traditional safe-haven assets.",
                "Central bank surprises everyone with a hike in interest rates."
            ],
            "impacts": {"DKNG": 1.05, "TSMC": 0.96, "SAMSUNG": 0.96, "HDFC": 0.90, "LMT": 0.95}
        },
        60: {
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
        84: {
            "factor": "Investor Confidence",
            "bullets": [
                "Equity funds report their largest weekly outflows in over a year as investors pull back from speculative growth bets.",
                "Semiconductor order books thin further, with foundries confirming a handful of major clients account for most of the newly cancelled contracts.",
                "Oil prices ease slightly, however, as softer industrial demand forecasts offer rare relief to cost-sensitive manufacturers.",
                "The fiscal review has also led to a freeze in new defence orders."
            ],
            "impacts": {"DKNG": 0.92, "OIL": 0.90, "LMT": 0.90, "TSMC": 0.95, "SAMSUNG": 0.95}
        },
        96: {
            "factor": "Healthcare",
            "bullets": [
                "Borrowing costs hold at their post-hike level, with central banks reiterating no near-term reversal — a stance already well telegraphed.",
                "Regional lenders still warn refinancing remains difficult for distressed borrowers.",
                "Inflation data lands largely in line with forecasts, reinforcing expectations that rates stay elevated for longer.",
                "Amid the gloom, a major pharmaceutical company reports a successful late-stage drug trial, sending shares sharply higher as healthcare demand holds steady."
            ],
            "impacts": {"HDFC": 0.95, "PFE": 1.15}
        },
        108: {
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
        120: {
            "factor": "Credit",
            "bullets": ["Emergency credit lines confirmed", "Regulators use lighter touch", "Bank stocks rally"],
            "impacts": {"HDFC": 1.15, "TSMC": 1.08, "DKNG": 1.08, "SAMSUNG": 1.05}
        }
    },
    1: {
        2: {
            "factor": "Geopolitical Stability",
            "bullets": ["Round 2: War Intro", "Chinese naval activity intensifies", "U.S. Space Force accelerates contracts"],
            "impacts": {"TSMC": 0.85, "LMT": 1.10, "SPACEX": 1.10, "OIL": 1.05}
        },
        12: {
            "factor": "Inflation Reaction",
            "bullets": ["Chinese drills restrict shipping", "Fed flags inflation risk", "Space Force classified contract"],
            "impacts": {"TSMC": 0.90, "SPACEX": 1.15, "GOLD": 1.02}
        },
        24: {
            "factor": "Technological Developments",
            "bullets": ["Rare earth export limits", "DraftKings record volume", "Russian oil deal in India"],
            "impacts": {"LITHIUM": 1.20, "TSMC": 0.95, "DKNG": 1.10, "OIL": 0.92}
        },
        36: {
            "factor": "Aero",
            "bullets": ["Vessel collision in Taiwan Strait", "Pentagon expedites munitions order", "Retaliatory tariffs threatened"],
            "impacts": {"TSMC": 0.85, "LMT": 1.15, "FERRARI": 0.90}
        },
        48: {
            "factor": "Healthcare",
            "bullets": ["Joint naval patrols announced", "Medical stockpiles expanded", "Chip foundries diversify"],
            "impacts": {"PFE": 1.10, "SAMSUNG": 1.08, "TSMC": 0.95}
        },
        60: {
            "factor": "Geopolitical Stability",
            "bullets": ["WAR ANNOUNCEMENT: Blockade declared", "Shipping volumes collapse", "Signal confirmed non-terrestrial"],
            "impacts": {"TSMC": 0.60, "SAMSUNG": 0.70, "OIL": 1.25, "SPACEX": 1.20, "GOLD": 1.15, "DKNG": 0.75, "HDFC": 0.80}
        },
        84: {
            "factor": "Geopolitical Stability",
            "bullets": ["China extends blockade", "Unidentified space signal detected", "Bank of England emergency session"],
            "impacts": {"TSMC": 0.85, "SPACEX": 1.08, "GOLD": 1.05}
        },
        96: {
            "factor": "Aero",
            "bullets": ["Shipping war-risk premiums hit record", "Defence and Pharma capacity constraints", "Swap-line eases funding"],
            "impacts": {"OIL": 1.10, "LMT": 1.15, "PFE": 1.12, "HDFC": 1.05}
        },
        108: {
            "factor": "Technological Developments",
            "bullets": ["Signal is genuine propulsion breakthrough", "Oil futures drop on substitution fears", "Lawmakers audit contractors"],
            "impacts": {"SPACEX": 1.40, "OIL": 0.85, "TSMC": 1.15, "SAMSUNG": 1.15, "LMT": 0.90}
        },
        120: {
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
