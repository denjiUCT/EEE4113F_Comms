/* ==========================================================
   data.js — Buoy fleet model + simulated Iridium link + DB
   No bundler. Plain JS. Exports onto window.BuoyData.

   Drop-in points for the real Iridium modem:
     BuoyData.addBuoy / setStatus / sendCommand / subscribe
   Wire these to your actual ground-station endpoint and the
   UI updates automatically.
   ========================================================== */

(function () {
  const STORAGE_KEY = "buoy.fleet.v1";
  const LOG_KEY = "buoy.iridium.log.v1";

  /* ---------- Seed fleet ---------- */
  const SEED = [
    {
      id: "BY-G17",
      name: "Group17-Buoy",
      lat: -33.9249,
      lng: 18.4241,
      status: "alive",
      deployed: "2026-05-06",
      last_contact: "2026-05-06T13:00:00Z",
      last_message: "MO|T=23.5|S=35.2|BAT=87%",
      reading: {
        water_temp: 23.5,
        salinity: 35.2,
        do_mgL: 7.2,
        battery_pct: 87,
        battery_v: 12.8,
        int_temp: 24.1,
        int_humidity: 52.3,
        heading: 0,
        drift_kn: 0.1,
      },
    },
  ];

  /* ---------- Helpers ---------- */
  const rand = (min, max) => min + Math.random() * (max - min);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const round = (v, n=2) => Math.round(v * 10**n) / 10**n;
  const nowISO = () => new Date().toISOString();
  const uid = () => "BY-" + String(Math.floor(100 + Math.random()*900));

  /* ---------- Sensor synthesis ---------- */
  function makeBaseline(b) {
    const tempBase = 22 - (b.lat - 35) * 0.6 + rand(-1, 1);
    return {
      water_temp: tempBase,
      do_mgL: rand(6.5, 8.5),
      salinity: rand(34.5, 38.5),
      int_temp: rand(18, 28),
      int_humidity: rand(45, 65),
      battery_v: rand(12.4, 13.2),
      battery_pct: rand(70, 99),
      heading: rand(0, 360),
      drift_kn: rand(0.05, 0.4),
    };
  }

  function evolve(reading, status) {
    const r = { ...reading };
    r.water_temp = clamp(r.water_temp + rand(-.08, .08), 4, 32);
    r.do_mgL    = clamp(r.do_mgL    + rand(-.05, .05), 3, 11);
    r.salinity  = clamp(r.salinity  + rand(-.02, .02), 30, 40);
    r.int_temp  = clamp(r.int_temp  + rand(-.1, .1), 10, 50);
    r.int_humidity = clamp(r.int_humidity + rand(-.3, .3), 25, 95);
    const solar = Math.sin(Date.now() / 45000) * 0.03;
    r.battery_pct = clamp(r.battery_pct - 0.02 + solar, 5, 100);
    r.battery_v   = clamp(11.5 + r.battery_pct * 0.018, 10.5, 13.4);
    r.heading = (r.heading + rand(-2, 2) + 360) % 360;
    r.drift_kn = clamp(r.drift_kn + rand(-.02, .02), 0, 1.5);

    if (status === "error") {
      r.int_temp += 12;
      r.int_humidity += 10;
      r.battery_pct = Math.min(r.battery_pct, 18);
    }
    if (status === "warn") {
      r.battery_pct = Math.min(r.battery_pct, 35);
    }
    return r;
  }

  /* ---------- DB (localStorage-backed) ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    const fleet = SEED.map(b => {
      const baseline = b.reading || makeBaseline(b);
      return {
        ...b,
        reading: baseline,
        history: [],
        telemetry: [],
        last_contact: b.last_contact || nowISO(),
      };
    });
    return fleet;
  }
  function save(fleet) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(fleet)); } catch(e) {}
  }
  function loadLog() {
    try {
      const raw = localStorage.getItem(LOG_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
  }
  function saveLog(log) {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-200))); } catch(e) {}
  }

  /* ---------- Fleet store (observable) ---------- */
  let fleet = load();
  let log = loadLog();
  const listeners = new Set();
  const logListeners = new Set();
  const txListeners = new Set();

  function notify() {
    save(fleet);
    listeners.forEach(fn => fn(fleet));
  }
  function notifyLog() {
    saveLog(log);
    logListeners.forEach(fn => fn(log));
  }
  function pulseTx(buoyId) {
    txListeners.forEach(fn => fn(buoyId));
  }

  function subscribe(fn)    { listeners.add(fn); fn(fleet); return () => listeners.delete(fn); }
  function subscribeLog(fn) { logListeners.add(fn); fn(log); return () => logListeners.delete(fn); }
  function subscribeTx(fn)  { txListeners.add(fn); return () => txListeners.delete(fn); }

  /* ---------- Iridium simulator ---------- */
  let timer = null;
  let paused = false;

  function tickBuoy(b) {
    if (b.status === "offline") return;
    if (b.status === "deploy") return;

    const newReading = evolve(b.reading, b.status);
    b.reading = newReading;
    b.last_contact = nowISO();

    const sample = {
      t: Date.now(),
      water_temp: round(newReading.water_temp, 2),
      do_mgL: round(newReading.do_mgL, 2),
      salinity: round(newReading.salinity, 2),
      battery_pct: round(newReading.battery_pct, 1),
      int_temp: round(newReading.int_temp, 1),
      int_humidity: round(newReading.int_humidity, 1),
    };
    b.history.push(sample);
    if (b.history.length > 60) b.history.shift();

    const payload = `MO|T=${sample.water_temp}|DO=${sample.do_mgL}|S=${sample.salinity}|BAT=${sample.battery_pct}%`;
    b.telemetry.unshift({ t: Date.now(), dir: "rx", payload });
    if (b.telemetry.length > 50) b.telemetry.length = 50;

    log.push({
      t: Date.now(),
      buoy: b.id,
      kind: "rx",
      msg: `${b.id} → SBD/MO  T:${sample.water_temp}°C  DO:${sample.do_mgL}  S:${sample.salinity}  BAT:${sample.battery_pct}%`
    });

    pulseTx(b.id);
  }

  function startSimLocal() {
    if (timer) return;
    fleet.forEach(b => {
      if (b.history.length === 0 && b.status !== "deploy") {
        let r = b.reading;
        for (let i = 0; i < 20; i++) {
          r = evolve(r, b.status);
          b.history.push({
            t: Date.now() - (20-i)*60000,
            water_temp: round(r.water_temp, 2),
            do_mgL: round(r.do_mgL, 2),
            salinity: round(r.salinity, 2),
            battery_pct: round(r.battery_pct, 1),
            int_temp: round(r.int_temp, 1),
            int_humidity: round(r.int_humidity, 1),
          });
        }
        b.reading = r;
      }
    });
    save(fleet);

    timer = setInterval(() => {
      if (paused) return;
      let any = false;
      fleet.forEach(b => {
        if (Math.random() < 0.30) { tickBuoy(b); any = true; }
      });
      if (any) {
        notify();
        notifyLog();
      }
    }, 2200);
  }

  function normaliseFirebaseFleet(raw) {
    if (!raw) return [];
    return Object.entries(raw).map(([id, value]) => {
      const existing = fleet.find(b => b.id === id) || {};
      const reading = value.reading || existing.reading || makeBaseline(value);
      return {
        ...existing,
        ...value,
        id: value.id || id,
        name: value.name || existing.name || id,
        lat: Number(value.lat ?? existing.lat ?? -33.9249),
        lng: Number(value.lng ?? existing.lng ?? 18.4241),
        status: value.status || existing.status || "alive",
        deployed: value.deployed || existing.deployed || "2026-05-06",
        last_contact: value.last_contact || existing.last_contact || nowISO(),
        reading,
        history: existing.history || [],
        telemetry: existing.telemetry || [],
      };
    });
  }

  function addReadingToBuoy(b, reading) {
    const sample = {
      t: Date.now(),
      water_temp: round(Number(reading.water_temp ?? reading.temperature ?? 0), 2),
      do_mgL: round(Number(reading.do_mgL ?? 0), 2),
      salinity: round(Number(reading.salinity ?? reading.conductivity ?? 0), 2),
      battery_pct: round(Number(reading.battery_pct ?? 0), 1),
      int_temp: round(Number(reading.int_temp ?? 0), 1),
      int_humidity: round(Number(reading.int_humidity ?? 0), 1),
    };
    b.history = b.history || [];
    b.history.push(sample);
    if (b.history.length > 60) b.history.shift();

    const payload = `MO|T=${sample.water_temp}|DO=${sample.do_mgL}|S=${sample.salinity}|BAT=${sample.battery_pct}%`;
    b.telemetry = b.telemetry || [];
    b.telemetry.unshift({ t: Date.now(), dir: "rx", payload });
    if (b.telemetry.length > 50) b.telemetry.length = 50;
  }

  function _ingestMO(buoyId, reading) {
    let b = fleet.find(x => x.id === buoyId);
    if (!b) {
      b = {
        id: buoyId,
        name: buoyId,
        lat: -33.9249,
        lng: 18.4241,
        status: "alive",
        deployed: nowISO().slice(0, 10),
        reading: makeBaseline({ lat: -33.9249, lng: 18.4241 }),
        history: [],
        telemetry: [],
        last_contact: nowISO(),
      };
      fleet.push(b);
    }
    b.reading = { ...b.reading, ...reading };
    b.last_contact = nowISO();
    b.status = "alive";
    addReadingToBuoy(b, b.reading);
    log.push({
      t: Date.now(),
      buoy: buoyId,
      kind: "rx",
      msg: `${buoyId} → SBD/MO  T:${b.reading.water_temp}°C  S:${b.reading.salinity}  BAT:${b.reading.battery_pct}%`,
    });
    pulseTx(buoyId);
    notify();
    notifyLog();
  }

  let firebaseStarted = false;
  function startFirebase() {
    if (firebaseStarted || timer) return;
    firebaseStarted = true;

    const attach = () => {
      if (timer) return;
      if (!window.firebaseDB || !window.firebaseRef || !window.firebaseOnValue) {
        startSimLocal();
        return;
      }

      window.firebaseOnValue(window.firebaseRef(window.firebaseDB, "fleet"), snap => {
        const incoming = normaliseFirebaseFleet(snap.val());
        if (!incoming.length) return;
        incoming.forEach(next => {
          const prev = fleet.find(b => b.id === next.id);
          const changedReading = prev && JSON.stringify(prev.reading) !== JSON.stringify(next.reading);
          if (prev) Object.assign(prev, next);
          else fleet.push(next);
          if (!prev || changedReading) {
            addReadingToBuoy(prev || next, next.reading || {});
            pulseTx(next.id);
          }
        });
        notify();
      }, err => {
        console.warn("[BuoyData] Firebase fleet listener failed, using simulation:", err);
        startSimLocal();
      });

      window.firebaseOnValue(window.firebaseRef(window.firebaseDB, "iridium_log"), snap => {
        const raw = snap.val() || {};
        log = Object.values(raw)
          .filter(item => item && item.msg)
          .sort((a, b) => (a.t || 0) - (b.t || 0))
          .slice(-200);
        notifyLog();
      });
    };

    if (window.firebaseDB) attach();
    else {
      window.addEventListener("firebase-ready", attach, { once: true });
      setTimeout(() => {
        if (!window.firebaseDB) startSimLocal();
      }, 1500);
    }
  }

  function pauseSim()  { paused = true; }
  function resumeSim() { paused = false; }
  function isPaused()  { return paused; }

  /* ---------- Mutations ---------- */
  function setStatus(id, status) {
    const b = fleet.find(x => x.id === id);
    if (!b) return;
    b.status = status;
    b.telemetry.unshift({ t: Date.now(), dir: "cmd", payload: `STATUS_SET ${status.toUpperCase()}` });
    log.push({ t: Date.now(), buoy: id, kind: "cmd", msg: `${id} ← STATUS_SET ${status.toUpperCase()}` });
    notify(); notifyLog();
  }

  function addBuoy({ lat, lng, name }) {
    const id = uid();
    const b = {
      id,
      name: name || ("Buoy-" + id.slice(3)),
      lat, lng,
      status: "deploy",
      deployed: nowISO().slice(0, 10),
      reading: makeBaseline({ lat, lng }),
      history: [],
      telemetry: [{ t: Date.now(), dir: "cmd", payload: "PROVISION" }],
      last_contact: nowISO(),
    };
    fleet.push(b);
    log.push({ t: Date.now(), buoy: id, kind: "cmd", msg: `${id} ← PROVISION at ${lat.toFixed(2)}, ${lng.toFixed(2)}` });
    notify(); notifyLog();
    return b;
  }

  function removeBuoy(id) {
    fleet = fleet.filter(b => b.id !== id);
    log.push({ t: Date.now(), buoy: id, kind: "cmd", msg: `${id} ← DECOMMISSION` });
    notify(); notifyLog();
  }

  function sendCommand(id, cmd) {
    const b = fleet.find(x => x.id === id);
    if (!b) return;
    b.telemetry.unshift({ t: Date.now(), dir: "tx", payload: `MT|${cmd}` });
    log.push({ t: Date.now(), buoy: id, kind: "tx", msg: `${id} ← MT  ${cmd}` });
    notify(); notifyLog();

    setTimeout(() => {
      const bb = fleet.find(x => x.id === id);
      if (!bb) return;
      bb.telemetry.unshift({ t: Date.now(), dir: "rx", payload: `ACK|${cmd}|OK` });
      log.push({ t: Date.now(), buoy: id, kind: "rx", msg: `${id} → ACK  ${cmd} OK` });
      notify(); notifyLog();
      pulseTx(id);
    }, 1500 + Math.random() * 1500);
  }

  function resetFleet() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LOG_KEY);
    fleet = load();
    log = [];
    notify(); notifyLog();
  }

  /* ---------- Public API ---------- */
  window.BuoyData = {
    getFleet: () => fleet,
    getLog: () => log,
    subscribe, subscribeLog, subscribeTx,
    startSim: startFirebase, startFirebase, startSimLocal, pauseSim, resumeSim, isPaused,
    setStatus, addBuoy, removeBuoy, sendCommand, resetFleet,
    _ingestMO,
  };
})();
