import { watchGame, setGameState, addTeam, watchTeams, resetGame } from './firebase-glue.js';

const ADMIN_PASSWORD = "judge123";

let gameData = null;
let betas = null;
const cache = {}; // team -> { subscores, flags, orders, rep }

let currentScope = "both";
let weights = { R: 45, D: 25, H: 30 };
let dirtyTeams = new Set();
let isLive = false;

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
function processTeamData(team) {
    const orders = cache[team].rawOrders || [];
    cache[team].orders = orders;
    
    // Parse scope parameter for replay
    let scopeParam = "both";
    if (currentScope === "0") scopeParam = 0;
    if (currentScope === "1") scopeParam = 1;
    
    // 1. Replay canonical prices
    const rep = window.scoring.replay(orders, gameData, scopeParam);
    cache[team].rep = rep;
    
    // 2. Subscore calculation
    const K0 = 1_000_000;
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
let adminIsPaused = false;
let activeSession = 0;

function setupListeners() {
    // Scope change requires full rescore
    scopeSelect.addEventListener("change", (e) => {
        currentScope = e.target.value;
        for (const team in cache) dirtyTeams.add(team);
    });

    // Start Event
    startEventBtn.addEventListener("click", () => {
        if (confirm("Are you sure you want to start the event for all teams?")) {
            startEventBtn.disabled = true;
            startEventBtn.textContent = 'STARTING...';
            activeSession = 0;
            setGameState({ state: 'playing', currentSession: activeSession })
                .then(() => {
                    startEventBtn.style.background = '#9ca3af';
                    startEventBtn.textContent = 'ROUND 1 STARTED';
                    btnPauseEvent.style.display = 'inline-block';
                    btnStartRound2.style.display = 'inline-block';
                    adminIsPaused = false;
                })
                .catch(err => {
                    startEventBtn.disabled = false;
                    startEventBtn.textContent = 'START EVENT';
                    alert("Failed to start event: " + err.message + "\nCheck Firebase connection/rules and try again.");
                });
        }
    });

    // Start Round 2
    btnStartRound2.addEventListener("click", () => {
        if (confirm("Are you sure you want to unlock Round 2 for all teams?")) {
            btnStartRound2.disabled = true;
            btnStartRound2.textContent = 'STARTING...';
            activeSession = 1;
            setGameState({ state: 'playing', currentSession: activeSession })
                .then(() => {
                    btnStartRound2.style.background = '#9ca3af';
                    btnStartRound2.style.color = '#fff';
                    btnStartRound2.textContent = 'ROUND 2 STARTED';
                    if (adminIsPaused) {
                        adminIsPaused = false;
                        btnPauseEvent.textContent = '⏸ PAUSE EVENT';
                        btnPauseEvent.style.background = '#fbbf24';
                        btnPauseEvent.style.color = '#78350f';
                    }
                })
                .catch(err => {
                    btnStartRound2.disabled = false;
                    btnStartRound2.textContent = '▶ START ROUND 2';
                    alert("Failed to start round 2: " + err.message);
                });
        }
    });

    // Pause Event
    btnPauseEvent.addEventListener("click", () => {
        adminIsPaused = !adminIsPaused;
        const newState = adminIsPaused ? 'paused' : 'playing';
        setGameState({ state: newState, currentSession: activeSession })
            .then(() => {
                if (adminIsPaused) {
                    btnPauseEvent.textContent = '▶ RESUME EVENT';
                    btnPauseEvent.style.background = '#34d399';
                    btnPauseEvent.style.color = '#022c22';
                } else {
                    btnPauseEvent.textContent = '⏸ PAUSE EVENT';
                    btnPauseEvent.style.background = '#fbbf24';
                    btnPauseEvent.style.color = '#78350f';
                }
            })
            .catch(err => {
                adminIsPaused = !adminIsPaused; // revert local state on failure
                alert("Failed to toggle pause: " + err.message);
            });
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

    // Weight sliders only trigger re-blend and re-render
    function updateWeights() {
        weights.R = parseInt(weightR.value);
        weights.D = parseInt(weightD.value);
        weights.H = parseInt(weightH.value);
        valR.textContent = weights.R;
        valD.textContent = weights.D;
        valH.textContent = weights.H;
        renderLeaderboard();
    }
    
    weightR.addEventListener("input", updateWeights);
    weightD.addEventListener("input", updateWeights);
    weightH.addEventListener("input", updateWeights);
    
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
    const msgTeamAdd = document.getElementById("team-add-msg");
    const registeredTeamsList = document.getElementById("registered-teams-list");

    if (btnAddTeam) {
        btnAddTeam.addEventListener("click", () => {
            const teamName = inputTeamName.value.trim().toLowerCase();
            const password = inputTeamPass.value.trim();
            if (!teamName || !password) {
                msgTeamAdd.textContent = "Please enter both name and password.";
                msgTeamAdd.style.color = "#f87171";
                return;
            }
            msgTeamAdd.textContent = "Adding...";
            msgTeamAdd.style.color = "#a1a1aa";
            
            addTeam(teamName, password).then(() => {
                msgTeamAdd.textContent = "Team added successfully!";
                msgTeamAdd.style.color = "#34d399";
                inputTeamName.value = "";
                inputTeamPass.value = "";
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
            registeredTeamsList.innerHTML = "";
            for (const t of Object.keys(teamsObj)) {
                const span = document.createElement("span");
                span.textContent = t;
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
            labels: ["Tech", "Risk", "Rates", "Demand", "Supply", "Policy", "Credit", "Crude", "Energy", "Metals"],
            datasets: [{
                label: 'Exposure',
                data: [0,0,0,0,0,0,0,0,0,0],
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
    const K0 = 1_000_000;
    const factorCounts = { "GlobalTech": 0, "GlobalRisk": 0, "RatesRupee": 0, "ConsDemand": 0, "SupplyChain": 0, "DomPolicy": 0, "Credit": 0, "CrudeOil": 0, "EnergyTx": 0, "Metals": 0 };
    for (const ord of data.rep.orders) {
        if (!betas[ord.ticker]) continue;
        const b = betas[ord.ticker];
        const w = Math.abs(ord.qty * ord.price) / K0;
        factorCounts.CrudeOil += w * Math.abs(b[0]);
        factorCounts.RatesRupee += w * Math.abs(b[1]);
        factorCounts.GlobalTech += w * Math.abs(b[2]);
        factorCounts.DomPolicy += w * Math.abs(b[3]);
        factorCounts.Metals += w * Math.abs(b[4]);
        factorCounts.ConsDemand += w * Math.abs(b[5]);
        factorCounts.GlobalRisk += w * Math.abs(b[6]);
        factorCounts.Credit += w * Math.abs(b[7]);
        factorCounts.EnergyTx += w * Math.abs(b[8]);
        factorCounts.SupplyChain += w * Math.abs(b[9]);
    }
    
    radarChart.data.datasets[0].data = [
        factorCounts.GlobalTech, factorCounts.GlobalRisk, factorCounts.RatesRupee, factorCounts.ConsDemand, factorCounts.SupplyChain,
        factorCounts.DomPolicy, factorCounts.Credit, factorCounts.CrudeOil, factorCounts.EnergyTx, factorCounts.Metals
    ];
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
