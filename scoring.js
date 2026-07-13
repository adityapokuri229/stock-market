const FACTORS = [
    "InterestRates", "RegulatoryRisk", "Oil", "InflationReaction", "GeopoliticalStability",
    "SemiconductorDemand", "ConsumerDisc", "InvestorConfidence", "TechDevelopments", "Aero", "Healthcare"
];
const NUM_FACTORS = FACTORS.length;

function parseBetas(gameData) {
    const betas = {};
    for (const u of gameData.universe) {
        const v = new Float64Array(NUM_FACTORS);
        const m = u.research.match(/sensitivities:\s*(.+)/);
        if (m) {
            for (const part of m[1].split(",")) {
                const pm = part.trim().match(/(\w+)\s+([+-][\d.]+)/);
                if (pm) {
                    const idx = FACTORS.indexOf(pm[1]);
                    if (idx !== -1) {
                        v[idx] = parseFloat(pm[2]);
                    }
                }
            }
        }
        betas[u.ticker] = v;
    }
    return betas;
}

function scopeTickRange(gameData, scope) {
    const perSession = gameData.meta.ticks_per_session;
    if (scope === 0) return [0, perSession - 1];
    if (scope === 1) return [perSession, gameData.rows.length - 1];
    return [0, gameData.rows.length - 1];
}

function replay(orders, gameData, scope, startingCapital = 1_000_000, liveTickCap = Infinity) {
    // scope: 0 (Session 1 only), 1 (Session 2 only), or "both" (the real, continuous
    // full-game score). Positions/cash carry through the whole 240-tick game per the
    // PRD -- sessions only reshuffle news/market, they never reset the portfolio.
    // Scoping to a single session is an isolated judge-console view (fresh K0 for
    // that window), not a change to how the real "both" score is computed.
    // startingCapital is the team's configured starting cash (defaults to ₹10L for
    // teams that predate the per-team amount field).
    // liveTickCap caps replay at however far the game has actually progressed in
    // real time (see admin.js's liveGlobalTickCap()) -- without it, a team's
    // Return/Hit-Rate would be computed against the full precomputed price path
    // all the way to the scope's end, revealing future price movement (and
    // scoring trades) before that time has actually elapsed.
    const rows = gameData.rows;
    const K0 = startingCapital;
    const [tickStart, tickEndScope] = scopeTickRange(gameData, scope);
    const tickEnd = Math.min(tickEndScope, liveTickCap);
    const scopedOrders = orders.filter(o => o.tick >= tickStart && o.tick <= tickEnd);
    let cash = K0, shares = {};
    const V = [], lots = {}, trips = [], holdingsByTick = [];
    let oi = 0;

    function forceCloseAll(lotsRef, sharesRef, endRow, tripsRef) {
        for (const tk in sharesRef) {
            if (sharesRef[tk] > 0 && lotsRef[tk]) {
                const px = endRow.prices[tk];
                for (const lot of lotsRef[tk]) {
                    if (lot.qty > 0) {
                        tripsRef.push({
                            tickIn: lot.tick,
                            tickOut: endRow.tick,
                            ticker: tk,
                            qty: lot.qty,
                            pIn: lot.price,
                            pOut: px,
                            forced: true
                        });
                    }
                }
            }
        }
    }

    function addLot(lotsRef, order, tick) {
        if (!lotsRef[order.ticker]) lotsRef[order.ticker] = [];
        lotsRef[order.ticker].push({ qty: order.qty, price: order.price, tick: tick });
    }

    function fifoClose(lotsRef, order, tick, row, tripsRef) {
        let remaining = order.qty;
        if (!lotsRef[order.ticker]) return; // Cannot sell if no lots
        
        while (remaining > 0 && lotsRef[order.ticker].length > 0) {
            const lot = lotsRef[order.ticker][0];
            if (lot.qty <= remaining) {
                // Consume entire lot
                tripsRef.push({
                    tickIn: lot.tick,
                    tickOut: tick,
                    ticker: order.ticker,
                    qty: lot.qty,
                    pIn: lot.price,
                    pOut: row.prices[order.ticker],
                    forced: false
                });
                remaining -= lot.qty;
                lotsRef[order.ticker].shift(); // Remove consumed lot
            } else {
                // Partially consume lot
                tripsRef.push({
                    tickIn: lot.tick,
                    tickOut: tick,
                    ticker: order.ticker,
                    qty: remaining,
                    pIn: lot.price,
                    pOut: row.prices[order.ticker],
                    forced: false
                });
                lot.qty -= remaining;
                remaining = 0;
            }
        }
    }

    for (let t = tickStart; t <= tickEnd; t++) {
        const row = rows[t];

        while (oi < scopedOrders.length && scopedOrders[oi].tick === t) {
            const o = scopedOrders[oi++];
            const px = row.prices[o.ticker];
            
            // Note: The execution price used in replay is the canonical price
            // We store the canonical price inside the order for tracking
            o.price = px;
            
            if (o.side === "BUY") {
                cash -= px * o.qty;
                addLot(lots, o, t);
                shares[o.ticker] = (shares[o.ticker] || 0) + o.qty;
            } else {
                cash += px * o.qty;
                fifoClose(lots, o, t, row, trips);
                shares[o.ticker] -= o.qty;
                if (shares[o.ticker] <= 0) shares[o.ticker] = 0;
            }
        }
        
        let pos = 0;
        const w = {};
        for (const tk in shares) {
            if (shares[tk] > 0) {
                const val = shares[tk] * row.prices[tk];
                pos += val;
                w[tk] = val / K0;
            }
        }
        V.push(cash + pos);
        holdingsByTick.push(w);
    }

    // end-of-window MTM (end of game for scope "both", end of session for a
    // single-session scope, or wherever liveTickCap froze it -- e.g. viewing a
    // Session 2 scope before Round 2 has actually started leaves tickEnd < tickStart,
    // meaning nothing has happened in this window yet, so skip the force-close).
    if (tickEnd >= tickStart) {
        forceCloseAll(lots, shares, rows[tickEnd], trips);
    }

    return { V, trips, orders: scopedOrders, holdingsByTick };
}

