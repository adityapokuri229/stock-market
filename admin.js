import { watchGame, watchGameState, setGameState, addTeam, watchTeams, resetGame, now } from './firebase-glue.js';

const ADMIN_PASSWORD = "judge123";

let gameData = null;
let betas = null;
const cache = {}; // team -> { subscores, flags, orders, rep }

let currentScope = "both";
let weights = { R: 45, D: 25, H: 30 };
let dirtyTeams = new Set();
let isLive = false;
let teamCredentials = {}; // team -> {password, startingCapital} | legacy password string
const DEFAULT_STARTING_CAPITAL = 1_000_000;

// Short display labels for the radar chart, one per window.scoring.FACTORS entry (same order).
const RADAR_FACTOR_LABELS = ["Rates", "RegRisk", "Oil", "Inflation", "Geopolitics", "Semis", "ConsDisc", "InvConf", "TechDev", "Aero", "Health"];

// A team's configured starting capital, falling back to the default for teams
// registered before this field existed (or before watchTeams has loaded).
function getTeamK0(team) {
    const cred = teamCredentials[team];
    const capital = (cred && typeof cred === 'object') ? cred.startingCapital : null;
    return (typeof capital === 'number' && capital > 0) ? capital : DEFAULT_STARTING_CAPITAL;
}

// DOM Elements
const loginOverlay = document.getElementById("admin-login-overlay");
const adminApp = document.getElementById("admin-app");
const loginBtn = document.getElementById("admin-login-btn");
const passInput = document.getElementById("admin-password");
const loginError = document.getElementById("admin-login-error");
const resetBtn = document.getElementById("btn-reset-everything");

const scopeSelect = document.getElementById("scope-select");
const weightR = document.getElementById("weight-r");
const weightD = document.getElementById("weight-d");
const weightH = document.getElementById("weight-h");
const valR = document.getElementById("val-r");
const valD = document.getElementById("val-d");
const valH = document.getElementById("val-h");

const startEventBtn = document.getElementById("btn-start-event");

const liveStatus = document.getElementById("live-status");
const offlineBtn = document.getElementById("offline-load-btn");
const offlineFile = document.getElementById("offline-file");
const exportCsvBtn = document.getElementById("export-csv-btn");

const leaderboardBody = document.getElementById("leaderboard-body");
const drillDownContainer = document.getElementById("drill-down-container");
const drillTeamName = document.getElementById("drill-team-name");
const drillBlotterBody = document.getElementById("drill-blotter-body");

let equityChart = null;
let radarChart = null;

// ==========================================
// Initialization & Login
// ==========================================
loginBtn.addEventListener("click", () => {
    if (passInput.value === ADMIN_PASSWORD) {
        loginOverlay.style.display = "none";
        adminApp.style.display = "block";
        initAdmin();
    } else {
        loginError.style.display = "block";
    }
});
passInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") loginBtn.click();
});

async function initAdmin() {
    try {
        const res = await fetch("game_data.json");
        gameData = await res.json();
        betas = window.scoring.parseBetas(gameData);
        
        setupListeners();
        setupCharts();

        // Drives the Portfolio Building countdown / live round clock every second
        // from the shared anchor -- runs immediately so a refreshed panel shows
        // the correct display before the first watchGameState update even lands.
        setInterval(tickLiveDisplays, 1000);

        // Authoritative game/status -- source of truth for button states and the
        // live clock (not just what this panel itself last wrote), so refreshing
        // this panel mid-event re-syncs instead of resetting to "Start Event".
        watchGameState((status) => {
            if (!status) return;
            const prevState = liveState;
            liveState = status.state || 'waiting';
            liveSession = status.currentSession || 0;
            livePhaseStartedAt = status.phaseStartedAt || 0;
            livePausedAccumMs = status.pausedAccumMs || 0;
            livePausedAt = (status.pausedAt != null) ? status.pausedAt : null;

            if (liveState === 'portfolio_building' && prevState !== 'portfolio_building') {
                portfolioBuildPrompted = false; // fresh phase -- allow the popup again
            }

            reconcileControlButtons();
            tickLiveDisplays();
        });

        // Try Firebase live connection
        watchGame((teamsData, err) => {
            if (err) {
                setOffline();
                return;
            }
            if (!teamsData) return;
            
            isLive = true;
            let count = 0;
            for (const [team, node] of Object.entries(teamsData)) {
                count++;
                if (!cache[team]) {
                    dirtyTeams.add(team);
                } else {
                    const latestOrders = node.orders ? Object.values(node.orders) : [];
                    if (cache[team].orders.length !== latestOrders.length) {
                        dirtyTeams.add(team);
                    }
                }
                
                // Store raw data to be processed by throttle
                if (!cache[team]) cache[team] = { orders: [] };
                
                // Convert orders object to array and sort by tick
                if (node.orders) {
                    const ordArray = Object.values(node.orders);
                    ordArray.sort((a,b) => a.tick - b.tick);
                    cache[team].rawOrders = ordArray;
                } else {
                    cache[team].rawOrders = [];
                }
            }
            liveStatus.textContent = `● LIVE — ${count} teams`;
            liveStatus.className = "status-pill live";
        });
        
        // 2-second throttle loop for processing dirty teams
        setInterval(() => {
            if (dirtyTeams.size > 0) {
                for (const team of dirtyTeams) {
                    processTeamData(team);
                }
                dirtyTeams.clear();
                renderLeaderboard();
            }
        }, 2000);
        
    } catch (e) {
        console.error("Failed to load game_data.json", e);
        alert("Could not load game_data.json. Are you running a local server?");
    }
}

