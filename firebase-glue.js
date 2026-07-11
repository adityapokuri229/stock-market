import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, push, set, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
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

export function initGlue(seed, team) {
    if (db) {
        basePath = `games/${seed}/teams/${team}`;
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

export function watchGame(seed, cb) {
    if (db) {
        authReady.then(() => {
            onValue(ref(db, `games/${seed}/teams`), snap => {
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

export function watchGameState(seed, cb) {
    if (db) {
        console.log(`[Firebase] Watching game state for seed ${seed}`);
        authReady.then(() => {
            onValue(ref(db, `games/${seed}/status`), snap => {
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

export function setGameState(seed, state) {
    if (db) {
        console.log(`[Firebase] Attempting to set game state to '${state}' for seed ${seed}`);
        return withTimeout(
            authReady.then(() => set(ref(db, `games/${seed}/status`), { state: state })),
            10000,
            "Timed out waiting for Firebase (check network / Firebase project status)."
        ).then(() => console.log(`[Firebase] Successfully set game state to '${state}'`));
    } else {
        console.warn("[Firebase] Cannot set game state, db is not initialized.");
        return Promise.reject(new Error("Firebase db is not initialized."));
    }
}
