// Firebase configuration loader
// In production or local development, you can override these values:
// 1. By defining window.__FIREBASE_CONFIG__ before this script loads
// 2. Or by serving via a dev server that injects environment variables
// 3. Or by placing a config.local.js file (which is gitignored)

const defaultConfig = {
    apiKey: "",
    authDomain: "",
    databaseURL: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: "",
    measurementId: ""
};

export const firebaseConfig = Object.assign(
    {},
    defaultConfig,
    (typeof window !== "undefined" && window.__FIREBASE_CONFIG__) || {}
);