// ==========================================
// Processing
// ==========================================
// The furthest tick that has actually elapsed in real time across the whole
// game -- caps scoring so a team's Return/Hit-Rate can never reflect price
// movement that hasn't happened yet (e.g. trades placed during Portfolio
// Building, before Round 1's clock has even started). Tick 0 (start prices) is
// always fair game since those are public from the moment the event opens; the
// full board is fair game once the judge has ended the event.
function liveGlobalTickCap() {
    if (liveState === 'ended') return Infinity;
    if (!gameData || (liveState !== 'playing' && liveState !== 'paused')) return 0;
    const ticksPerSession = gameData.meta.ticks_per_session;
    const tickSeconds = gameData.meta.tick_seconds;
    const elapsedSec = Math.max(0, Math.floor(elapsedPlayingMs() / 1000));
    const tickInSession = Math.min(ticksPerSession - 1, Math.floor(elapsedSec / tickSeconds));
    return liveSession * ticksPerSession + tickInSession;
}

function processTeamData(team) {
    const orders = cache[team].rawOrders || [];
    cache[team].orders = orders;

    // Parse scope parameter for replay
    let scopeParam = "both";
    if (currentScope === "0") scopeParam = 0;
    if (currentScope === "1") scopeParam = 1;

    // 1. Replay canonical prices
    const K0 = getTeamK0(team);
    const rep = window.scoring.replay(orders, gameData, scopeParam, K0, liveGlobalTickCap());
    cache[team].rep = rep;

    // 2. Subscore calculation
    const sub = {};
    
    // Return
    const sr = window.scoring.scoreReturn(rep.V, K0);
    sub.sR = sr.sR;
    sub.rawR = sr.r;
    
    // Diversification
    // Convert rows into a dictionary keyed by the GLOBAL tick index (array position),
    // NOT the row's own `tick` field -- that field resets to 0 at the session-2
    // boundary (row.session/row.tick), while order.tick (stamped from app.js's
    // currentTick) is the global 0..239 index. Keying by row.tick would silently
    // drop every session-2 order and mis-price every session-1 order.
    const rowsByTick = {};
    gameData.rows.forEach((r, idx) => rowsByTick[idx] = r);

    const d1 = window.scoring.effectiveRank(rep.orders, betas, rowsByTick, K0);
    sub.dRank = d1.dRank;
    sub.rawRank = d1.Reff;

    // Neutrality: real per-tick holding weights, now returned by replay().
    const d2 = window.scoring.neutrality(rep.holdingsByTick, betas);
    sub.dNeut = d2.dNeut;
    sub.rawNeut = d2.nu;
    
    // Hit Rate
    const hr = window.scoring.scoreHitRate(rep.trips, K0);
    sub.sH = hr.sH;
    sub.rawHits = hr.hits;
    sub.rawTrips = hr.nTr;
    
    cache[team].subscores = sub;
}

