    // =================================================================
    // DATA & STATE
    // =================================================================
    let START_CAPITAL = 1_000_000; // ₹10 Lakh default; overridden per-team at login if the judge set one

    let gameData = null;
    let currentTick = 0; // also the tick used for pricing during portfolio-building (pre-round) trades
    let tickSynced = false; // forces at least one processTick() even if the first synced tick is 0
    let clockInterval = null;  // 1s poller: derives currentTick + the visible countdown from the shared anchor
    let clockSecsLeft = 0;
    let tickerPrevPrices = {};
    let prevSelectedPrice = null;
    let newsBuffer = [];
    let isAuthenticated = false;
    let currentTeam = '';
    let pbCountdownInterval = null;  // portfolio building countdown timer
    let gameStarted = false; // one-shot guard so startGame() never runs twice

    // The authoritative game/status fields from Firebase (not a local counter) --
    // every team AND the judge panel derive the current tick/clock from this same
    // shared anchor, so refreshing mid-game re-syncs instead of resetting to zero.
    let liveState = 'waiting';
    let liveSession = 0;
    let livePhaseStartedAt = 0;
    let livePausedAccumMs = 0;
    let livePausedAt = null;

    // Trading state
    let cash = START_CAPITAL;
    const holdings = {}; // ticker → { shares, avgCost }
    const orderHistory = [];

    // Portfolio tracking
    const equitySeries = [];  // portfolio value at each tick
    const marketSeries = [];  // market index value at each tick
    const tickLabels = [];

    // Chart instances
    let priceChart = null;
    let equityChart = null;
    let selectedTicker = 'TCS';
    let chartMode = 'line'; // 'line' or 'candle'

    // Price history per ticker
    const priceHistory = {}; // ticker → [prices...]

    // =================================================================
    // UTILITIES
    // =================================================================
    function formatINR(amount) {
        const neg = amount < 0;
        let x = Math.abs(amount).toFixed(2).split('.');
        let x1 = x[0], x2 = '.' + x[1];
        if (x1.length > 3) {
            let last3 = x1.substring(x1.length - 3);
            let others = x1.substring(0, x1.length - 3);
            x1 = others.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
        }
        return (neg ? '-' : '') + '₹' + x1 + x2;
    }

    function showToast(msg, type = 'success') {
        const t = document.getElementById('toast');
        t.className = `toast toast-${type}`;
        t.textContent = msg;
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 3500);
    }

    function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
    function std(arr) {
        if (arr.length < 2) return 0;
        const m = mean(arr);
        return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
    }
    function pctChanges(arr) {
        const r = [];
        for (let i = 1; i < arr.length; i++) r.push((arr[i] - arr[i - 1]) / arr[i - 1]);
        return r;
    }

    // =================================================================
    // LOAD GAME DATA
    // =================================================================
    async function loadGameData() {
        try {
            const resp = await fetch('game_data.json');
            gameData = await resp.json();
            // Initialize price history arrays
            gameData.meta.tickers.forEach(tk => { priceHistory[tk] = []; });
            console.log('Game data loaded:', gameData.meta);
            return true;
        } catch (err) {
            console.error('Failed to load game_data.json:', err);
            showToast('Failed to load game data!', 'error');
            return false;
        }
    }

    // =================================================================
    // LOGIN
    // =================================================================
    document.getElementById('login-btn').addEventListener('click', handleLogin);
    document.getElementById('team-password').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
    document.getElementById('team-name').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });

    async function handleLogin() {
        const team = document.getElementById('team-name').value.trim().toLowerCase();
        const pass = document.getElementById('team-password').value.trim();
        const err = document.getElementById('login-error');

        // Load game data first
        const loaded = await loadGameData();
        if (!loaded) return;

        let verified = false;
        if (window.firebaseGlue && window.firebaseGlue.verifyTeam) {
            try {
                verified = await window.firebaseGlue.verifyTeam(team, pass);
            } catch (error) {
                console.error(error);
                err.textContent = 'System error: Could not verify credentials via Firebase';
                err.style.display = 'block';
                return;
            }
        } else {
            err.textContent = 'Firebase is not initialized for login';
            err.style.display = 'block';
            return;
        }

        if (!verified) {
            err.textContent = 'Invalid team name or password';
            err.style.display = 'block';
            return;
        }

        // Pick up this team's judge-configured starting capital, if any.
        if (window.firebaseGlue && window.firebaseGlue.getTeamCapital) {
            try {
                const capital = await window.firebaseGlue.getTeamCapital(team);
                if (typeof capital === 'number' && capital > 0) {
                    START_CAPITAL = capital;
                }
            } catch (error) {
                console.error('Failed to fetch team starting capital, using default:', error);
            }
        }
        cash = START_CAPITAL;

        isAuthenticated = true;
        currentTeam = team;
        err.style.display = 'none';

        // Show UI elements
        document.getElementById('user-badge').classList.add('show');
        document.getElementById('user-badge-name').textContent = team.charAt(0).toUpperCase() + team.slice(1);
        document.getElementById('user-avatar').textContent = team.charAt(0).toUpperCase();

        // Populate dropdowns and tabs
        populateTickerDropdown();
        initPriceChart();
        initEquityChart();
        renderResearch();
        buildTickerTape();

        // Init Firebase glue
        if (window.firebaseGlue && window.firebaseGlue.initGlue) {
            console.log("Initializing Firebase glue...");
            window.firebaseGlue.initGlue(currentTeam);

            // Rebuild cash/holdings/orderHistory from this team's real order
            // history in Firebase -- runs immediately on login/refresh (restoring
            // whatever was already traded) and again any time it changes.
            if (window.firebaseGlue.watchTeamOrders) {
                window.firebaseGlue.watchTeamOrders(currentTeam, (orders, error) => {
                    if (error) {
                        console.error("Firebase watchTeamOrders error:", error);
                        return;
                    }
                    applyOrdersToPortfolio(orders || []);
                });
            }

            if (window.firebaseGlue.watchGameState) {
                console.log("Attaching watchGameState listener...");
                window.firebaseGlue.watchGameState((status, error) => {
                    if (error) {
                        console.error("Firebase watchGameState error:", error);
                        showToast("Connection issue - couldn't reach the judge. Please tell a judge/organizer.");
                        return;
                    }
                    if (!status) return;
                    console.log("Received game state from Firebase:", status);

                    // Sync the shared anchor -- everything below derives from these,
                    // never from a local counter, so a refresh mid-game re-syncs
                    // to wherever the game actually is instead of resetting.
                    liveState = status.state || 'waiting';
                    liveSession = status.currentSession || 0;
                    livePhaseStartedAt = status.phaseStartedAt || 0;
                    livePausedAccumMs = status.pausedAccumMs || 0;
                    livePausedAt = (status.pausedAt != null) ? status.pausedAt : null;

                    if (liveState === 'portfolio_building') {
                        console.log("Portfolio building phase started!");
                        // Unlock the full UI so they can browse and trade
                        document.getElementById('main-nav').style.display = 'flex';
                        document.getElementById('game-controls').classList.add('show');
                        document.getElementById('ticker-tape').classList.add('show');
                        document.getElementById('game-status').textContent = '📦 Portfolio Building Phase';

                        // Show portfolio building banner in waiting tab
                        document.getElementById('waiting-state').style.display = 'none';
                        document.getElementById('portfolio-building-state').style.display = 'block';

                        // Switch to waiting tab to show the countdown + CTA
                        switchTab('waiting');

                        // Load tick-0 prices into UI widgets ONLY (do not push to equitySeries)
                        if (gameData) {
                            const row0 = gameData.rows[0];
                            if (row0) {
                                updateCurrentPrice();
                                updateTickerTape(row0.prices);
                                updatePriceChart();
                            }
                        }

                        // Countdown display derived from the shared anchor (visual only --
                        // admin owns actual timing), so it survives a refresh correctly too.
                        syncPortfolioBuildDisplay();
                        if (!pbCountdownInterval) {
                            pbCountdownInterval = setInterval(syncPortfolioBuildDisplay, 1000);
                        }

                    } else if (liveState === 'playing' || liveState === 'paused') {
                        console.log(`Game state is ${liveState}...`);
                        // Clear portfolio building countdown if running
                        if (pbCountdownInterval) {
                            clearInterval(pbCountdownInterval);
                            pbCountdownInterval = null;
                        }
                        document.getElementById('portfolio-building-state').style.display = 'none';
                        document.getElementById('waiting-state').style.display = 'block';

                        document.getElementById('main-nav').style.display = 'flex';
                        document.getElementById('game-controls').classList.add('show');
                        document.getElementById('ticker-tape').classList.add('show');

                        switchTab('trade');
                        startGame(); // no-op if already running (gameStarted guard)
                        syncTickFromClock(); // apply immediately instead of waiting up to 1s
                    } else if (liveState === 'waiting') {
                        console.log("Game state is waiting, showing waiting room...");
                        document.getElementById('main-nav').style.display = 'none';
                        document.getElementById('game-controls').classList.remove('show');
                        document.getElementById('ticker-tape').classList.remove('show');
                        switchTab('waiting');
                    } else if (liveState === 'ended') {
                        console.log("Game state is ended -- judge ended the round/event.");
                        switchTab('trade');
                        if (clockInterval) {
                            endGame('Judge ended the event. Game Over!');
                        }
                    }
                });
            } else {
                console.error("watchGameState is not available on window.firebaseGlue");
            }
        } else {
            console.error("Firebase glue not found or initGlue missing!");
        }

        showToast(`Welcome, Team ${team.charAt(0).toUpperCase() + team.slice(1)}!`);
    }

    // =================================================================
    // NAVIGATION
    // =================================================================
    function switchTab(tabName) {
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
        document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('active');
        const target = document.getElementById(`tab-${tabName}`);
        if (target) {
            target.classList.add('active');
            target.style.animation = 'none';
            void target.offsetWidth;
            target.style.animation = 'pageEnter 0.4s ease both';
        }
        document.getElementById('tab-login').classList.remove('active');

        if (tabName === 'portfolio') refreshPortfolio();
        if (tabName === 'research') renderResearch();
    }

    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            if (!isAuthenticated) return;
            switchTab(tab.dataset.tab);
        });
    });

    // Local pause removed in favor of Judge-controlled pausing
    function startGame() {
        console.log("startGame() invoked!");
        if (gameStarted) {
            // Already running — only handle resume from paused state, do not re-init
            return;
        }
        gameStarted = true;
        currentTick = 0;

        // Reset tracking arrays so portfolio-building phase data doesn't pollute the chart
        equitySeries.length = 0;
        marketSeries.length = 0;
        tickLabels.length = 0;

        document.getElementById('btn-start-game').style.display = 'none';
        document.getElementById('game-timer').classList.add('show');

        // Sync to the authoritative tick immediately -- handles both a fresh round
        // start and resuming mid-round after a refresh -- then keep polling it.
        syncTickFromClock();
        clockInterval = setInterval(syncTickFromClock, 1000);

        showToast('Market is now LIVE! 🔔');
    }

    // Stops the tick loop and exports the fallback order bundle. Called both when
    // the game naturally runs out of ticks and when the judge ends the round/event early.
    function endGame(message) {
        if (clockInterval) {
            clearInterval(clockInterval);
            clockInterval = null;
        }
        document.getElementById('game-status').textContent = 'Game Over!';
        document.getElementById('timer-dot').style.background = 'var(--text-muted)';
        document.getElementById('timer-dot').style.animation = 'none';
        showToast(message || 'Game Over! All sessions complete.');

        // Export fallback bundle
        const bundle = {
            game_seed: gameData.meta.seed,
            team: currentTeam,
            orders: orderHistory
        };
        const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `chakravyuh_bundle_${currentTeam}_${gameData.meta.seed}.json`;
        a.click();
    }

    function updateClockDisplay() {
        const mm = Math.floor(clockSecsLeft / 60).toString().padStart(2, '0');
        const ss = (clockSecsLeft % 60).toString().padStart(2, '0');
        document.getElementById('timer-clock').textContent = `${mm}:${ss}`;
    }

    // Portfolio Building countdown, derived from the shared anchor each second
    // (visual only -- the judge panel owns actual timing) so it survives a
    // refresh mid-countdown instead of restarting from 5:00.
    function syncPortfolioBuildDisplay() {
        const PB_DURATION_SEC = 5 * 60;
        const pbEl = document.getElementById('pb-countdown');
        const remaining = Math.max(0, PB_DURATION_SEC - Math.floor((window.firebaseGlue.now() - livePhaseStartedAt) / 1000));
        if (remaining > 0) {
            const m = Math.floor(remaining / 60);
            const s = remaining % 60;
            if (pbEl) pbEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
        } else {
            if (pbEl) pbEl.textContent = 'Round 1 starting soon...';
            if (pbCountdownInterval) {
                clearInterval(pbCountdownInterval);
                pbCountdownInterval = null;
            }
        }
    }

    // Derives the current tick and remaining-time display purely from the shared
    // server-anchored clock (liveState/liveSession/livePhaseStartedAt/
    // livePausedAccumMs/livePausedAt) instead of incrementing a local counter --
    // so refreshing mid-round (or joining mid-round for the first time) lands on
    // the correct tick, and every team + the judge panel always agree since they
    // derive from the exact same anchor.
    function syncTickFromClock() {
        if (!gameData || (liveState !== 'playing' && liveState !== 'paused')) return;

        const ticksPerSession = gameData.meta.ticks_per_session;
        const tickSeconds = gameData.meta.tick_seconds;
        const nowMs = window.firebaseGlue.now();
        const ongoingPauseMs = (liveState === 'paused' && livePausedAt != null) ? (nowMs - livePausedAt) : 0;
        const elapsedMs = Math.max(0, nowMs - livePhaseStartedAt - livePausedAccumMs - ongoingPauseMs);
        const elapsedSec = Math.floor(elapsedMs / 1000);
        const tickInSession = Math.min(ticksPerSession - 1, Math.floor(elapsedSec / tickSeconds));
        const globalIdx = liveSession * ticksPerSession + tickInSession;

        const dot = document.getElementById('timer-dot');
        const statusEl = document.getElementById('game-status');
        const isLastSession = liveSession >= gameData.meta.sessions - 1;
        if (liveState === 'paused') {
            if (dot) dot.classList.add('paused');
            if (statusEl) statusEl.textContent = 'PAUSED by Judge';
        } else if (tickInSession >= ticksPerSession - 1) {
            if (dot) dot.classList.add('paused');
            if (statusEl) statusEl.textContent = isLastSession
                ? 'Waiting for Judge to end the event...'
                : 'Waiting for Judge to start next round...';
        } else {
            if (dot) dot.classList.remove('paused');
            if (statusEl) statusEl.textContent = 'Market is LIVE';
        }

        if (globalIdx === currentTick && tickSynced) {
            clockSecsLeft = Math.max(0, (ticksPerSession - tickInSession - 1) * tickSeconds - (elapsedSec % tickSeconds));
            updateClockDisplay();
            return;
        }

        // Catching up within the same session (e.g. the tab was backgrounded and
        // the browser throttled our 1s poll) -- replay every intermediate tick so
        // no news drop or price-history point along the way is silently skipped.
        // A judge-triggered session change (or our very first sync) instead jumps
        // straight to the target tick, since there's nothing valid to replay from.
        const prevRow = tickSynced ? gameData.rows[currentTick] : null;
        if (prevRow && prevRow.session === liveSession && globalIdx > currentTick) {
            while (currentTick < globalIdx) {
                currentTick++;
                processTick();
            }
        } else {
            currentTick = globalIdx;
            processTick();
        }
        tickSynced = true;
    }

    // =================================================================
    // THE HEARTBEAT — PROCESS ONE TICK
    // =================================================================
    function processTick() {
        const row = gameData.rows[currentTick];
        if (!row) return;

        const session = row.session;
        const tickInSession = row.tick;

        // If session changed, flush any pending news from the old session.
        // Prices/portfolio carry through continuously per the PRD -- only news/market reshuffle per session.
        if (currentTick > 0 && gameData.rows[currentTick - 1].session !== session) {
            showToast(`Session ${session + 1} started!`);
            if (newsBuffer.length) {
                pushNews(newsBuffer, gameData.rows[currentTick - 1].session, gameData.meta.ticks_per_session - 1);
                newsBuffer = [];
            }
            // Clear price history for new session
            gameData.meta.tickers.forEach(tk => { priceHistory[tk] = []; });
        }

        // Store prices
        gameData.meta.tickers.forEach(tk => {
            priceHistory[tk].push(row.prices[tk]);
        });

        // Update timer -- resync the smooth per-second clock to this tick's true
        // remaining time; clockInterval counts it down second-by-second in between.
        document.getElementById('timer-session').textContent = session + 1;
        document.getElementById('timer-tick').textContent = tickInSession;
        const ticksLeft = gameData.meta.ticks_per_session - tickInSession - 1;
        clockSecsLeft = ticksLeft * gameData.meta.tick_seconds;
        updateClockDisplay();

        // News: surface each headline the instant it fires -- drops are already
        // spaced out on a fixed schedule, so there's no need to batch/delay them.
        if (row.news && row.news.length > 0) {
            newsBuffer.push(...row.news);
            pushNews(newsBuffer, session, tickInSession);
            newsBuffer = [];
        }

        // Update order widget current price
        updateCurrentPrice();

        // Update price chart
        updatePriceChart();

        // Update ticker tape
        updateTickerTape(row.prices);

        // Track portfolio & market for equity chart
        trackEquity(row);

        // Refresh portfolio if on that tab
        if (document.getElementById('tab-portfolio').classList.contains('active')) {
            refreshPortfolio();
        }
    }

    // =================================================================
    // TICKER TAPE
    // =================================================================
    function buildTickerTape() {
        const track = document.getElementById('ticker-track');
        let html = '';
        for (let rep = 0; rep < 3; rep++) {
            gameData.meta.tickers.forEach(tk => {
                const u = gameData.universe.find(u => u.ticker === tk);
                html += `<div class="ticker-item" data-ticker="${tk}">
                    <span class="ticker-symbol">${tk}</span>
                    <span class="ticker-price">${formatINR(u.start_price)}</span>
                    <span class="ticker-up">—</span>
                </div>`;
            });
        }
        track.innerHTML = html;
    }

    function updateTickerTape(prices) {
        document.querySelectorAll('.ticker-item').forEach(el => {
            const tk = el.dataset.ticker;
            if (!tk || !prices[tk]) return;
            const px = prices[tk];
            const startPx = gameData.meta.start_prices[tk];
            const chg = ((px - startPx) / startPx * 100);
            const isUp = chg >= 0;
            const priceEl = el.querySelector('.ticker-price');
            priceEl.textContent = formatINR(px);
            const prevPx = tickerPrevPrices[tk];
            if (prevPx !== undefined && prevPx !== px) {
                flashPrice(priceEl, px >= prevPx);
            }
            tickerPrevPrices[tk] = px;
            const changeEl = el.querySelector('.ticker-up, .ticker-down');
            changeEl.className = isUp ? 'ticker-up' : 'ticker-down';
            changeEl.textContent = `${isUp ? '▲' : '▼'} ${Math.abs(chg).toFixed(2)}%`;
        });
    }

    // Brief background flash on a price cell when it ticks up/down -- the classic
    // exchange-board convention for drawing the eye to a live price change.
    function flashPrice(el, isUp) {
        el.classList.remove('price-flash-up', 'price-flash-down');
        void el.offsetWidth; // restart animation if it's still flashing from the last tick
        el.classList.add(isUp ? 'price-flash-up' : 'price-flash-down');
        setTimeout(() => el.classList.remove('price-flash-up', 'price-flash-down'), 500);
    }

    // =================================================================
    // TICKER DROPDOWN & ORDER WIDGET
    // =================================================================
    function populateTickerDropdown() {
        const sel = document.getElementById('order-ticker');
        sel.innerHTML = '';
        gameData.meta.tickers.forEach(tk => {
            const u = gameData.universe.find(u => u.ticker === tk);
            const opt = document.createElement('option');
            opt.value = tk;
            opt.textContent = `${tk} — ${u ? u.company : ''}`;
            sel.appendChild(opt);
        });
        selectedTicker = gameData.meta.tickers[0];
        updateCurrentPrice();
    }

    document.getElementById('order-ticker').addEventListener('change', (e) => {
        selectedTicker = e.target.value;
        document.getElementById('chart-ticker-label').textContent = selectedTicker;
        prevSelectedPrice = null; // switching tickers isn't a price tick -- don't flash
        updateCurrentPrice();
        updatePriceChart();
    });

    function updateCurrentPrice() {
        const row = gameData?.rows[currentTick];
        if (!row) return;
        const px = row.prices[selectedTicker];
        const priceInput = document.getElementById('order-current-price');
        priceInput.value = px ? formatINR(px) : '—';
        if (px && prevSelectedPrice !== null && prevSelectedPrice !== px) {
            flashPrice(priceInput, px >= prevSelectedPrice);
        }
        prevSelectedPrice = px || null;
        // Enable/disable confirm
        const qty = parseInt(document.getElementById('order-quantity').value);
        document.getElementById('btn-confirm').disabled = !(qty > 0 && px);

        // Update Owned preview
        const ownedSpan = document.getElementById('order-shares-owned');
        if (ownedSpan) {
            const h = holdings[selectedTicker];
            ownedSpan.textContent = h ? `Owned: ${h.shares}` : 'Owned: 0';
        }
    }

    document.getElementById('order-quantity').addEventListener('input', updateCurrentPrice);

    // =================================================================
    // TRADING LOGIC (PRD Part 6.2)
    // =================================================================
    document.getElementById('btn-confirm').addEventListener('click', confirmOrder);
    document.getElementById('btn-clear').addEventListener('click', () => {
        document.getElementById('order-quantity').value = '';
        document.getElementById('order-error').style.display = 'none';
        document.getElementById('order-info').style.display = 'none';
        updateCurrentPrice();
    });

    function confirmOrder() {
        const ticker = selectedTicker;
        const side = document.getElementById('order-action').value;
        const qty = parseInt(document.getElementById('order-quantity').value);
        const row = gameData.rows[currentTick];
        const price = row.prices[ticker];
        const errEl = document.getElementById('order-error');
        const infoEl = document.getElementById('order-info');

        errEl.style.display = 'none';
        infoEl.style.display = 'none';

        if (!qty || qty <= 0) {
            errEl.textContent = 'Enter a valid quantity';
            errEl.style.display = 'block';
            return;
        }

        // Validate against the current (Firebase-replay-derived) cash/holdings for
        // immediate feedback. The actual cash/holdings/orderHistory update comes
        // from the watchTeamOrders listener replaying this order back in below --
        // that's the single source of truth, so it can't drift from what admin's
        // scoring sees, and it's what makes a refresh restore the real portfolio.
        if (side === 'BUY') {
            const cost = price * qty;
            if (cost > cash) {
                errEl.textContent = `Insufficient cash. Need ${formatINR(cost)}, have ${formatINR(cash)}`;
                errEl.style.display = 'block';
                return;
            }
            infoEl.textContent = `✅ Bought ${qty} ${ticker} @ ${formatINR(price)} = ${formatINR(cost)}`;
            showToast(`Bought ${qty} ${ticker} @ ${formatINR(price)}`);
        } else {
            const h = holdings[ticker];
            if (!h || h.shares < qty) {
                errEl.textContent = `Not enough shares. You hold ${h ? h.shares : 0} ${ticker}`;
                errEl.style.display = 'block';
                return;
            }
            const proceeds = price * qty;
            infoEl.textContent = `✅ Sold ${qty} ${ticker} @ ${formatINR(price)} = ${formatINR(proceeds)}`;
            showToast(`Sold ${qty} ${ticker} @ ${formatINR(price)}`);
        }
        infoEl.style.display = 'block';

        const orderObj = { ticker, side, qty, price, tick: currentTick };
        if (window.firebaseGlue && window.firebaseGlue.pushOrder) {
            window.firebaseGlue.pushOrder(orderObj);
        }

        document.getElementById('order-quantity').value = '';
        updateCurrentPrice();
    }

    // Rebuilds cash/holdings/orderHistory by replaying every order Firebase has
    // for this team (the source of truth), instead of mutating them locally as
    // each order is placed -- this is what makes the portfolio survive a refresh
    // (or reflect a teammate trading from another device) instead of resetting.
    function applyOrdersToPortfolio(orders) {
        const sorted = [...orders].sort((a, b) => a.tick - b.tick);
        let newCash = START_CAPITAL;
        const newHoldings = {};
        for (const o of sorted) {
            const cost = o.price * o.qty;
            if (o.side === 'BUY') {
                const h = newHoldings[o.ticker] || { shares: 0, avgCost: 0 };
                h.avgCost = (h.avgCost * h.shares + cost) / (h.shares + o.qty);
                h.shares += o.qty;
                newHoldings[o.ticker] = h;
                newCash -= cost;
            } else {
                const h = newHoldings[o.ticker];
                if (h) {
                    h.shares -= o.qty;
                    if (h.shares <= 0) delete newHoldings[o.ticker];
                }
                newCash += cost;
            }
        }

        cash = newCash;
        for (const tk in holdings) delete holdings[tk];
        Object.assign(holdings, newHoldings);
        orderHistory.length = 0;
        orderHistory.push(...sorted);

        updateCurrentPrice();
        if (document.getElementById('tab-portfolio').classList.contains('active')) {
            refreshPortfolio();
        }
    }

    // =================================================================
    // PRICE ACTION CHART (PRD Part 6.3)
    // =================================================================
    function initPriceChart() {
        const ctx = document.getElementById('price-chart').getContext('2d');
        priceChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: selectedTicker,
                    data: [],
                    borderColor: '#34d399',
                    backgroundColor: 'rgba(52, 211, 153, 0.08)',
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    tension: 0,
                    fill: true,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 300 },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(12, 17, 23, 0.95)',
                        titleColor: '#f0f2f5',
                        bodyColor: '#34d399',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        padding: 10,
                        displayColors: false,
                        callbacks: {
                            label: ctx => formatINR(ctx.parsed.y)
                        }
                    }
                },
                scales: {
                    x: {
                        display: true,
                        grid: { color: 'rgba(255,255,255,0.03)' },
                        ticks: { color: 'rgba(255,255,255,0.25)', font: { size: 10 }, maxTicksLimit: 12 }
                    },
                    y: {
                        display: true,
                        grid: { color: 'rgba(255,255,255,0.03)' },
                        ticks: {
                            color: 'rgba(255,255,255,0.25)',
                            font: { size: 10 },
                            callback: v => '₹' + v.toLocaleString('en-IN')
                        }
                    }
                }
            }
        });
    }

    function updatePriceChart() {
        if (!priceChart) return;
        const prices = priceHistory[selectedTicker] || [];
        if (prices.length === 0) return;

        if (chartMode === 'line') {
            priceChart.config.type = 'line';
            priceChart.data.labels = prices.map((_, i) => i);
            priceChart.data.datasets = [{
                label: selectedTicker,
                data: prices,
                borderColor: '#34d399',
                backgroundColor: 'rgba(52, 211, 153, 0.08)',
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4,
                tension: 0,
                fill: true,
            }];
        } else {
            // Candlestick via two overlapping bar datasets on plain Chart.js (no financial
            // plugin loaded): a thin "wick" bar spanning the true high/low, and a wider
            // "body" bar spanning open/close, per PRD Part 6.3 (high/low = max/min of group).
            const candles = toCandles(prices, 6);
            priceChart.config.type = 'bar';
            priceChart.data.labels = candles.map((_, i) => `M${i + 1}`);
            const upColor = 'rgba(52,211,153,0.9)';
            const downColor = 'rgba(248,113,113,0.9)';
            const colors = candles.map(c => c.close >= c.open ? upColor : downColor);
            priceChart.data.datasets = [
                {
                    label: `${selectedTicker} (wick)`,
                    data: candles.map(c => [c.low, c.high]),
                    backgroundColor: colors,
                    borderColor: colors,
                    borderWidth: 1,
                    borderSkipped: false,
                    barThickness: 2,
                    grouped: false,
                    order: 1,
                },
                {
                    label: selectedTicker,
                    data: candles.map(c => [Math.min(c.open, c.close), Math.max(c.open, c.close)]),
                    backgroundColor: colors,
                    borderColor: colors,
                    borderWidth: 1,
                    borderSkipped: false,
                    barPercentage: 0.6,
                    categoryPercentage: 0.8,
                    grouped: false,
                    order: 0,
                },
            ];
        }
        priceChart.update('none');
    }

    function toCandles(prices, size = 6) {
        const candles = [];
        for (let i = 0; i < prices.length; i += size) {
            const slice = prices.slice(i, i + size);
            if (slice.length === 0) continue;
            candles.push({
                open: slice[0],
                close: slice[slice.length - 1],
                high: Math.max(...slice),
                low: Math.min(...slice)
            });
        }
        return candles;
    }

    // Chart toggle
    document.querySelectorAll('.chart-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.chart-toggle-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            chartMode = btn.dataset.chart;
            updatePriceChart();
        });
    });

    // =================================================================
    // NEWS WIDGET (PRD Part 6.4)
    // =================================================================
    function pushNews(items, session, tick) {
        if (!items.length) return;
        const feed = document.getElementById('news-feed');
        // Remove empty state
        const empty = feed.querySelector('.news-empty');
        if (empty) empty.remove();

        // Bundle every headline collected since the last notification into one card
        // (PRD Part 2.1: display cadence is independent of how often headlines fire).
        const card = document.createElement('div');
        card.className = 'news-card';
        const timeStr = `Session ${session + 1} · Tick ${tick}`;
        // SECURITY: Only show bullets. Never show factor, ticker, or score.
        const allBullets = items.flatMap(n => n.bullets);
        card.innerHTML = `
            <div class="news-time">🔔 ${timeStr}</div>
            <ul>${allBullets.map(b => `<li>${b}</li>`).join('')}</ul>
        `;
        feed.prepend(card); // Newest on top
    }

    // =================================================================
    // PORTFOLIO TAB (PRD Part 6.5)
    // =================================================================
    function trackEquity(row) {
        // Calculate portfolio value
        let positionValue = 0;
        for (const tk in holdings) {
            positionValue += holdings[tk].shares * row.prices[tk];
        }
        const totalPortfolio = cash + positionValue;
        equitySeries.push(totalPortfolio);

        // Market: equal-weight index of all tickers
        const tickers = gameData.meta.tickers;
        const startPrices = gameData.meta.start_prices;
        let mktReturn = 0;
        tickers.forEach(tk => {
            mktReturn += (row.prices[tk] / startPrices[tk]);
        });
        mktReturn /= tickers.length; // average ratio
        marketSeries.push(mktReturn * START_CAPITAL); // scale to same base

        tickLabels.push(currentTick);
    }

    function refreshPortfolio() {
        if (!gameData) return;
        const row = gameData.rows[currentTick];
        if (!row) return;

        // Calculate values
        let positionValue = 0, unrealised = 0;
        for (const tk in holdings) {
            const h = holdings[tk];
            const px = row.prices[tk];
            positionValue += h.shares * px;
            unrealised += h.shares * (px - h.avgCost);
        }
        const total = cash + positionValue;
        const absReturn = ((total - START_CAPITAL) / START_CAPITAL * 100);

        // Sharpe Ratio
        const rets = pctChanges(equitySeries);
        const sharpe = rets.length > 1 ? mean(rets) / (std(rets) || 0.0001) : 0;

        // Market return
        const tickers = gameData.meta.tickers;
        const startPrices = gameData.meta.start_prices;
        let mktReturn = 0;
        tickers.forEach(tk => {
            mktReturn += (row.prices[tk] / startPrices[tk] - 1);
        });
        mktReturn = (mktReturn / tickers.length) * 100;
        const vsMarket = absReturn - mktReturn;

        // Update stat cards
        setStatValue('stat-cash', formatINR(cash), 'neutral');
        setStatValue('stat-unrealised', (unrealised >= 0 ? '+' : '') + formatINR(unrealised), unrealised >= 0 ? 'positive' : 'negative');
        setStatValue('stat-total', formatINR(total), 'neutral');
        setStatValue('stat-return', (absReturn >= 0 ? '+' : '') + absReturn.toFixed(2) + '%', absReturn >= 0 ? 'positive' : 'negative');
        setStatValue('stat-sharpe', sharpe.toFixed(3), sharpe >= 0 ? 'positive' : 'negative');
        setStatValue('stat-vsmarket', (vsMarket >= 0 ? '+' : '') + vsMarket.toFixed(2) + '%', vsMarket >= 0 ? 'positive' : 'negative');

        // Holdings table
        const holdingKeys = Object.keys(holdings);
        if (holdingKeys.length === 0) {
            document.getElementById('holdings-empty').style.display = 'block';
            document.getElementById('holdings-table-wrap').style.display = 'none';
        } else {
            document.getElementById('holdings-empty').style.display = 'none';
            document.getElementById('holdings-table-wrap').style.display = 'block';
            const tbody = document.getElementById('holdings-body');
            tbody.innerHTML = '';
            holdingKeys.forEach(tk => {
                const h = holdings[tk];
                const px = row.prices[tk];
                const pnlPct = ((px - h.avgCost) / h.avgCost * 100);
                const val = h.shares * px;
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${tk}</strong></td>
                    <td>${h.shares}</td>
                    <td>${formatINR(h.avgCost)}</td>
                    <td>${formatINR(px)}</td>
                    <td class="${pnlPct >= 0 ? 'gain-positive' : 'gain-negative'}">${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%</td>
                    <td>${formatINR(val)}</td>
                `;
                tbody.appendChild(tr);
            });
        }

        // Equity chart
        updateEquityChart();
    }

    function setStatValue(id, text, cls) {
        const el = document.getElementById(id);
        el.textContent = text;
        el.className = `stat-value ${cls}`;
    }

    // =================================================================
    // EQUITY CHART
    // =================================================================
    function initEquityChart() {
        const ctx = document.getElementById('equity-chart').getContext('2d');
        equityChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Portfolio',
                        data: [],
                        borderColor: '#f0f2f5',
                        backgroundColor: 'rgba(240, 242, 245, 0.05)',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0,
                        fill: true,
                    },
                    {
                        label: 'Market',
                        data: [],
                        borderColor: '#f87171',
                        backgroundColor: 'rgba(248, 113, 113, 0.05)',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0,
                        fill: true,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 200 },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(12, 17, 23, 0.95)',
                        titleColor: '#f0f2f5',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        padding: 10,
                        callbacks: {
                            label: ctx => ctx.dataset.label + ': ' + formatINR(ctx.parsed.y)
                        }
                    }
                },
                scales: {
                    x: {
                        display: true,
                        grid: { color: 'rgba(255,255,255,0.03)' },
                        ticks: { color: 'rgba(255,255,255,0.2)', font: { size: 10 }, maxTicksLimit: 10 }
                    },
                    y: {
                        display: true,
                        grid: { color: 'rgba(255,255,255,0.03)' },
                        ticks: {
                            color: 'rgba(255,255,255,0.2)',
                            font: { size: 10 },
                            callback: v => '₹' + (v / 1000).toFixed(0) + 'K'
                        }
                    }
                }
            }
        });
    }

    function updateEquityChart() {
        if (!equityChart) return;
        equityChart.data.labels = tickLabels.slice();
        equityChart.data.datasets[0].data = equitySeries.slice();
        equityChart.data.datasets[1].data = marketSeries.slice();
        equityChart.update('none');
    }

    // =================================================================
    // RESEARCH TAB (PRD Part 6.6)
    // =================================================================
    function renderResearch(filter = '') {
        if (!gameData) return;
        const tbody = document.getElementById('research-body');
        tbody.innerHTML = '';
        const row = gameData.rows[currentTick] || gameData.rows[0];
        const universe = gameData.universe.filter(u => {
            if (!filter) return true;
            return u.ticker.toLowerCase().includes(filter) || u.company.toLowerCase().includes(filter);
        });

        universe.forEach(u => {
            const px = row ? row.prices[u.ticker] : u.start_price;
            const change = ((px - u.start_price) / u.start_price * 100);
            const isUp = change >= 0;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${u.ticker}</strong></td>
                <td style="color:var(--text-secondary)">${u.company}</td>
                <td>${formatINR(px)}</td>
                <td class="${isUp ? 'gain-positive' : 'gain-negative'}">${isUp ? '+' : ''}${change.toFixed(2)}%</td>
                <td>${u.type}</td>
                <td><button class="resdoc-btn" data-ticker="${u.ticker}">View Research</button></td>
            `;
            tbody.appendChild(tr);
        });

        // Attach modal handlers
        tbody.querySelectorAll('.resdoc-btn').forEach(btn => {
            btn.addEventListener('click', () => openResearchModal(btn.dataset.ticker));
        });
    }

    document.getElementById('research-search').addEventListener('input', e => {
        renderResearch(e.target.value.trim().toLowerCase());
    });

    // Research Modal
    function openResearchModal(ticker) {
        const u = gameData.universe.find(u => u.ticker === ticker);
        if (!u) return;
        document.getElementById('modal-title').textContent = `${u.ticker} — ${u.company}`;

        // Parse the research string to show sensitivities beautifully
        const research = u.research;
        let bodyHTML = `<p style="margin-bottom:16px;color:var(--text-primary);font-weight:600;">${u.company}</p>`;
        bodyHTML += `<p style="margin-bottom:8px;">Start Price: <strong>${formatINR(u.start_price)}</strong> · Type: <strong>${u.type}</strong></p>`;

        // Extract sensitivities
        const sensMatch = research.match(/sensitivities:\s*(.+)/);
        if (sensMatch) {
            bodyHTML += `<p style="margin-top:16px;margin-bottom:10px;font-weight:600;color:var(--text-primary);">Factor Sensitivities:</p>`;
            const parts = sensMatch[1].split(',').map(s => s.trim());
            parts.forEach(p => {
                const m = p.match(/(\w+)\s+([+-][\d.]+)/);
                if (m) {
                    const isPos = m[2].startsWith('+');
                    bodyHTML += `<span class="sensitivity-tag ${isPos ? 'positive' : 'negative'}">${m[1]} ${m[2]}</span>`;
                }
            });
        }

        bodyHTML += `<p style="margin-top:20px;color:var(--text-muted);font-size:0.8rem;">Use these sensitivities to match news headlines to this stock's likely price movement.</p>`;

        document.getElementById('modal-body').innerHTML = bodyHTML;
        document.getElementById('research-modal').classList.add('show');
    }

    document.getElementById('modal-close').addEventListener('click', () => {
        document.getElementById('research-modal').classList.remove('show');
    });
    document.getElementById('research-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) e.currentTarget.classList.remove('show');
    });

