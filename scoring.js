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
    // Short-selling-aware replay. Shares are signed: positive = long, negative = short.
    // Lots are tracked in a unified array: lots[ticker] with a 'side' property.
    const rows = gameData.rows;
    const K0 = startingCapital;
    const [tickStart, tickEndScope] = scopeTickRange(gameData, scope);
    const tickEnd = Math.min(tickEndScope, liveTickCap);
    const scopedOrders = orders.filter(o => o.tick >= tickStart && o.tick <= tickEnd);
    let cash = K0, shares = {};
    const V = [], lots = {}, trips = [], holdingsByTick = [], sessionReturns = [];
    let oi = 0;
    const sessionLength = gameData.meta.ticks_per_session;
    let currentSession = Math.floor(tickStart / sessionLength);

    // Close all remaining positions at the end of a window (force-close at last price).
    function forceCloseAll(endRow, tripsRef) {
        for (const tk in shares) {
            const px = endRow.prices[tk];
            if (lots[tk]) {
                for (const lot of lots[tk]) {
                    if (lot.qty > 0) {
                        tripsRef.push({
                            tickIn: lot.tick, tickOut: endRow.tick,
                            ticker: tk, qty: lot.qty,
                            pIn: lot.price, pOut: px,
                            side: lot.side, forced: true
                        });
                    }
                }
            }
        }
    }

    for (let t = tickStart; t <= tickEnd; t++) {
        const row = rows[t];

        const tSession = Math.floor(t / sessionLength);
        if (tSession > currentSession) {
            const lastRowOfPrev = rows[(currentSession + 1) * sessionLength - 1];
            forceCloseAll(lastRowOfPrev, trips);
            sessionReturns.push((V[V.length - 1] - K0) / K0);
            
            cash = K0;
            for (const tk in shares) delete shares[tk];
            for (const tk in lots) delete lots[tk];
            currentSession = tSession;
        }

        while (oi < scopedOrders.length && scopedOrders[oi].tick === t) {
            const o = scopedOrders[oi++];
            const px = row.prices[o.ticker];
            o.price = px;
            const tk = o.ticker;
            const curShares = shares[tk] || 0;

            const dir = o.side === "BUY" ? 1 : -1;
            cash -= dir * px * o.qty;
            let remaining = o.qty;

            if (!lots[tk]) lots[tk] = [];
            const oppositeSide = o.side === "BUY" ? "SHORT" : "LONG";

            // First: cover/close opposite side lots (FIFO)
            if (curShares !== 0 && Math.sign(curShares) !== dir) {
                while (remaining > 0 && lots[tk].length > 0 && lots[tk][0].side === oppositeSide) {
                    const lot = lots[tk][0];
                    const fill = Math.min(remaining, lot.qty);
                    trips.push({
                        tickIn: lot.tick, tickOut: t,
                        ticker: tk, qty: fill,
                        pIn: lot.price, pOut: px,
                        side: oppositeSide, forced: false
                    });
                    remaining -= fill;
                    lot.qty -= fill;
                    if (lot.qty <= 0) lots[tk].shift();
                }
            }
            
            // Remainder: open/extend new lots in current direction
            if (remaining > 0) {
                lots[tk].push({ qty: remaining, price: px, tick: t, side: o.side });
            }
            shares[tk] = curShares + (dir * o.qty);
            if (shares[tk] === 0) delete shares[tk];
        }
        
        let pos = 0;
        const w = {};
        for (const tk in shares) {
            const val = shares[tk] * row.prices[tk]; // signed: negative for shorts
            pos += val;
            w[tk] = val / K0; // signed weight
        }
        V.push(cash + pos);
        holdingsByTick.push(w);
    }

    // end-of-window MTM
    if (tickEnd >= tickStart) {
        forceCloseAll(rows[tickEnd], trips);
        sessionReturns.push((V[V.length - 1] - K0) / K0);
    }

    return { V, trips, orders: scopedOrders, holdingsByTick, sessionReturns };
}

function scoreReturn(sessionReturns, r0 = 0.04) {
    if (!sessionReturns || !sessionReturns.length) return { r: 0, sR: 0 };
    const avgR = sessionReturns.reduce((a, b) => a + b, 0) / sessionReturns.length;
    const lam = avgR >= r0 ? 0.086 : 0.0289;
    return { r: avgR, sR: 1 / (1 + Math.exp(-(avgR - r0) / lam)) };
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

function neutrality(holdingsByTick, betas, Ncap = 0.7) {
    let net = 0, gross = 0;
    for (const w of holdingsByTick) {
        for (let k = 0; k < NUM_FACTORS; k++) {
            let E = 0, Gk = 0;
            for (const tk in w) {
                if (!betas[tk]) continue;
                const x = w[tk] * betas[tk][k]; // w[tk] is now signed
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

// Direction-aware hit definition: a trip is a hit when the price moved in
// the direction the trader bet on (up for longs, down for shorts).
function scoreHitRate(trips, K0, theta = 0.005, kappa = 2) {
    const q = trips.filter(tp => tp.qty * tp.pIn >= theta * K0);
    const hits = q.filter(tp => {
        const pnl = (tp.pOut - tp.pIn) * (tp.side === 'SHORT' ? -1 : 1);
        return pnl > 0;
    }).length;
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
