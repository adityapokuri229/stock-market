import json
import numpy as np
import random

# =================================================================
# 4.10 V5 CONSTANTS
# =================================================================
TICKS_PER_SESSION = 120
TICK_SECONDS = 10
SESSIONS = 2

DRIFT = 6.2e-5
VOL_SCALE = 1.0
REF_TAU = 36.0
KAPPA = 0.08
PERM_FRAC = 0.35
IDIO_MULT = 1.6
SCORE_SPREAD = 0.20

# =================================================================
# FACTOR CONFIGURATION
# =================================================================
FACTORS = [
    'GlobalTech', 'GlobalRisk', 'RatesRupee', 'ConsDemand', 
    'SupplyChain', 'DomPolicy', 'Credit', 'CrudeOil', 'EnergyTx', 'Metals'
]
NF = len(FACTORS)
FIDX = {f: i for i, f in enumerate(FACTORS)}

# Factor background volatilities (approximate reasonable values)
FACTOR_VOL = np.array([0.001] * NF)
MKT_VOL = 0.0015

# =================================================================
# TICKER CONFIGURATION
# =================================================================
TICKER_CONFIG = [
    {'ticker': 'TCS', 'company': 'Tata Consultancy Services', 'start_price': 3850, 'type': 'Equity', 'research': 'Tata Consultancy Services -- sensitivities: GlobalTech +0.85, GlobalRisk +0.35, RatesRupee -0.20, ConsDemand +0.10', 'idio': 0.002, 'mkt_beta': 1.1, 'betas': {'GlobalTech': 0.85, 'GlobalRisk': 0.35, 'RatesRupee': -0.20, 'ConsDemand': 0.10}},
    {'ticker': 'INFY', 'company': 'Infosys', 'start_price': 1520, 'type': 'Equity', 'research': 'Infosys -- sensitivities: GlobalTech +0.90, GlobalRisk +0.30, RatesRupee -0.30, SupplyChain -0.10', 'idio': 0.0022, 'mkt_beta': 1.15, 'betas': {'GlobalTech': 0.90, 'GlobalRisk': 0.30, 'RatesRupee': -0.30, 'SupplyChain': -0.10}},
    {'ticker': 'HDFCBANK', 'company': 'HDFC Bank', 'start_price': 1650, 'type': 'Equity', 'research': 'HDFC Bank -- sensitivities: RatesRupee +0.80, DomPolicy +0.35, Credit +0.40, ConsDemand +0.15', 'idio': 0.0015, 'mkt_beta': 1.2, 'betas': {'RatesRupee': 0.80, 'DomPolicy': 0.35, 'Credit': 0.40, 'ConsDemand': 0.15}},
    {'ticker': 'ICICIBANK', 'company': 'ICICI Bank', 'start_price': 1120, 'type': 'Equity', 'research': 'ICICI Bank -- sensitivities: RatesRupee +0.78, DomPolicy +0.30, Credit +0.45, GlobalRisk +0.20', 'idio': 0.0016, 'mkt_beta': 1.25, 'betas': {'RatesRupee': 0.78, 'DomPolicy': 0.30, 'Credit': 0.45, 'GlobalRisk': 0.20}},
    {'ticker': 'RELIANCE', 'company': 'Reliance Industries', 'start_price': 2900, 'type': 'Equity', 'research': 'Reliance Industries -- sensitivities: CrudeOil +0.55, DomPolicy +0.30, ConsDemand +0.25, EnergyTx +0.25', 'idio': 0.0018, 'mkt_beta': 1.05, 'betas': {'CrudeOil': 0.55, 'DomPolicy': 0.30, 'ConsDemand': 0.25, 'EnergyTx': 0.25}},
    {'ticker': 'ONGC', 'company': 'Oil & Natural Gas Corp', 'start_price': 270, 'type': 'Equity', 'research': 'Oil & Natural Gas Corp -- sensitivities: CrudeOil +0.88, EnergyTx -0.35, GlobalRisk +0.25', 'idio': 0.0025, 'mkt_beta': 0.9, 'betas': {'CrudeOil': 0.88, 'EnergyTx': -0.35, 'GlobalRisk': 0.25}},
    {'ticker': 'TATAMOTORS', 'company': 'Tata Motors', 'start_price': 950, 'type': 'Equity', 'research': 'Tata Motors -- sensitivities: CrudeOil -0.50, Metals -0.40, RatesRupee +0.45, ConsDemand +0.35, GlobalRisk +0.30', 'idio': 0.0028, 'mkt_beta': 1.3, 'betas': {'CrudeOil': -0.50, 'Metals': -0.40, 'RatesRupee': 0.45, 'ConsDemand': 0.35, 'GlobalRisk': 0.30}},
    {'ticker': 'TATASTEEL', 'company': 'Tata Steel', 'start_price': 140, 'type': 'Equity', 'research': 'Tata Steel -- sensitivities: Metals +0.90, GlobalRisk +0.35, SupplyChain +0.25, CrudeOil +0.15', 'idio': 0.003, 'mkt_beta': 1.4, 'betas': {'Metals': 0.90, 'GlobalRisk': 0.35, 'SupplyChain': 0.25, 'CrudeOil': 0.15}},
    {'ticker': 'HINDUNILVR', 'company': 'Hindustan Unilever', 'start_price': 2400, 'type': 'Equity', 'research': 'Hindustan Unilever -- sensitivities: ConsDemand +0.55, CrudeOil -0.30, RatesRupee +0.20, DomPolicy +0.20', 'idio': 0.0012, 'mkt_beta': 0.8, 'betas': {'ConsDemand': 0.55, 'CrudeOil': -0.30, 'RatesRupee': 0.20, 'DomPolicy': 0.20}},
    {'ticker': 'SUNPHARMA', 'company': 'Sun Pharmaceutical', 'start_price': 1500, 'type': 'Equity', 'research': 'Sun Pharmaceutical -- sensitivities: DomPolicy +0.75, GlobalTech +0.15, SupplyChain -0.20, ConsDemand +0.20', 'idio': 0.0018, 'mkt_beta': 0.85, 'betas': {'DomPolicy': 0.75, 'GlobalTech': 0.15, 'SupplyChain': -0.20, 'ConsDemand': 0.20}},
]
TICKERS = [c['ticker'] for c in TICKER_CONFIG]
NT = len(TICKERS)

