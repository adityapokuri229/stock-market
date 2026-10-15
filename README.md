# Chakravyuh - Nivesh Chakra (Stock Market Simulation)

An institutional-grade, multi-factor real-time stock market trading simulation and competition platform. 

> **Context & Origin**: This project was essentially created for the **Chakravyuh** flagship event. It allows administrators to host an interactive trading game where teams trade equities in real-time under macro-factor news shocks, market drift, and company-specific sensitivities.

---

## 📚 Economic Foundation & Prerequisites

All the core underlying quantitative models, economic formulas, company betas, macro factor matrices, and design specifications are housed in the [`PRD/`](file:///home/adityapokuri/Documents/DEVELOPMENT/Stock%20Market/stock-market/PRD) folder:
* **`PRD/Chakravyuh Trading Game - Developer Handover (v5).docx`**: The core economic stochastic engine specifications (Geometric Brownian Motion with mean-reversion, news decay, and jump shocks).
* **`PRD/Chakravyuh - Nivesh Chakra - Developer Handover.pdf`**: Equities universe, factor definitions, starting financials, and game rules.
* **`PRD/Chakravyuh Judge Console - Full Implementation Handover (v2).pdf`**: Quantitative scoring algorithms (composite Return, Diversification/Risk, and Hedging/Macro alignment).
* **`PRD/UI Schem 1.jpeg`, `2.jpeg`, `3.jpeg`**: Visual schematics and UI layout specifications.

---

## 🚀 Features & Architecture

* **Student Trading Terminal (`index.html` / `app.js`)**:
  * Real-time tick-by-tick charts (Line and Candlestick modes).
  * Live ticker tape and breaking news feed with synthesized Web Audio alert chimes.
  * Instant order entry (Market & Limit orders, Long positions, and Short selling).
  * Real-time portfolio valuation, cash tracking, P&L, and trade execution blotter.
  * Comprehensive Stock Research modal with business models, headquarters, and supply chain footprints.
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

## 🛠️ Setup & Running the Platform

### 1. Prerequisites
* Python 3.8+ installed.
* Optional: `numpy` (only required if generating new game scenarios with `market_engine.py`).

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Update `.env` with your Firebase credentials (if using Firebase for live real-time sync across multiple devices).

> **Note**: For local or offline events, the game runs out-of-the-box in standalone/offline mode.

### 3. Start the Server
Run the included development server, which loads your `.env` configuration securely without committing keys to Git:
```bash
python server.py
```
Or specify a custom port:
```bash
PORT=8080 python server.py
```

Access the interfaces:
* **Student Trading Portal**: [http://localhost:8000/index.html](http://localhost:8000/index.html)
* **Judge / Admin Console**: [http://localhost:8000/admin.html](http://localhost:8000/admin.html)

---

## 👨‍⚖️ How to Run the Event via the Admin Panel

1. **Log in to Admin Console**:
   * Navigate to `http://localhost:8000/admin.html`.
   * Enter the admin passkey (Default: `judge123`).

2. **Register Teams & Set Capital**:
   * Under **Team Management**, enter the Team Name, Password, and Starting Capital (e.g., ₹10,00,000).
   * Click **Add Team**. Teams can now log into their student trading terminals.

3. **Phase Progression**:
   * **Start Event / Portfolio Building**: Puts all teams into the 5-minute portfolio preparation countdown where students analyze equities and establish initial holdings.
   * **Start Round 1 / Round 2**: Initiates the live market ticks (20 minutes / 1,200 ticks per session).
   * **Pause / Resume**: Temporarily freeze the market clock if announcements or interventions are needed.

4. **Scoring & Exporting**:
   * Tune scoring weights ($R$, $D$, $H$) live on the dashboard.
   * Click **Export CSV** at the end of the competition for final standings and detailed metrics.
