/* ==========================================================
   firebase_init.js — EEE4113F buoy dashboard

   Loads Firebase Web SDK v10 from the CDN (no bundler / no npm),
   initialises the app, opens an RTDB handle, and publishes the
   commonly-used database functions onto `window` so that the
   plain-JS data layer (data.js) can use them.

   IMPORTANT: this file is a <script type="module">. The dynamic
   `import()` calls below would also work, but the static form lets
   browsers preload the modules and reports errors more clearly.
   ========================================================== */

import { initializeApp } from
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase, ref, onValue, push, set, update, get, child,
} from
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

/* ---------- CONFIG — REPLACE THESE PLACEHOLDERS -------------------- */
const firebaseConfig = {
    apiKey:            "AIzaSyBH4NR_dZCjNmEUiW_yovUp_9LXzBgSYfs",
    authDomain:        "buoy-comms.firebaseapp.com",
    databaseURL:       "https://buoy-comms-default-rtdb.europe-west1.firebasedatabase.app",
    projectId:         "buoy-comms",
    storageBucket:     "buoy-comms.firebasestorage.app",
    messagingSenderId: "185315760642",
    appId:             "1:185315760642:web:c4e7a44e75f7ea002f651b"
};
/* ------------------------------------------------------------------- */

function looksConfigured(cfg) {
  return Object.values(cfg).every(
    v => typeof v === "string" && !v.startsWith("PLACEHOLDER_")
  );
}

if (!looksConfigured(firebaseConfig)) {
  console.warn(
    "[firebase_init] config still contains PLACEHOLDER_* values — " +
    "skipping Firebase init. The dashboard will fall back to simulated data."
  );
} else {
  try {
    const app = initializeApp(firebaseConfig);
    const db  = getDatabase(app);

    // Publish handles so data.js (loaded next, classic script) can use them.
    window.firebaseApp = app;
    window.firebaseDB  = db;
    window.firebaseRef    = ref;
    window.firebaseOnValue = onValue;
    window.firebasePush    = push;
    window.firebaseSet     = set;
    window.firebaseUpdate  = update;
    window.firebaseGet     = get;
    window.firebaseChild   = child;

    // Legacy / convenience names (also documented in the brief).
    window.db     = db;
    window.ref    = ref;
    window.onValue = onValue;
    window.push   = push;
    window.set    = set;

    // Quick smoke-test the data layer can invoke once everything is loaded.
    window.testConnection = async function testConnection() {
      try {
        const snap = await get(ref(db, "fleet/BY-G17"));
        if (snap.exists()) {
          console.log("[firebase_init] fleet/BY-G17 →", snap.val());
        } else {
          console.warn("[firebase_init] fleet/BY-G17 has no data yet — " +
                       "run setup_firebase.py to seed it.");
        }
        return snap.val();
      } catch (err) {
        console.error("[firebase_init] testConnection failed:", err);
        return null;
      }
    };

    // Signal readiness for data.js, which may load before this module finishes.
    window.dispatchEvent(new CustomEvent("firebase-ready"));
    console.log("[firebase_init] Firebase initialised, RTDB handle ready.");
  } catch (err) {
    console.error("[firebase_init] init failed — falling back to simulation:", err);
  }
}