# =================================================================
# ENGINE IMPLEMENTATION
# =================================================================
class MarketEngine:
    def __init__(self, seed=7):
        self.rng = np.random.default_rng(seed)
        
        self.px = np.array([c['start_price'] for c in TICKER_CONFIG], dtype=float)
        self.anchor = self.px.copy()
        
        # Build beta matrix (NT x NF)
        self.beta = np.zeros((NT, NF))
        for i, config in enumerate(TICKER_CONFIG):
            for f, val in config['betas'].items():
                self.beta[i, FIDX[f]] = val
                
        self.mkt_beta = np.array([c['mkt_beta'] for c in TICKER_CONFIG], dtype=float)
        self.idio_vol = np.array([c['idio'] for c in TICKER_CONFIG], dtype=float)
        
        # Cholesky factor matrix L (identity for simplicity)
        self.L = np.eye(NF)
        
        self.sessions = self._generate_events()

    def _generate_events(self):
        # Generate some sample news events
        events = {0: [], 1: []}
        
        sample_bullets = [
            ("Tanker attacked near Hormuz", "Crude spikes on supply fears", "Energy names in focus"),
            ("Tech rally on AI optimism", "Global markets surge", "Semiconductor stocks up"),
            ("RBI surprises with rate hike", "Banks react to tighter policy", "Rupee strengthens"),
            ("Consumer spending data weak", "Retailers cautious on outlook", "Rural demand sluggish"),
            ("Supply chain disruptions ease", "Freight costs drop", "Manufacturing outlook improves"),
            ("New industrial policy announced", "Subsidies for manufacturing", "Domestic sectors rally"),
            ("Credit growth hits record high", "Loan defaults remain low", "Financial sector booms"),
            ("Metal prices surge in LME", "Copper and steel reach new highs", "Mining stocks jump"),
            ("Energy transition tax proposed", "Green initiatives funded", "Fossil fuels face headwinds"),
            ("Global risk-off sentiment", "Investors flee to safety", "Emerging markets face pressure")
        ]
        
        factors = ['CrudeOil', 'GlobalTech', 'RatesRupee', 'ConsDemand', 'SupplyChain', 
                   'DomPolicy', 'Credit', 'Metals', 'EnergyTx', 'GlobalRisk']
        
        for sess in range(SESSIONS):
            for i in range(20): # 20 events per session
                fire_tick = self.rng.integers(0, TICKS_PER_SESSION)
                idx = self.rng.integers(0, len(factors))
                target = self.rng.uniform(-0.8, 0.8)
                gain = self.rng.uniform(0.03, 0.08)
                tau = self.rng.uniform(10, 60)
                
                events[sess].append({
                    'fire_tick': fire_tick,
                    'factor': factors[idx],
                    'ticker': None,
                    'target': target,
                    'gain': gain,
                    'tau': tau,
                    'bullets': list(sample_bullets[idx]),
                    'score': None
                })
                
        return events

    def _shock(self, e, t_local):
        age = t_local - e['fire_tick']
        if age < 0:
            return 0
        return e['score'] * e['gain'] * np.exp(-age / e['tau']) * (REF_TAU / e['tau'])

    def step(self, session, t_local):
        events = self.sessions[session]
        
        # (a) fire due events
        fired_now = []
        for e in events:
            if e['fire_tick'] == t_local:
                raw = self.rng.normal(e['target'], SCORE_SPREAD)
                e['score'] = float(np.clip(raw, -1, 1))
                # For output, we only need the visible parts
                fired_now.append({
                    'bullets': e['bullets'],
                    'factor': e['factor'],
                    'ticker': e['ticker'],
                    'score': e['score']
                })
                
        # (b) sum every active shock, split into factor vs ticker
        factor_shock = np.zeros(NF)
        ticker_shock = np.zeros(NT)
        for e in events:
            if e['score'] is None: 
                continue
            val = self._shock(e, t_local)
            if e['factor']:
                factor_shock[FIDX[e['factor']]] += val
            if e['ticker']:
                ticker_shock[TICKERS.index(e['ticker'])] += val
                
        # (c) correlated factor background + news
        z = self.rng.standard_normal(NF)
        F = VOL_SCALE * (self.L @ z) * FACTOR_VOL + factor_shock
        
        # (d) one shared market move
        M = VOL_SCALE * MKT_VOL * self.rng.standard_normal()
        
        # (e) per stock: news -> anchor -> reversion -> return -> price
        N = self.beta @ F + ticker_shock
        self.anchor *= np.exp(PERM_FRAC * N)
        
        # Safe log for reversion calculation
        anchor_val = np.maximum(self.anchor, 1e-8)
        px_val = np.maximum(self.px, 1e-8)
        
        R = KAPPA * (np.log(anchor_val) - np.log(px_val))
        idio = VOL_SCALE * IDIO_MULT * self.idio_vol * self.rng.standard_normal(NT)
        r = DRIFT + self.mkt_beta * M + N + R + idio
        self.px *= np.exp(r)
        
        # Ensure prices don't go exactly to zero or negative
        self.px = np.maximum(self.px, 0.01)
        
        # Return serializable dict
        px_dict = {ticker: round(float(price), 2) for ticker, price in zip(TICKERS, self.px)}
        
        return dict(prices=px_dict, factors=F.tolist(), news=fired_now)

def build_game():
    import sys
    if len(sys.argv) > 1:
        seed = int(sys.argv[1])
    else:
        seed = random.randint(0, 2**31 - 1)
    eng = MarketEngine(seed=seed)

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
        'seed': seed,
        'sessions': SESSIONS,
        'ticks_per_session': TICKS_PER_SESSION,
        'tick_seconds': TICK_SECONDS,
        'tickers': TICKERS,
        'start_prices': start_prices
    }
    
    rows = []
    for s in range(SESSIONS):
        for t in range(TICKS_PER_SESSION):
            out = eng.step(s, t)
            rows.append({
                'session': s,
                'tick': t,
                'prices': out['prices'],
                'news': out['news']
            })
            
    game_data = {
        'meta': meta,
        'universe': universe,
        'rows': rows
    }
    
    with open('game_data.json', 'w') as f:
        json.dump(game_data, f, indent=2)
        
    print(f"Generated game_data.json with {SESSIONS} sessions and {TICKS_PER_SESSION} ticks per session. Seed used: {seed}")

if __name__ == '__main__':
    build_game()