// ==========================================
// UI & Interaction
// ==========================================
const btnPauseEvent = document.getElementById("btn-pause-event");
const btnStartRound2 = document.getElementById("btn-start-round-2");
const btnEndRound2 = document.getElementById("btn-end-round-2");
const btnStartRound1 = document.getElementById("btn-start-round-1");
const portfolioBuildTimer = document.getElementById("portfolio-build-timer");
const liveGameClock = document.getElementById("live-game-clock");
const PORTFOLIO_BUILD_DURATION_SEC = 5 * 60; // 5 minutes

// The authoritative game/status fields, kept in sync via watchGameState (not just
// written by this panel) -- so refreshing the judge's own browser mid-game re-syncs
// button states and the live clock instead of resetting them, same as team clients.
let liveState = 'waiting';
let liveSession = 0;
let livePhaseStartedAt = 0;
let livePausedAccumMs = 0;
let livePausedAt = null;
let portfolioBuildPrompted = false; // guards the one-time "5 minutes are up" popup

// Every game/status write goes through here so the anchor fields are always
// included consistently -- this is what all teams AND this panel derive the
// live tick/countdown from, so refreshing any browser just re-derives the same
// answer instead of resetting to square one.
function writeGameState(state, session, extra = {}) {
    return setGameState({
        state, currentSession: session,
        phaseStartedAt: livePhaseStartedAt, pausedAccumMs: livePausedAccumMs, pausedAt: null,
        ...extra
    });
}

function startRound1() {
    writeGameState('playing', 0, { phaseStartedAt: now(), pausedAccumMs: 0 })
        .catch(err => alert('Failed to start Round 1: ' + err.message));
}

// Real elapsed "in-round" ms for the current session, net of any time spent paused.
function elapsedPlayingMs() {
    const ongoingPauseMs = (liveState === 'paused' && livePausedAt != null) ? (now() - livePausedAt) : 0;
    return now() - livePhaseStartedAt - livePausedAccumMs - ongoingPauseMs;
}

// Redraws the Portfolio Building countdown / live round clock every second from
// the shared anchor -- runs continuously so it always reflects whatever
// game/status last reported, including right after this panel loads/refreshes.
function tickLiveDisplays() {
    if (liveState === 'portfolio_building') {
        portfolioBuildTimer.style.display = 'inline-block';
        liveGameClock.style.display = 'none';

        const remaining = Math.max(0, PORTFOLIO_BUILD_DURATION_SEC - Math.floor((now() - livePhaseStartedAt) / 1000));
        if (remaining > 0) {
            const m = Math.floor(remaining / 60);
            const s = remaining % 60;
            portfolioBuildTimer.textContent = `⏱ Portfolio Building: ${m}:${String(s).padStart(2, '0')}`;
        } else {
            portfolioBuildTimer.textContent = '⏱ Portfolio Building: DONE';
            portfolioBuildTimer.style.color = '#34d399';
            portfolioBuildTimer.style.borderColor = 'rgba(52,211,153,0.3)';
            portfolioBuildTimer.style.background = 'rgba(52,211,153,0.1)';
            if (!portfolioBuildPrompted) {
                portfolioBuildPrompted = true;
                if (confirm('⏱ 5 minutes are up! Start Round 1 now?\n\n(Click OK to start immediately, or Cancel to wait and click START ROUND 1 manually)')) {
                    startRound1();
                }
            }
        }
    } else if (liveState === 'playing' || liveState === 'paused') {
        portfolioBuildTimer.style.display = 'none';
        liveGameClock.style.display = 'inline-block';

        const ticksPerSession = gameData ? gameData.meta.ticks_per_session : 0;
        const tickSeconds = gameData ? gameData.meta.tick_seconds : 1;
        const elapsedSec = Math.max(0, Math.floor(elapsedPlayingMs() / 1000));
        const tickInSession = Math.min(Math.max(ticksPerSession - 1, 0), Math.floor(elapsedSec / tickSeconds));
        const secsLeft = Math.max(0, (ticksPerSession - tickInSession - 1) * tickSeconds);
        const mm = Math.floor(secsLeft / 60).toString().padStart(2, '0');
        const ss = (secsLeft % 60).toString().padStart(2, '0');
        liveGameClock.textContent = `${liveState === 'paused' ? '⏸' : '●'} Round ${liveSession + 1} · Tick ${tickInSession} · ${mm}:${ss}`;
    } else {
        portfolioBuildTimer.style.display = 'none';
        liveGameClock.style.display = 'none';
    }
}

