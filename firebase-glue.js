import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, push, set, get, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyCgqu5sk6S1-R4BW3eMAJWBU5qg6bjHmfk",
    authDomain: "chakravyuh-stock-market.firebaseapp.com",
    databaseURL: "https://chakravyuh-stock-market-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "chakravyuh-stock-market",
    storageBucket: "chakravyuh-stock-market.firebasestorage.app",
    messagingSenderId: "298006582192",
    appId: "1:298006582192:web:e5dd52ef7552178a4bbc75",
    measurementId: "G-3RFQ6GLPBZ"
};

// Initialize Firebase only if config is provided
let app, db, basePath = null;

// Resolves true once anonymous auth succeeds, false if it fails/is unavailable.
// All db reads/writes below wait on this so they never race the sign-in.
let authReady = Promise.resolve(false);

try {
    if (firebaseConfig.apiKey !== "AIzaSy_YOUR_API_KEY_HERE") {
        app = initializeApp(firebaseConfig);
        db = getDatabase(app);
        authReady = signInAnonymously(getAuth(app))
            .then(() => true)
            .catch(err => {
                console.error("[Firebase] Anonymous sign-in failed:", err);
                return false;
            });
    } else {
        console.warn("Firebase config is empty. Running in offline/standalone mode.");
    }
} catch (e) {
    console.error("Firebase initialization failed", e);
}

function withTimeout(promise, ms, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Tracks the offset between this browser's clock and the Firebase server's clock
// (a special always-available path, no auth required) so every client -- and the
// judge -- agree on "now" for tick/timer math regardless of local clock drift.
let serverTimeOffsetMs = 0;
if (db) {
    onValue(ref(db, ".info/serverTimeOffset"), snap => {
        serverTimeOffsetMs = snap.val() || 0;
    });
}

// Best-effort server-synced "now" in ms. Ticks/timers are derived from this plus
// a shared phase-start timestamp stored in Firebase, instead of a per-browser
// local counter -- so refreshing (or a slow/fast local clock) never desyncs.
// Also used (by the judge's browser) to stamp anchor timestamps it writes --
// accurate to well within our 1s tick granularity thanks to the offset above.
export function now() {
    return Date.now() + serverTimeOffsetMs;
}

export function initGlue(team) {
    if (db) {
        basePath = `game/teams/${team}`;
        console.log("Firebase glue initialized for path:", basePath);

        // Push a presence flag so the Judge sees the team immediately upon login
        authReady.then(() => {
            set(ref(db, `${basePath}/presence`), { online: true, loginTime: Date.now() })
                .catch(err => console.error("[Firebase] Failed to write presence:", err));
        });
    }
}

export function pushOrder(order) {
    if (basePath && db) {
        // fire-and-forget; game never blocks on it
        authReady.then(() => {
            push(ref(db, `${basePath}/orders`), { ...order, ts: Date.now() })
                .catch(err => {
                    console.error("Firebase push failed -- order was not saved", err);
                });
        });
    }
}

// Live view of this team's own order history, so cash/holdings can be rebuilt by
// replay on load/refresh (and stay in sync if a teammate trades from another
// device) instead of resetting to a fresh portfolio every time the page reloads.
export function watchTeamOrders(team, cb) {
    if (db) {
        authReady.then(() => {
            onValue(ref(db, `game/teams/${team}/orders`), snap => {
                const val = snap.val() || {};
                cb(Object.values(val));
            }, (error) => {
                console.error("[Firebase] watchTeamOrders error:", error);
                cb(null, error);
            });
        });
    } else {
        console.warn("[Firebase] Cannot watch team orders, db is not initialized.");
    }
}

export function watchGame(cb) {
    if (db) {
        authReady.then(() => {
            onValue(ref(db, `game/teams`), snap => {
                cb(snap.val() || {});
            }, (error) => {
                console.error("Firebase watchGame error:", error);
                // Simulate offline if failed
                cb(null, error);
            });
        });
    } else {
        console.warn("watchGame called but Firebase is not initialized.");
        // We do not call cb here so the UI stays in "Waiting" or "Offline" state
        // unless they load a file.
    }
}

export function watchGameState(cb) {
    if (db) {
        console.log(`[Firebase] Watching game state`);
        authReady.then(() => {
            onValue(ref(db, `game/status`), snap => {
                console.log(`[Firebase] Game state update received:`, snap.val());
                cb(snap.val() || { state: 'waiting' });
            }, (error) => {
                console.error("[Firebase] watchGameState error:", error);
                cb(null, error);
            });
        });
    } else {
        // Fallback for offline mode
        console.warn("[Firebase] Offline mode, cannot watch game state.");
        cb({ state: 'waiting' });
    }
}

export function setGameState(payload) {
    if (db) {
        console.log(`[Firebase] Attempting to set game state to:`, payload);
        return withTimeout(
            authReady.then(() => set(ref(db, `game/status`), payload)),
            10000,
            "Timed out waiting for Firebase (check network / Firebase project status)."
        ).then(() => console.log(`[Firebase] Successfully set game state.`));
    } else {
        console.warn("[Firebase] Cannot set game state, db is not initialized.");
        return Promise.reject(new Error("Firebase db is not initialized."));
    }
}

export function addTeam(teamName, password, startingCapital) {
    if (db) {
        return authReady.then(() => {
            return set(ref(db, `game/credentials/${teamName}`), { password, startingCapital });
        });
    } else {
        return Promise.reject(new Error("Firebase db is not initialized."));
    }
}

export function watchTeams(cb) {
    if (db) {
        authReady.then(() => {
            onValue(ref(db, `game/credentials`), snap => {
                cb(snap.val() || {});
            }, (error) => {
                console.error("[Firebase] watchTeams error:", error);
                cb(null, error);
            });
        });
    } else {
        console.warn("[Firebase] Cannot watch teams, db is not initialized.");
    }
}

// Credentials were originally stored as a raw password string; new entries are
// {password, startingCapital}. Accept both so pre-existing teams keep working.
function credentialPassword(val) {
    return (val && typeof val === 'object') ? val.password : val;
}

export function verifyTeam(teamName, password) {
    if (db) {
        return authReady.then(() => {
            return get(ref(db, `game/credentials/${teamName}`)).then(snap => {
                if (snap.exists() && credentialPassword(snap.val()) === password) {
                    return true;
                }
                return false;
            });
        });
    } else {
        return Promise.reject(new Error("Firebase db is not initialized."));
    }
}

// Returns the team's configured starting capital, or null if unset/unknown
// (e.g. a team registered before this field existed) so the caller can fall
// back to the game's default.
export function getTeamCapital(teamName) {
    if (db) {
        return authReady.then(() => {
            return get(ref(db, `game/credentials/${teamName}/startingCapital`)).then(snap => {
                const v = snap.val();
                return (typeof v === 'number' && v > 0) ? v : null;
            });
        });
    } else {
        return Promise.reject(new Error("Firebase db is not initialized."));
    }
}

export function resetGame() {
    if (db) {
        return authReady.then(() => {
            return set(ref(db, `game`), { status: { state: 'waiting' } });
        });
    } else {
        return Promise.reject(new Error("Firebase db is not initialized."));
    }
}
