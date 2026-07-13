import json

# =================================================================
# CONSTANTS
# =================================================================
TICKS_PER_SESSION = 120
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

EVENTS = {
    0: {
        2: {
            "factor": "Investor Confidence",
            "bullets": ["Investor sentiment at highest level", "Aggressive capex in tech", "Semiconductors at full capacity"],
            "impacts": {"TSMC": 1.05, "SAMSUNG": 1.05, "GOLD": 0.98}
        },
        14: {
            "factor": "Supply Chain",
            "bullets": ["Flooding hits mining sites", "Chipmakers scale back", "Corporate borrowing up"],
            "impacts": {"LITHIUM": 1.10, "TSMC": 0.95, "SAMSUNG": 0.95, "HDFC": 1.05}
        },
        26: {
            "factor": "Oil",
            "bullets": ["OPEC talks collapse", "Ferrari orders swell", "Pharma approval delays"],
            "impacts": {"OIL": 1.15, "FERRARI": 1.08, "PFE": 0.92}
        },
        38: {
            "factor": "Geopolitical Stability",
            "bullets": ["Asian port congestion worsens", "NATO expands procurement", "Banks increase gold reserves"],
            "impacts": {"TSMC": 0.97, "SAMSUNG": 0.97, "FERRARI": 0.95, "LMT": 1.06, "GOLD": 1.05}
        },
        50: {
            "factor": "Semiconductor Demand",
            "bullets": ["Semiconductor record orders", "Telecom satellite partnerships", "Power grid expansions"],
            "impacts": {"TSMC": 1.08, "SAMSUNG": 1.08, "SPACEX": 1.05, "RELIANCE": 1.02}
        },
        62: {
            "factor": "Interest Rates",
            "bullets": ["Institutions buy growth stocks", "Central bank surprises with rate hike", "Defence stocks weak"],
            "impacts": {"DKNG": 1.05, "TSMC": 0.96, "SAMSUNG": 0.96, "HDFC": 0.90, "LMT": 0.95}
        },
        74: {
            "factor": "Regulatory Risk",
            "bullets": ["MAJOR DROP: AI firms default on loans", "Credit lines freeze", "Rotation to healthcare and gold"],
            "impacts": {"TSMC": 0.80, "SAMSUNG": 0.80, "HDFC": 0.85, "PFE": 1.10, "GOLD": 1.08, "DKNG": 0.90}
        },
        86: {
            "factor": "Investor Confidence",
            "bullets": ["Equity funds see massive outflows", "Oil prices ease", "Freeze in new defence orders"],
            "impacts": {"DKNG": 0.92, "OIL": 0.90, "LMT": 0.90, "TSMC": 0.95, "SAMSUNG": 0.95}
        },
        98: {
            "factor": "Healthcare",
            "bullets": ["Borrowing costs hold high", "Pharma successful late-stage trial", "Healthcare demand steady"],
            "impacts": {"HDFC": 0.95, "PFE": 1.15}
        },
        110: {
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
        14: {
            "factor": "Inflation Reaction",
            "bullets": ["Chinese drills restrict shipping", "Fed flags inflation risk", "Space Force classified contract"],
            "impacts": {"TSMC": 0.90, "SPACEX": 1.15, "GOLD": 1.02}
        },
        26: {
            "factor": "Technological Developments",
            "bullets": ["Rare earth export limits", "DraftKings record volume", "Russian oil deal in India"],
            "impacts": {"LITHIUM": 1.20, "TSMC": 0.95, "DKNG": 1.10, "OIL": 0.92}
        },
        38: {
            "factor": "Aero",
            "bullets": ["Vessel collision in Taiwan Strait", "Pentagon expedites munitions order", "Retaliatory tariffs threatened"],
            "impacts": {"TSMC": 0.85, "LMT": 1.15, "FERRARI": 0.90}
        },
        50: {
            "factor": "Healthcare",
            "bullets": ["Joint naval patrols announced", "Medical stockpiles expanded", "Chip foundries diversify"],
            "impacts": {"PFE": 1.10, "SAMSUNG": 1.08, "TSMC": 0.95}
        },
        62: {
            "factor": "Geopolitical Stability",
            "bullets": ["China extends blockade", "Unidentified space signal detected", "Bank of England emergency session"],
            "impacts": {"TSMC": 0.85, "SPACEX": 1.08, "GOLD": 1.05}
        },
        74: {
            "factor": "Geopolitical Stability",
            "bullets": ["WAR ANNOUNCEMENT: Blockade declared", "Shipping volumes collapse", "Signal confirmed non-terrestrial"],
            "impacts": {"TSMC": 0.60, "SAMSUNG": 0.70, "OIL": 1.25, "SPACEX": 1.20, "GOLD": 1.15, "DKNG": 0.75, "HDFC": 0.80}
        },
        86: {
            "factor": "Aero",
            "bullets": ["Shipping war-risk premiums hit record", "Defence and Pharma capacity constraints", "Swap-line eases funding"],
            "impacts": {"OIL": 1.10, "LMT": 1.15, "PFE": 1.12, "HDFC": 1.05}
        },
        98: {
            "factor": "Technological Developments",
            "bullets": ["Signal is genuine propulsion breakthrough", "Oil futures drop on substitution fears", "Lawmakers audit contractors"],
            "impacts": {"SPACEX": 1.40, "OIL": 0.85, "TSMC": 1.15, "SAMSUNG": 1.15, "LMT": 0.90}
        },
        110: {
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
