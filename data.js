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
    { id: "BY-001", name: "Atlas-1",     lat:  36.95, lng:  -8.20, status: "alive",   deployed: "2025-08-12" },
    { id: "BY-002", name: "Atlas-2",     lat:  35.10, lng: -10.40, status: "alive",   deployed: "2025-08-12" },
    { id: "BY-003", name: "Mistral-1",   lat:  41.40, lng:   3.20, status: "alive",   deployed: "2025-09-03" },
    { id: "BY-004", name: "Mistral-2",   lat:  43.20, lng:   6.80, status: "warn",    deployed: "2025-09-03" },
    { id: "BY-005", name: "Levant-A",    lat:  34.30, lng:  28.50, status: "alive",   deployed: "2025-10-21" },
    { id: "BY-006", name: "Levant-B",    lat:  32.10, lng:  31.60, status: "error",   deployed: "2025-10-21" },
    { id: "BY-007", name: "Pillar-1",    lat:  35.80, lng:  -5.90, status: "alive",   deployed: "2025-11-04" },
    { id: "BY-008", name: "Sirocco-1",   lat:  37.50, lng:  14.10, status: "alive",   deployed: "2025-11-04" },
    { id: "BY-009", name: "Adria-1",     lat:  43.80, lng:  14.20, status: "offline", deployed: "2025-06-30" },
    { id: "BY-010", name: "Aegean-1",    lat:  38.10, lng:  24.60, status: "alive",   deployed: "2026-01-15" },
    { id: "BY-011", name: "Aegean-2",    lat:  37.00, lng:  26.40, status: "deploy",  deployed: "2026-04-28" },
    { id: "BY-012", name: "Tyrrhen-1",   lat:  39.80, lng:  12.30, status: "alive",   deployed: "2026-02-09" },
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
      const baseline = makeBaseline(b);
      return {
        ...b,
        reading: baseline,
        history: [],
        telemetry: [],
        last_contact: nowISO(),
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

  function startSim() {
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
    startSim, pauseSim, resumeSim, isPaused,
    setStatus, addBuoy, removeBuoy, sendCommand, resetFleet,
  };
})();