// Reconciles button visibility/text/enabled-state with the actual current
// game/status -- called on every watchGameState update, so a judge who refreshes
// mid-event sees the same controls they would have if they'd never left.
function reconcileControlButtons() {
    if (liveState === 'waiting') {
        startEventBtn.disabled = false;
        startEventBtn.style.background = '#34d399';
        startEventBtn.textContent = '▶ START EVENT';
        btnStartRound1.style.display = 'none';
        btnStartRound2.style.display = 'none';
        btnEndRound2.style.display = 'none';
        btnPauseEvent.style.display = 'none';
        return;
    }

    startEventBtn.disabled = true;
    startEventBtn.style.background = '#9ca3af';
    startEventBtn.textContent = liveState === 'portfolio_building' ? 'PORTFOLIO PHASE LIVE' : 'PORTFOLIO BUILD DONE';
    btnStartRound1.style.display = liveState === 'portfolio_building' ? 'inline-block' : 'none';

    const started = liveState === 'playing' || liveState === 'paused' || liveState === 'ended';
    btnPauseEvent.style.display = (started && liveState !== 'ended') ? 'inline-block' : 'none';
    if (liveState === 'paused') {
        btnPauseEvent.textContent = '▶ RESUME EVENT';
        btnPauseEvent.style.background = '#34d399';
        btnPauseEvent.style.color = '#022c22';
    } else {
        btnPauseEvent.textContent = '⏸ PAUSE EVENT';
        btnPauseEvent.style.background = '#fbbf24';
        btnPauseEvent.style.color = '#78350f';
    }

    if (!started) {
        btnStartRound2.style.display = 'none';
        btnEndRound2.style.display = 'none';
        return;
    }

    btnStartRound2.style.display = 'inline-block';
    btnStartRound2.disabled = liveSession >= 1;
    if (liveSession >= 1) {
        btnStartRound2.style.background = '#9ca3af';
        btnStartRound2.style.color = '#fff';
        btnStartRound2.textContent = 'ROUND 2 STARTED';
        btnEndRound2.style.display = 'inline-block';
        btnEndRound2.disabled = liveState === 'ended';
        btnEndRound2.style.background = liveState === 'ended' ? '#9ca3af' : '#f87171';
        btnEndRound2.style.color = liveState === 'ended' ? '#fff' : '#7f1d1d';
        btnEndRound2.textContent = liveState === 'ended' ? 'ROUND 2 ENDED' : '⏹ END ROUND 2';
    } else {
        btnStartRound2.style.background = '#60a5fa';
        btnStartRound2.style.color = '#1e3a8a';
        btnStartRound2.textContent = '▶ START ROUND 2';
        btnEndRound2.style.display = 'none';
    }
}

