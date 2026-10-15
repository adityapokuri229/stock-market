# Chakravyuh - Nivesh Chakra (Stock Market Simulation)

An institutional-grade, multi-factor real-time stock market trading simulation and competition platform.

> **Context & Origin**: This platform was created specifically for the **Chakravyuh** flagship event. It enables administrators and judges to run a live, interactive market simulation where student teams analyze news headlines, factor shocks, and equity sensitivities to trade in real-time.

---

## 🌐 Live Deployments

The platform is deployed live and fully functional on Netlify:
* **Student Trading Portal**: [https://dpsstockmarket.netlify.app](https://dpsstockmarket.netlify.app)
* **Judge / Admin Console**: [https://dpsstockmarket.netlify.app/admin.html](https://dpsstockmarket.netlify.app/admin.html)
  * **Admin Password**: `judge123`

---

## 📚 Economic Foundation & Prerequisites

All quantitative economic formulas, stochastic engine mathematics, company betas, macro factor matrices, and design specifications are documented in the [`PRD/`](file:///home/adityapokuri/Documents/DEVELOPMENT/Stock%20Market/stock-market/PRD) directory:
* **`PRD/Chakravyuh Trading Game - Developer Handover (v5).docx`**: Detailed mathematical specification of the stochastic price engine (Geometric Brownian Motion with drift, sector betas, mean reversion, news decay, and jump shocks).
* **`PRD/Chakravyuh - Nivesh Chakra - Developer Handover.pdf`**: Equities universe, macro factor definitions, starting financials, and competition guidelines.
* **`PRD/Chakravyuh Judge Console - Full Implementation Handover (v2).pdf`**: Quantitative evaluation framework covering Return ($R$), Diversification/Risk ($D$), and Factor Hedging ($H$).
* **`PRD/UI Schem 1.jpeg`, `2.jpeg`, `3.jpeg`**: Visual schematics and UI layout specifications.

---

## 🚀 Features & Architecture

* **Student Trading Terminal (`index.html` / `app.js`)**:
  * Real-time tick-by-tick charts (Line and Candlestick modes).
  * Live ticker tape and breaking news feed with synthesized Web Audio alert chimes.
  * Instant order entry (Market & Limit orders, Long positions, and Short selling).
  * Real-time portfolio valuation, cash balance, P&L, and trade execution blotter.
  * Stock Research modal detailing business models, headquarters, and supply chain footprints.
  * Offline fallback mode (auto-generates bundle `.json` download for manual submission).

* **Judge & Admin Console (`admin.html` / `admin.js`)**:
  * **Event Management**: Control game phases across sessions (Waiting Room, 5-minute Portfolio Building phase, Session 1, and Session 2).
  * **Dynamic Team Management**: Register and configure user teams with custom passwords and unique starting capital directly from the admin panel during each session.
  * **Real-time Live Leaderboard**: Synchronized evaluation of team equity curves and rankings.
  * **Quantitative Evaluation & Radar Charts**: Multi-factor performance analysis across Return ($R$), Diversification ($D$), and Factor Hedging ($H$).
  * **Auditing & Export**: Inspection of round-trip trade executions and one-click export to CSV.

* **Market Engine (`market_engine.py`)**:
  * Simulates 12 equities across 11 macroeconomic factors (*InterestRates, RegulatoryRisk, Oil, InflationReaction, GeopoliticalStability, SemiconductorDemand, ConsumerDisc, InvestorConfidence, TechDevelopments, Aero, Healthcare*).
  * Deterministic reproduction via seeds (`python market_engine.py <seed>`).

---

## 🛠️ Running Locally

Because modern web browsers enforce CORS restrictions on local `file:///` requests for JSON data and ES modules, run the project with any local HTTP server:

```bash
# Using Python
python -m http.server 8000
```

Then open in your browser:
* **Student Trading Portal**: [http://localhost:8000/index.html](http://localhost:8000/index.html)
* **Judge / Admin Console**: [http://localhost:8000/admin.html](http://localhost:8000/admin.html)

---

## 👨‍⚖️ How to Run the Event via the Admin Panel

1. **Log in to Admin Console**:
   * Navigate to [`https://dpsstockmarket.netlify.app/admin.html`](https://dpsstockmarket.netlify.app/admin.html) (or `http://localhost:8000/admin.html` locally).
   * Enter the admin passkey: **`judge123`**.

2. **Register Teams & Set Capital**:
   * Under **Team Management**, enter the Team Name, Password, and Starting Capital (e.g., ₹10,00,000).
   * Click **Add Team**. Teams can now log into their student trading terminals using their assigned credentials.

3. **Phase Progression**:
   * **Start Event / Portfolio Building**: Puts all teams into the 5-minute portfolio preparation countdown where students analyze equities and establish initial holdings.
   * **Start Round 1 / Round 2**: Initiates the live market ticks (20 minutes / 1,200 ticks per session).
   * **Pause / Resume**: Temporarily freeze the market clock if announcements or interventions are needed.

4. **Scoring & Exporting**:
   * Tune scoring weights ($R$, $D$, $H$) live on the dashboard.
   * Click **Export CSV** at the end of the competition for final standings and detailed metrics.
