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
                    console.error("Firebase push failed, but localStorage still has it", err);
                });
        });
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

export function addTeam(teamName, password) {
    if (db) {
        return authReady.then(() => {
            return set(ref(db, `game/credentials/${teamName}`), password);
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

export function verifyTeam(teamName, password) {
    if (db) {
        return authReady.then(() => {
            return get(ref(db, `game/credentials/${teamName}`)).then(snap => {
                if (snap.exists() && snap.val() === password) {
                    return true;
                }
                return false;
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
