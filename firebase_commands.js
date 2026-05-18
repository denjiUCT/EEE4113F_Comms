/* =============================================================
   firebase_commands.js — vessel UI ↔ Firebase command bridge
   
   Exposes window.BuoyCommands with:
     sendCommand(config, cmdCode) → writes to Firebase commands/pending
     subscribeStatus(fn)          → listens to offload_status
     subscribeContacts(fn)        → listens to nrf_contacts (radar)
     clearCommand()               → removes commands/pending
   
   Load AFTER firebase_init.js (which sets window.firebaseDB etc.)
   ============================================================= */

(function () {

  /* ── wait for Firebase to be ready ─────────────────────────── */
  function waitForFirebase(cb, attempts) {
    attempts = attempts || 0;
    if (window.firebaseDB && window.firebaseRef && window.firebaseOnValue
        && window.firebaseSet && window.firebasePush) {
      cb();
    } else if (attempts < 20) {
      setTimeout(() => waitForFirebase(cb, attempts + 1), 150);
    } else {
      console.error("[BuoyCommands] Firebase not ready after 3s — check firebase_init.js loaded first");
    }
  }

  /* ── command codes (must match buoy nrf.h) ──────────────────── */
  const CMD = {
    OFFLOAD:         0x01,
    PING:            0x02,
    RESET_READ_PTR:  0x03,
  };

  /* ── internal refs ──────────────────────────────────────────── */
  let _db, _ref, _onValue, _set, _push, _update, _remove;

  /* ── init ───────────────────────────────────────────────────── */
  function init() {
    _db      = window.firebaseDB;
    _ref     = window.firebaseRef;
    _onValue = window.firebaseOnValue;
    _set     = window.firebaseSet;
    _push    = window.firebasePush;
    _update  = window.firebaseUpdate;

    // firebase-database remove() may or may not be on window
    // fall back to set(null) which is equivalent
    _remove  = window.firebaseRemove || ((r) => _set(r, null));

    console.log("[BuoyCommands] initialised — Firebase ready");
  }

  /* ── sendCommand ────────────────────────────────────────────── 
     Writes the operator's command + WiFi credentials to Firebase.
     tcp_server.py watches this node and fires the vessel ESP32.
     
     config = {
       ssid:     string,
       password: string,
       ip:       [192,168,137,1],
       port:     5555
     }
     cmdCode = 0x01 | 0x02 | 0x03
  ─────────────────────────────────────────────────────────────── */
  function sendCommand(config, cmdCode) {
    if (!_db) { console.error("[BuoyCommands] not initialised"); return; }

    const payload = {
      cmd:       cmdCode,
      ssid:      config.ssid,
      password:  config.password,
      ip:        config.ip,
      port:      config.port,
      issued_at: Date.now(),
      status:    "pending",
    };

    _set(_ref(_db, "commands/pending"), payload)
      .then(() => {
        console.log("[BuoyCommands] command written →", payload);
        // Reset offload status for fresh progress display
        _set(_ref(_db, "offload_status"), {
          state:        "waiting",
          current_step: 0,
          packets_rx:   0,
          total:        0,
          throughput:   0,
          bytes:        0,
          stream_log:   [],
          updated_at:   Date.now(),
        });
      })
      .catch(err => console.error("[BuoyCommands] write failed:", err));
  }

  /* ── clearCommand ───────────────────────────────────────────── */
  function clearCommand() {
    if (!_db) return;
    _remove(_ref(_db, "commands/pending"))
      .then(() => console.log("[BuoyCommands] command cleared"))
      .catch(err => console.error("[BuoyCommands] clear failed:", err));
  }

  /* ── subscribeStatus ────────────────────────────────────────── 
     fn receives the offload_status object whenever it changes.
     Returns an unsubscribe function.
  ─────────────────────────────────────────────────────────────── */
  function subscribeStatus(fn) {
    if (!_db) { console.error("[BuoyCommands] not initialised"); return () => {}; }
    const r = _ref(_db, "offload_status");
    const unsub = _onValue(r, (snap) => {
      fn(snap.val() || {});
    });
    return unsub;
  }

  /* ── subscribeContacts ──────────────────────────────────────── 
     fn receives array of radar contact objects.
     tcp_server.py writes discovered buoys to nrf_contacts/.
     Returns an unsubscribe function.
  ─────────────────────────────────────────────────────────────── */
  function subscribeContacts(fn) {
    if (!_db) { console.error("[BuoyCommands] not initialised"); return () => {}; }
    const r = _ref(_db, "nrf_contacts");
    const unsub = _onValue(r, (snap) => {
      const data = snap.val() || {};
      // Convert object to array for radar component
      const contacts = Object.values(data);
      fn(contacts);
    });
    return unsub;
  }

  /* ── subscribeCommand ───────────────────────────────────────── 
     Internal use by tcp_server.py equivalent running in browser.
     Exposed in case a service worker or bridge script needs it.
  ─────────────────────────────────────────────────────────────── */
  function subscribeCommand(fn) {
    if (!_db) return () => {};
    const r = _ref(_db, "commands/pending");
    return _onValue(r, (snap) => fn(snap.val()));
  }

  /* ── public API ─────────────────────────────────────────────── */
  waitForFirebase(() => {
    init();
    window.BuoyCommands = {
      CMD,
      sendCommand,
      clearCommand,
      subscribeStatus,
      subscribeContacts,
      subscribeCommand,
    };
    console.log("[BuoyCommands] ready — window.BuoyCommands available");
    // Dispatch event so app.jsx knows commands bridge is live
    window.dispatchEvent(new CustomEvent("buoycommands:ready"));
  });

})();