function setupListeners() {
    // Scope change requires full rescore
    scopeSelect.addEventListener("change", (e) => {
        currentScope = e.target.value;
        for (const team in cache) dirtyTeams.add(team);
    });

    // Start Event (Portfolio Build phase)
    startEventBtn.addEventListener("click", () => {
        if (confirm("Start the event? This will open a 5-minute Portfolio Building phase for all teams.")) {
            startEventBtn.disabled = true;
            startEventBtn.textContent = 'SETTING UP...';
            portfolioBuildPrompted = false;
            writeGameState('portfolio_building', 0, { phaseStartedAt: now(), pausedAccumMs: 0 })
                .catch(err => {
                    alert("Failed to start event: " + err.message + "\nCheck Firebase connection/rules and try again.");
                    reconcileControlButtons();
                });
        }
    });

    // Manual START ROUND 1 -- available as soon as Portfolio Building begins, so the
    // judge can end that phase early instead of waiting for the 5-minute timer.
    btnStartRound1.addEventListener("click", () => {
        const remaining = PORTFOLIO_BUILD_DURATION_SEC - Math.floor((now() - livePhaseStartedAt) / 1000);
        const msg = remaining > 0
            ? "Portfolio Building isn't finished yet. End it now and start Round 1 for all teams?"
            : "Start Round 1 now for all teams?";
        if (confirm(msg)) {
            startRound1();
        }
    });

    // Start Round 2 -- clicking this while Round 1 is still running ends Round 1
    // early: a fresh phaseStartedAt means every client's derived tick jumps straight
    // to Round 2's start the moment they see this update, refresh or not.
    btnStartRound2.addEventListener("click", () => {
        if (confirm("Start Round 2 now for all teams? If Round 1 hasn't finished yet, this ends it early.")) {
            btnStartRound2.disabled = true;
            btnStartRound2.textContent = 'STARTING...';
            writeGameState('playing', 1, { phaseStartedAt: now(), pausedAccumMs: 0 })
                .catch(err => {
                    alert("Failed to start round 2: " + err.message);
                    reconcileControlButtons();
                });
        }
    });

    // End Round 2 -- ends the event early for all teams (equivalent to letting
    // Round 2's clock run out naturally).
    btnEndRound2.addEventListener("click", () => {
        if (confirm("End Round 2 now for all teams? This ends the event immediately -- this cannot be undone.")) {
            btnEndRound2.disabled = true;
            btnEndRound2.textContent = 'ENDING...';
            writeGameState('ended', liveSession)
                .catch(err => {
                    alert("Failed to end round 2: " + err.message);
                    reconcileControlButtons();
                });
        }
    });

    // Pause Event -- freezes every client's derived tick at exactly this instant;
    // resuming extends pausedAccumMs by however long the pause lasted so the
    // session's remaining time isn't shortened by the pause.
    btnPauseEvent.addEventListener("click", () => {
        if (liveState === 'paused') {
            const resumedPausedAccumMs = livePausedAccumMs + (livePausedAt != null ? (now() - livePausedAt) : 0);
            writeGameState('playing', liveSession, { pausedAccumMs: resumedPausedAccumMs, pausedAt: null })
                .catch(err => alert("Failed to resume: " + err.message));
        } else {
            writeGameState('paused', liveSession, { pausedAt: now() })
                .catch(err => alert("Failed to pause: " + err.message));
        }
    });

    // Reset button logic
    resetBtn.addEventListener("click", () => {
        if (confirm("WARNING! This will completely reset the game, wipe all teams, and clear all orders. Are you absolutely sure?")) {
            resetGame().then(() => {
                alert("Game has been completely reset.");
                window.location.reload();
            }).catch(e => {
                console.error("Failed to reset game:", e);
                alert("Failed to reset the game. Check console for details.");
            });
        }
    });

    // Weight sliders always sum to 100 -- moving one redistributes the
    // remaining budget across the other two, proportional to their current
    // relative split (or evenly if both are at 0).
    const weightEls = { R: weightR, D: weightD, H: weightH };
    const valEls = { R: valR, D: valD, H: valH };

    function rebalanceWeights(changedKey) {
        const keys = ['R', 'D', 'H'];
        const vals = { R: parseInt(weightR.value), D: parseInt(weightD.value), H: parseInt(weightH.value) };
        const others = keys.filter(k => k !== changedKey);
        const remaining = 100 - vals[changedKey];
        const otherSum = others[0] === undefined ? 0 : vals[others[0]] + vals[others[1]];

        if (otherSum === 0) {
            vals[others[0]] = Math.floor(remaining / 2);
            vals[others[1]] = remaining - vals[others[0]];
        } else {
            vals[others[0]] = Math.round(remaining * (vals[others[0]] / otherSum));
            vals[others[1]] = remaining - vals[others[0]]; // fixes rounding so the total is always exactly 100
        }

        keys.forEach(k => {
            weights[k] = vals[k];
            weightEls[k].value = vals[k];
            valEls[k].textContent = vals[k];
        });
        renderLeaderboard();
    }

    weightR.addEventListener("input", () => rebalanceWeights('R'));
    weightD.addEventListener("input", () => rebalanceWeights('D'));
    weightH.addEventListener("input", () => rebalanceWeights('H'));
    
    // Offline Upload
    offlineBtn.addEventListener("click", () => offlineFile.click());
    offlineFile.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const bundle = JSON.parse(ev.target.result);
                if (bundle.game_seed !== gameData.meta.seed) {
                    alert("Bundle seed mismatch! This file is from a different game.");
                    return;
                }
                const team = bundle.team || "OfflineTeam";
                if (!cache[team]) cache[team] = { orders: [] };
                cache[team].rawOrders = bundle.orders;
                dirtyTeams.add(team);
                setOffline();
            } catch(err) {
                alert("Failed to parse bundle: " + err.message);
            }
        };
        reader.readAsText(file);
    });
    
    // Export CSV
    exportCsvBtn.addEventListener("click", () => {
        let csv = "Team,TotalScore,Return_pct,EffectiveRank,Hits,Trips\n";
        const teams = getSortedTeams();
        for (const t of teams) {
            const data = cache[t];
            const sub = data.subscores;
            const score = window.scoring.blend(sub, weights).toFixed(2);
            csv += `${t},${score},${(sub.rawR*100).toFixed(2)}%,${sub.rawRank.toFixed(1)},${sub.rawHits},${sub.rawTrips}\n`;
        }
        const blob = new Blob([csv], { type: "text/csv" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `chakravyuh_results_${gameData.meta.seed}.csv`;
        a.click();
    });

    // Team Management
    const btnAddTeam = document.getElementById("btn-add-team");
    const inputTeamName = document.getElementById("new-team-name");
    const inputTeamPass = document.getElementById("new-team-password");
    const inputTeamCapital = document.getElementById("new-team-capital");
    const msgTeamAdd = document.getElementById("team-add-msg");
    const registeredTeamsList = document.getElementById("registered-teams-list");

    if (btnAddTeam) {
        btnAddTeam.addEventListener("click", () => {
            const teamName = inputTeamName.value.trim().toLowerCase();
            const password = inputTeamPass.value.trim();
            const capitalRaw = inputTeamCapital.value.trim();
            const capital = capitalRaw ? Number(capitalRaw) : DEFAULT_STARTING_CAPITAL;
            if (!teamName || !password) {
                msgTeamAdd.textContent = "Please enter both name and password.";
                msgTeamAdd.style.color = "#f87171";
                return;
            }
            if (!Number.isFinite(capital) || capital <= 0) {
                msgTeamAdd.textContent = "Starting capital must be a positive number.";
                msgTeamAdd.style.color = "#f87171";
                return;
            }
            msgTeamAdd.textContent = "Adding...";
            msgTeamAdd.style.color = "#a1a1aa";

            addTeam(teamName, password, capital).then(() => {
                msgTeamAdd.textContent = "Team added successfully!";
                msgTeamAdd.style.color = "#34d399";
                inputTeamName.value = "";
                inputTeamPass.value = "";
                inputTeamCapital.value = String(DEFAULT_STARTING_CAPITAL);
                setTimeout(() => { msgTeamAdd.textContent = ""; }, 3000);
            }).catch(err => {
                msgTeamAdd.textContent = "Error: " + err.message;
                msgTeamAdd.style.color = "#f87171";
            });
        });

        watchTeams((teamsObj, err) => {
            if (err) {
                registeredTeamsList.innerHTML = `<span style="color: #f87171;">Failed to load teams</span>`;
                return;
            }
            if (!teamsObj) {
                registeredTeamsList.innerHTML = `<span style="color: #a1a1aa;">No teams registered yet.</span>`;
                return;
            }
            teamCredentials = teamsObj;
            for (const team in cache) dirtyTeams.add(team); // re-score with any updated capitals
            registeredTeamsList.innerHTML = "";
            for (const t of Object.keys(teamsObj)) {
                const span = document.createElement("span");
                span.textContent = `${t} (₹${getTeamK0(t).toLocaleString('en-IN')})`;
                span.style.cssText = "background: #334155; padding: 2px 8px; border-radius: 4px; display: inline-block;";
                registeredTeamsList.appendChild(span);
            }
        });
    }
}

function setOffline() {
    isLive = false;
    liveStatus.textContent = `● OFFLINE`;
    liveStatus.className = "status-pill offline";
}

function getSortedTeams() {
    const teams = Object.keys(cache).filter(t => cache[t].subscores);
    teams.sort((a, b) => {
        const sa = window.scoring.blend(cache[a].subscores, weights);
        const sb = window.scoring.blend(cache[b].subscores, weights);
        return sb - sa; // Descending
    });
    return teams;
}

function renderLeaderboard() {
    leaderboardBody.innerHTML = "";
    const sorted = getSortedTeams();
    
    sorted.forEach((team, idx) => {
        const data = cache[team];
        const sub = data.subscores;
        const totalScore = window.scoring.blend(sub, weights).toFixed(1);
        
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${idx + 1}</td>
            <td><strong>${team}</strong></td>
            <td class="score-col">${totalScore}</td>
            <td>
                <div class="stat-val">${(sub.rawR > 0 ? '+' : '')}${(sub.rawR*100).toFixed(1)}%</div>
                <div class="bar-bg"><div class="bar-fill" style="width: ${Math.max(0, Math.min(100, sub.sR*100))}%"></div></div>
            </td>
            <td>
                <div class="stat-val">${sub.rawRank.toFixed(1)}/5</div>
                <div class="bar-bg"><div class="bar-fill" style="width: ${Math.max(0, Math.min(100, sub.dRank*100))}%"></div></div>
            </td>
            <td>
                <div class="stat-val">${sub.rawHits}/${sub.rawTrips}</div>
                <div class="bar-bg"><div class="bar-fill" style="width: ${Math.max(0, Math.min(100, sub.sH*100))}%"></div></div>
            </td>
        `;
        
        tr.addEventListener("click", () => renderDrillDown(team));
        leaderboardBody.appendChild(tr);
    });
}

// ==========================================
// Drill-Down Charts
// ==========================================
function setupCharts() {
    const eqCtx = document.getElementById("drill-equity-chart").getContext("2d");
    equityChart = new Chart(eqCtx, {
        type: 'line',
        data: { labels: [], datasets: [{ label: 'Equity', data: [], borderColor: '#38bdf8', borderWidth: 2, pointRadius: 0, tension: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
    
    const rdCtx = document.getElementById("drill-radar-chart").getContext("2d");
    radarChart = new Chart(rdCtx, {
        type: 'radar',
        data: {
            labels: RADAR_FACTOR_LABELS,
            datasets: [{
                label: 'Exposure',
                data: RADAR_FACTOR_LABELS.map(() => 0),
                backgroundColor: 'rgba(168, 85, 247, 0.2)',
                borderColor: '#a855f7',
                pointBackgroundColor: '#a855f7'
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { r: { ticks: { display: false }, grid: { color: 'rgba(255,255,255,0.1)' }, pointLabels: { color: '#94a3b8', font: {size: 9} } } },
            plugins: { legend: { display: false } }
        }
    });
}

function renderDrillDown(team) {
    drillDownContainer.style.display = "block";
    drillTeamName.textContent = team;
    const data = cache[team];
    
    // Update Equity Chart
    const ticks = Array.from({length: data.rep.V.length}, (_, i) => i);
    equityChart.data.labels = ticks;
    equityChart.data.datasets[0].data = data.rep.V;
    equityChart.update();
    
    // Radar Chart -- exposure weighted by trade size (qty * canonical price / K0), same
    // weighting the real Diversification score uses (scoring.js effectiveRank), so this
    // view reflects the same exposure the score is based on rather than a raw beta count.
    const K0 = getTeamK0(team);
    const factorExposure = new Float64Array(window.scoring.FACTORS.length);
    for (const ord of data.rep.orders) {
        if (!betas[ord.ticker]) continue;
        const b = betas[ord.ticker];
        const w = Math.abs(ord.qty * ord.price) / K0;
        for (let k = 0; k < factorExposure.length; k++) {
            factorExposure[k] += w * Math.abs(b[k]);
        }
    }

    radarChart.data.datasets[0].data = Array.from(factorExposure);
    radarChart.update();
    
    // Blotter
    drillBlotterBody.innerHTML = "";
    const trips = data.rep.trips;
    trips.forEach(tp => {
        const tr = document.createElement("tr");
        const ret = ((tp.pOut - tp.pIn) / tp.pIn) * 100;
        const isHit = ret > 0;
        tr.innerHTML = `
            <td>${tp.ticker} (qty: ${tp.qty})</td>
            <td style="color: ${isHit ? 'var(--success)' : 'var(--danger)'}">${(ret > 0 ? '+' : '')}${ret.toFixed(2)}%</td>
            <td class="${isHit ? 'hit' : 'miss'}">${isHit ? 'HIT' : 'MISS'}</td>
        `;
        drillBlotterBody.appendChild(tr);
    });
}
