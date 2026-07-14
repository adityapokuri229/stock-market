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
    let audioCtx = null; // lazily created/resumed on first user gesture (browser autoplay policy)

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
    let selectedTicker = null;
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

    // Browsers block audio until a user gesture -- unlock/create the shared
    // AudioContext on the very first click or keypress anywhere on the page.
    function unlockAudio() {
        if (audioCtx) return;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        audioCtx = new Ctx();
        if (audioCtx.state === 'suspended') audioCtx.resume();
    }
    document.addEventListener('click', unlockAudio, { once: true });
    document.addEventListener('keydown', unlockAudio, { once: true });

    // A short two-note chime for news drops, synthesized with the Web Audio API
    // so no external audio file is needed.
    function playNewsSound() {
        if (!audioCtx) return;
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const notes = [880, 1174.66]; // A5, then D6 -- a bright "attention" chime
        const startAt = audioCtx.currentTime;
        notes.forEach((freq, i) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            const noteStart = startAt + i * 0.11;
            gain.gain.setValueAtTime(0, noteStart);
            gain.gain.linearRampToValueAtTime(0.18, noteStart + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.25);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(noteStart);
            osc.stop(noteStart + 0.26);
        });
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
            const resp = await fetch('game_data_public.json');
            gameData = await resp.json();
            // Initialize price history arrays
            gameData.meta.tickers.forEach(tk => { priceHistory[tk] = []; });
            selectedTicker = gameData.meta.tickers[0];
            const tickerLabel = document.getElementById('chart-ticker-label');
            if (tickerLabel) tickerLabel.textContent = selectedTicker;
            // ticks_per_session includes one extra tick for the countdown's exact
            // 20:00 -> 0:00 display; the "total ticks" the players see is the
            // conceptual 1200, i.e. ticks_per_session - 1.
            const totalTicksEl = document.getElementById('timer-tick-total');
            if (totalTicksEl) totalTicksEl.textContent = gameData.meta.ticks_per_session - 1;
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
    const LOGIN_COOKIE_DAYS = 1;

    function setCookie(name, value, days) {
        const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
        document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
    }
    function getCookie(name) {
        const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
        return match ? decodeURIComponent(match[1]) : null;
    }
    function clearLoginCookies() {
        document.cookie = 'chakravyuh_team=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/';
        document.cookie = 'chakravyuh_pass=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/';
    }

    document.getElementById('login-btn').addEventListener('click', handleLogin);
    document.getElementById('team-password').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
    document.getElementById('team-name').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });

    // Re-log the team in automatically after a refresh instead of making them
    // type credentials again -- window.firebaseGlue is set up by a deferred
    // module script, so wait for DOMContentLoaded (which always runs after it)
    // rather than attempting this at plain top-level script execution.
    window.addEventListener('DOMContentLoaded', () => {
        initResizer();
        const savedTeam = getCookie('chakravyuh_team');
        const savedPass = getCookie('chakravyuh_pass');
        if (savedTeam && savedPass) {
            document.getElementById('team-name').value = savedTeam;
            document.getElementById('team-password').value = savedPass;
            handleLogin();
        }
    });

    function initResizer() {
        const resizer = document.getElementById('trade-resizer');
        const leftSide = document.querySelector('.trade-left');
        const rightSide = document.querySelector('.news-widget');
        if (!resizer || !leftSide || !rightSide) return;

        let x = 0;
        let leftWidth = 0;
        let rightWidth = 0;

        const mouseDownHandler = function(e) {
            x = e.clientX;
            leftWidth = leftSide.getBoundingClientRect().width;
            rightWidth = rightSide.getBoundingClientRect().width;
            resizer.classList.add('dragging');

            document.addEventListener('mousemove', mouseMoveHandler);
            document.addEventListener('mouseup', mouseUpHandler);
            e.preventDefault();
        };

        const mouseMoveHandler = function(e) {
            const dx = e.clientX - x;
            const newRightWidth = rightWidth - dx;
            if (newRightWidth >= 250 && newRightWidth <= 800) {
                rightSide.style.width = `${newRightWidth}px`;
            }
        };

        const mouseUpHandler = function() {
            resizer.classList.remove('dragging');
            document.removeEventListener('mousemove', mouseMoveHandler);
            document.removeEventListener('mouseup', mouseUpHandler);
        };

        resizer.addEventListener('mousedown', mouseDownHandler);
    }

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
            clearLoginCookies(); // in case a stale/bad saved cookie caused this
            return;
        }

        // Remember this login so a refresh doesn't require re-entering it.
        setCookie('chakravyuh_team', team, LOGIN_COOKIE_DAYS);
        setCookie('chakravyuh_pass', pass, LOGIN_COOKIE_DAYS);

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
        updateTradeCashDisplay();

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
            orders: orderHistory,
            equity_curve: equitySeries
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

        // Update Owned preview (sign-aware: shows "LONG 10" or "SHORT 5")
        const ownedSpan = document.getElementById('order-shares-owned');
        if (ownedSpan) {
            const h = holdings[selectedTicker];
            if (!h || h.shares === 0) {
                ownedSpan.textContent = 'Owned: 0';
                ownedSpan.style.color = '';
            } else if (h.shares > 0) {
                ownedSpan.textContent = `LONG ${h.shares}`;
                ownedSpan.style.color = '#34d399';
            } else {
                ownedSpan.textContent = `SHORT ${Math.abs(h.shares)}`;
                ownedSpan.style.color = '#f87171';
            }
        }
    }

    document.getElementById('order-quantity').addEventListener('input', updateCurrentPrice);

    // =================================================================
    // TRADING LOGIC (PRD Part 6.2) — with short selling
    // =================================================================
    document.getElementById('btn-confirm').addEventListener('click', confirmOrder);
    document.getElementById('btn-clear').addEventListener('click', () => {
        document.getElementById('order-quantity').value = '';
        document.getElementById('order-error').style.display = 'none';
        document.getElementById('order-info').style.display = 'none';
        updateCurrentPrice();
    });

    // Sign-aware position update: used by BUY (+qty) and SELL (-qty).
    // Handles extending, reducing, and crossing through zero.
    function updatePositionOnTrade(h, signedQty, price) {
        if (h.shares === 0 || Math.sign(signedQty) === Math.sign(h.shares)) {
            // Extending a position (or first entry): weighted-average entry price
            h.avgCost = (Math.abs(h.shares) * h.avgCost + Math.abs(signedQty) * price)
                        / (Math.abs(h.shares) + Math.abs(signedQty));
            h.shares += signedQty;
        } else if (Math.abs(signedQty) <= Math.abs(h.shares)) {
            // Partial/full close: entry price unchanged
            h.shares += signedQty;
        } else {
            // Crossed zero: remainder is a NEW position at trade price
            h.shares += signedQty;
            h.avgCost = price;
        }
    }

    // Short cap: total short exposure (market value of all negative positions)
    // may not exceed total portfolio value (cash + net position value).
    function canShort(addQty, price) {
        const row = gameData.rows[currentTick];
        let shortVal = addQty * price, posVal = 0;
        for (const tk in holdings) {
            const v = holdings[tk].shares * row.prices[tk];
            posVal += v;
            if (v < 0) shortVal += -v;
        }
        return shortVal <= cash + posVal;
    }

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

        if (side === 'BUY') {
            // BUY: covers shorts first (FIFO), then opens/extends a long.
            // Cash check: buying to cover a short doesn't cost cash (it reduces
            // the short obligation), but buying beyond the short does.
            const h = holdings[ticker] || { shares: 0, avgCost: 0 };
            const coverQty = (h.shares < 0) ? Math.min(qty, Math.abs(h.shares)) : 0;
            const newLongQty = qty - coverQty;
            const cashNeeded = newLongQty * price;
            if (cashNeeded > cash) {
                errEl.textContent = `Insufficient cash. Need ${formatINR(cashNeeded)}, have ${formatINR(cash)}`;
                errEl.style.display = 'block';
                return;
            }
            infoEl.textContent = `✅ Bought ${qty} ${ticker} @ ${formatINR(price)} = ${formatINR(price * qty)}`;
            if (coverQty > 0) {
                showToast(`Covered ${coverQty} short + bought ${newLongQty} ${ticker} @ ${formatINR(price)}`);
            } else {
                showToast(`Bought ${qty} ${ticker} @ ${formatINR(price)}`);
            }
        } else {
            // SELL: reduces longs, then opens/extends a short.
            const held = holdings[ticker] ? holdings[ticker].shares : 0;
            const newShort = Math.max(qty - Math.max(held, 0), 0);
            if (newShort > 0 && !canShort(newShort, price)) {
                errEl.textContent = 'Short cap: total short exposure cannot exceed portfolio value';
                errEl.style.display = 'block';
                return;
            }
            const proceeds = price * qty;
            const label = newShort > 0 ? `Sold SHORT ${newShort}` : `Sold ${qty}`;
            infoEl.textContent = `✅ ${label} ${ticker} @ ${formatINR(price)} = ${formatINR(proceeds)}`;
            showToast(`${label} ${ticker} @ ${formatINR(price)}`, newShort > 0 ? 'warning' : 'info');
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
        const sessionLength = gameData.meta.ticks_per_session;
        let currentSession = 0;

        for (const o of sorted) {
            const oSession = Math.floor(o.tick / sessionLength);
            if (oSession > currentSession) {
                const lastRowPriceIdx = (currentSession + 1) * sessionLength - 1;
                const lastRowPrices = gameData.rows[lastRowPriceIdx].prices;
                for (const tk in newHoldings) {
                    newCash += newHoldings[tk].shares * lastRowPrices[tk];
                }
                newCash = START_CAPITAL;
                for (const tk in newHoldings) delete newHoldings[tk];
                currentSession = oSession;
            }

            const dir = o.side === 'BUY' ? 1 : -1;
            newCash -= dir * o.price * o.qty;
            const h = newHoldings[o.ticker] || { shares: 0, avgCost: 0 };
            updatePositionOnTrade(h, dir * o.qty, o.price);
            if (h.shares === 0) delete newHoldings[o.ticker];
            else newHoldings[o.ticker] = h;
        }

        cash = newCash;
        for (const tk in holdings) delete holdings[tk];
        Object.assign(holdings, newHoldings);
        orderHistory.length = 0;
        orderHistory.push(...sorted);

        updateCurrentPrice();
        updateTradeCashDisplay();
        if (document.getElementById('tab-portfolio').classList.contains('active')) {
            refreshPortfolio();
        }
    }

    // Keeps the Trade tab's cash figure visible at all times (not just when the
    // Portfolio tab is active, unlike the other stat cards).
    function updateTradeCashDisplay() {
        const el = document.getElementById('trade-cash-value');
        if (el) el.textContent = formatINR(cash);
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

        let pointCount;
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
            pointCount = prices.length;
        } else {
            // Candlestick via two overlapping bar datasets on plain Chart.js (no financial
            // plugin loaded): a thin "wick" bar spanning the true high/low, and a wider
            // "body" bar spanning open/close, per PRD Part 6.3 (high/low = max/min of group).
            const candles = toCandles(prices, 10);
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
            pointCount = candles.length;
        }
        priceChart.update('none');

        // Keep a constant pixel-width per point/candle instead of squeezing more
        // and more history into a fixed-width canvas -- the container scrolls
        // horizontally to reveal earlier prices, auto-snapped to the latest tick
        // on the right unless the user has scrolled left to review history.
        const scrollEl = document.getElementById('price-chart-scroll');
        const innerEl = document.getElementById('price-chart-inner');
        if (scrollEl && innerEl) {
            const pxPerPoint = chartMode === 'line' ? 15 : 45;
            const desiredWidth = Math.max(scrollEl.clientWidth, pointCount * pxPerPoint);
            const wasNearRightEdge = scrollEl.scrollWidth - scrollEl.scrollLeft - scrollEl.clientWidth < 40;
            innerEl.style.width = desiredWidth + 'px';
            priceChart.resize();
            if (wasNearRightEdge) scrollEl.scrollLeft = scrollEl.scrollWidth;
        }
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

        // Alert the player a headline just dropped -- sound + a small popup,
        // separate from the full card below, in case they aren't looking at
        // the news feed when it fires.
        playNewsSound();
        showToast('📰 News just dropped — check the feed!', 'news');

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

        // Holdings table (sign-aware: shorts show as red badge)
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
                const isShort = h.shares < 0;
                // P&L: for longs (px - avg)/avg, for shorts (avg - px)/avg
                const pnlPct = isShort
                    ? ((h.avgCost - px) / h.avgCost * 100)
                    : ((px - h.avgCost) / h.avgCost * 100);
                const val = h.shares * px; // negative for shorts
                const sharesDisplay = isShort
                    ? `<span style="color:#f87171;font-weight:600;">SHORT ${Math.abs(h.shares)}</span>`
                    : `${h.shares}`;
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${tk}</strong></td>
                    <td>${sharesDisplay}</td>
                    <td>${formatINR(h.avgCost)}</td>
                    <td>${formatINR(px)}</td>
                    <td class="${pnlPct >= 0 ? 'gain-positive' : 'gain-negative'}">${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%</td>
                    <td>${formatINR(Math.abs(val))}</td>
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

    const businessDescriptions = [
        { key: 'TSMC', text: 'Taiwan Semiconductor Manufacturing Company Limited, together with its subsidiaries, manufactures, packages, tests, and sells integrated circuits and other semiconductor devices in Taiwan, China, Europe, the Middle East, Africa, Japan, the United States, and internationally. It provides various wafer fabrication processes, such as processes to manufacture complementary metal- oxide-semiconductor (CMOS) logic, mixed-signal, radio frequency, embedded memory, bipolar CMOS mixed-signal, and others. The company also involved in providing customer and engineering support services; manufacturing of masks; investment in technology start-up companies; research, designing, developing, manufacturing, packaging, testing, and sale of color filters; and investment activities. Its products are used in high performance computing, smartphones, Internet of things, automotive, and digital consumer electronics. Taiwan Semiconductor Manufacturing Company Limited was incorporated in 1987 and is headquartered in Hsinchu City, Taiwan.' },
        { key: 'Ferrari', text: 'Ferrari N.V., through its subsidiaries, engages in design, engineering, production, and sale of luxury performance sports cars worldwide. It offers sports, track, one-off, and road cars, as well as supercars. The company also provides spare parts and engines, as well as after sales, repair, maintenance, and restoration services for cars; and licenses its Ferrari brand to various producers and retailers of luxury and lifestyle goods. In addition, it operates Ferrari museums in Modena and Maranello; Il Cavallino restaurant in Maranello; and theme parks in Abu Dhabi and Spain. Further, the company provides direct or indirect finance and leasing services; range of financial and ancillary services; special financing arrangements; and operates franchised and owned Ferrari stores. The company was founded in 1947 and is headquartered in Maranello, Italy.' },
        { key: 'Lockheed Martin', text: 'Lockheed Martin Corporation, an aerospace and defense company, engages in the research, design, development, manufacture, integration, and sustainment of technology systems, products, and services in the United States, Europe, Asia, the Middle East, and internationally. The company operates through four segments: Aeronautics; Missiles and Fire Control (MFC); Rotary and Mission Systems (RMS); and Space. The Aeronautics segment offers combat and air mobility aircraft, unmanned air vehicles, and related technologies. The MFC segment provides air and missile defense systems; tactical missiles and precision strike weapon systems; logistics; fire control systems; mission operations support, readiness, engineering support, and integration services; and ground vehicles. The RMS segment offers military and commercial helicopters, surface ships, sea- and land-based missile defense systems, radar and laser systems, sea- and air-based mission and combat systems, command and control mission solutions, cyber solutions, simulation and training solutions, and services and support for surface ships. The Space segment provides satellites; space transportation systems; strategic, advanced strike, and defensive systems; and classified systems and services in support of national security systems. This segment also provides network-enabled situational awareness; and integrates space and ground global systems to help its customers gather, analyze, and securely distribute critical intelligence data. It primarily serves the U.S. government and international customers, as well as foreign military sales contracted through the U.S. government. The company was formerly known as The Lockheed Corporation and changed its name to Lockheed Martin Corporation in March 1995. Lockheed Martin Corporation was founded in 1912 and is based in Bethesda, Maryland.' },
        { key: 'HDFC', text: 'HDFC Bank Limited provides banking and financial products and services to individuals and businesses in India, Bahrain, Hong Kong, Singapore, and Dubai. The company operates through Treasury, Retail Banking, Wholesale Banking, Other Banking Business, Insurance Business, and Other segments. It offers savings, salary, current, rural, public provident fund, pension, and demat accounts; fixed and recurring deposits; and safe deposit lockers, as well as offshore accounts and deposits, and overdrafts against fixed deposits. The company also provides personal, home, car and pre owned car, marriage, two-wheeler, business, doctor, educational, gold, consumer, and rural loans; loans against properties, securities, mutual funds, and car; loans for professionals; government sponsored programs; and loans on credit card, as well as working capital, term loans, supply chain management, project finance, export finance, commercial vehicle / equipment finance, tractor finance, infrastructure, and agriculture finance. In addition, it offers credit, debit, prepaid, forex, and kisan gold cards; payment and collection, export, import, remittance, bank guarantee, letter of credit, trade, hedging, and merchant and cash management services; and insurance and investment products. Further, the company provides short term finance, bill discounting, structured finance, export credit, loan repayment, custodial, and documents collection services; online, mobile, and phone banking services; unified payment interface, immediate payment, national electronic funds transfer, and real time gross settlement services; channel financing, vendor financing, money market, derivatives, employee trusts, cash surplus corporates, tax payment, and bankers to rights/public issue services; and financial solutions for supply chain partners and agricultural customers. It operates branches and automated teller machines in various cities/towns. The company was incorporated in 1994 and is headquartered in Mumbai, India.' },
        { key: 'Pfizer', text: 'Pfizer Inc. discovers, develops, manufactures, markets, distributes, and sells biopharmaceutical products in the United States and internationally. It operates in three segments: Biopharma, PC1, and Pfizer Ignite. The company offers internal medicine products, including cardiovascular metabolic diseases products under the Eliquis brand; migraine products under the Nurtec ODT/Vydura and Zavzpret brand; vaccines under the Prevnar family, Abrysvo, Nimenrix, FSME/IMMUN-TicoVac, and Trumenba brands; and Paxlovid for the treatment of COVID-19. It also provides inflammation and immunology products, such as Xeljanz, Enbrel, Cibinqo, Litfulo, Eucrisa, and Velsipity; rare disease products for therapeutic areas comprising amyloidosis, hemophilia, and endocrine diseases under the Vyndaqel family, Genotropin, BeneFIX, Xyntha, Somavert, Ngenla, and Hympavzi brands; and anti-infective and immunoglobulin medicines under the Zavicefta, Octagam, and Panzyga brands. In addition, the company offers oncology products comprising ADCs, small molecules, bispecific, and other immunotherapies for the treatment of cancers, including breast cancer, genitourinary cancer, and hematologic malignancies, as well as melanoma, gastrointestinal, gynecological, and lung cancer under the Ibrance, Xtandi, Padcev, Adcetris, Inlyta, Lorbrena, Bosulif, Tukysa, Braftovi, Mektovi, Orgovyx, Elrexfio, Tivdak, and Talzenna brands. Further, it provides biosimilars under the Inflectra brand; oncology biosimilars comprising Retacrit, Ruxience, Zirabev, Trazimera and Nivestym, and other biosimilars; and sterile injectables, such as Sulperazon, Atgam, Fragmin, Solu Medrol, Solu Cortef, and Bicillin. The company has collaboration agreements with Bristol-Myers Squibb Company; Astellas Pharma US, Inc.; Merck KGaA; and BioNTech SE, as well as a strategic collaboration with Boltz, PBC to develop and deploy biomolecular AI foundation models. Pfizer Inc. was founded in 1849 and is headquartered in New York, New York.' },
        { key: 'Reliance', text: 'Reliance Industries Limited engages in hydrocarbon exploration and production, petroleum refining and marketing, petrochemicals, advanced materials and composites, renewable, financial services, retail, and digital services worldwide. It operates through the Oil to Chemicals, Oil and Gas, Retail, Digital Services, and Others segments. The company is involved in refining and marketing products, including liquefied petroleum gas, propylene, naphtha, gasoline, jet/aviation turbine fuel, kerosine oil, diesel, sulfur, and petroleum coke. It also provides polymers comprising high-density and low-density polyethylene (PE), linear low-density PE, homopolymer, random and impact copolymer, and polyvinyl chloride; fiber intermediates that include purified terephthalic acid, and ethylene glycols and oxide; aromatics, such as paraxylene, ortho xylene, benzene, and linear alkyl benzene and paraffin; and textiles that consist of fabrics, apparel, and auto furnishings. In addition, the company offers elastomers, such as polybutadiene rubber, styrene butadiene rubber, and butyl rubber; fiber and yarn polyesters; and bioenergy solutions, including compressed biogas, and pellets and briquettes. Further, it engages in oil and gas exploration and production activities; operation of various stores comprising supermarkets, hypermarket, wholesale cash and carry, specialty, and online stores; operation of media and entertainment platforms, and Network18 and television channels; and publishing of magazines. Additionally, the company provides highway hospitality and fleet management services, as well as digital services, such as connectivity, fiber, mobile devices, apps, business, and other digital solutions. Reliance Industries Limited was founded in 1957 and is based in Mumbai, India.' },
        { key: 'Draft Kings', text: 'DraftKings Inc. operates as a digital sports entertainment and gaming company in the United States and internationally. The company offers online and retail sports betting, daily fantasy sports, digital lottery couriers, prediction markets, and other products, as well as retails sportsbooks. It also provides iGaming, or online casino products, which includes blackjack, roulette, baccarat and slot machines. In addition, the company engages in the design and development of sports betting and casino gaming software for online and retail sportsbooks, and iGaming operators. DraftKings Inc. was founded in 2011 and is headquartered in Boston, Massachusetts.' },
        { key: 'SpaceX', text: 'Space Exploration Technologies Corp. provides satellite-based broadband services in the United States, Ireland, Canada, and internationally. The company\'s Connectivity segment operates a high-speed, low-latency broadband network powered by various Starlink satellites in low-earth orbit, delivering connectivity to various consumer, enterprise, and government customers through its Starlink offering. Its Space segment designs, manufactures, and launches reusable rockets to provide access to space. It offers launch services for the deployment of payloads to intended orbits for commercial and government customers utilizing Falcon 9 and Falcon Heavy; and launch and development for the development of spacecraft and the provision of launch and mission services for government agency space programs utilizing Falcon 9, Falcon Heavy, Starship, and Dragon. The company\'s AI segment operates a vertically integrated AI platform spanning a frontier LLM Grok; AI solutions for consumer and enterprise customers; X, a real-time information, entertainment, and free speech platform; and AI computational infrastructure. The company was founded in 2002 and is based in Starbase, Texas.' },
        { key: 'Samsung', text: 'Samsung Electronics Co., Ltd. engages in the consumer electronics, information technology and mobile communications, and device solutions businesses worldwide. The company operates through four divisions: Device eXperience (DX), Device Solutions (DS), SDC, and Harman. The company offers smartphones, tablets, audio sounds, watches, switches, and accessories; TVs, and sound devices; appliances, including refrigerators, washing machines and dryers, vacuum cleaners, cooking appliances, dishwashers, air conditioners, and air purifiers; monitors and memory storage products; displays, and smart and LED signages; and other accessories. It also engages in venture capital investments, cloud services, network devices installation, semiconductor equipment services, digital advertising platforms, marketing, consulting, connected services provider, logistics, financing, and software design activities. In addition, the company provides toll processing and sales of semiconductors and display panels; development and sale of network solutions; manufacture of semiconductors and food; the provision of repair services for electronic devices; and development and supply of semiconductor process defect and quality control software, as well as digital televisions, foundry, system large scale integration (LSI). Further, it provides connected car systems, audio and visual products, enterprise automation solutions, and connected services. Samsung Electronics Co., Ltd. was incorporated in 1969 and is based in Suwon-si, South Korea.' }
    ];

    // Research Modal
    function openResearchModal(ticker) {
        const u = gameData.universe.find(u => u.ticker === ticker);
        if (!u) return;
        document.getElementById('modal-title').textContent = `${u.ticker} — ${u.company}`;

        // Match business description
        let desc = "No business description available for this instrument.";
        for (let b of businessDescriptions) {
            if (u.company.toLowerCase().includes(b.key.toLowerCase()) || u.ticker.toLowerCase().includes(b.key.toLowerCase())) {
                desc = b.text;
                break;
            }
        }

        // SECURITY: factor sensitivities are judge/scoring-only data and must
        // never be shown to contestants -- only company/price/type here.
        let bodyHTML = `<p style="margin-bottom:16px;color:var(--text-primary);font-weight:600;">${u.company}</p>`;
        bodyHTML += `<p style="margin-bottom:8px;">Start Price: <strong>${formatINR(u.start_price)}</strong> · Type: <strong>${u.type}</strong></p>`;
        if (u.type && u.type.toLowerCase() === 'stock') {
            bodyHTML += `<div style="margin-top:20px; padding:15px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); border-radius:8px; font-size:0.9rem; line-height:1.5; color:var(--text-secondary);">${desc}</div>`;
        }
        bodyHTML += `<p style="margin-top:20px;color:var(--text-muted);font-size:0.8rem;">Use news headlines to judge this stock's likely price movement.</p>`;

        document.getElementById('modal-body').innerHTML = bodyHTML;
        document.getElementById('research-modal').classList.add('show');
    }

    document.getElementById('modal-close').addEventListener('click', () => {
        document.getElementById('research-modal').classList.remove('show');
    });
    document.getElementById('research-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) e.currentTarget.classList.remove('show');
    });