function scoreReturn(V, K0, r0 = 0.04, lam = 0.075) {
    if (!V.length) return { r: 0, sR: 0 }; // nothing has happened in this window yet
    const r = (V[V.length-1] - K0) / K0;
    return { r, sR: 1 / (1 + Math.exp(-(r - r0) / lam)) };
}

function effectiveRank(orders, betas, rowsByTick, K0, Rcap = 5) {
    const G = Array.from({length: NUM_FACTORS}, () => new Float64Array(NUM_FACTORS));
    for (const o of orders) {
        if (!rowsByTick[o.tick]) continue;
        const canonicalPx = rowsByTick[o.tick].prices[o.ticker];
        const w = (o.side === "BUY" ? 1 : -1) * o.qty * canonicalPx / K0;
        const b = betas[o.ticker];
        if (!b) continue;

        for (let k = 0; k < NUM_FACTORS; k++) {
            for (let l = 0; l < NUM_FACTORS; l++) {
                G[k][l] += (w * b[k]) * (w * b[l]);
            }
        }
    }

    let tr = 0, fro2 = 0;
    for (let k = 0; k < NUM_FACTORS; k++) {
        tr += G[k][k];
        for (let l = 0; l < NUM_FACTORS; l++) {
            fro2 += G[k][l] * G[k][l];
        }
    }

    const Reff = fro2 > 0 ? (tr * tr) / fro2 : 0;
    return { Reff, dRank: Math.min(Reff / Rcap, 1) };
}

function neutrality(holdingsByTick, betas, Ncap = 0.5) {
    let net = 0, gross = 0;
    // holdingsByTick should be an array (for each tick) of objects: {ticker: weight_at_tick}
    for (const w of holdingsByTick) {
        for (let k = 0; k < NUM_FACTORS; k++) {
            let E = 0, Gk = 0;
            for (const tk in w) {
                if (!betas[tk]) continue;
                const x = w[tk] * betas[tk][k];
                E += x;
                Gk += Math.abs(x);
            }
            net += Math.abs(E);
            gross += Gk;
        }
    }
    
    const nu = gross > 0 ? 1 - net / gross : 0;
    return { nu, dNeut: Math.min(nu / Ncap, 1) };
}

function scoreHitRate(trips, K0, theta = 0.005, kappa = 2) {
    const q = trips.filter(tp => tp.qty * tp.pIn >= theta * K0);
    const hits = q.filter(tp => tp.pOut > tp.pIn).length;
    if (q.length === 0) return { hits: 0, nTr: 0, sH: 0, flag: "insufficient" };
    return { hits, nTr: q.length, sH: (hits + kappa/2) / (q.length + kappa) };
}

function blend(sub, w) {
    const sD = 0.6 * sub.dRank + 0.4 * sub.dNeut;
    return 100 * (w.R * sub.sR + w.D * sD + w.H * sub.sH) / (w.R + w.D + w.H);
}

// Export for browser
window.scoring = {
    FACTORS,
    parseBetas,
    replay,
    scoreReturn,
    effectiveRank,
    neutrality,
    scoreHitRate,
    blend
};
