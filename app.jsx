/* global React, ReactDOM, L, BuoyData, TopBar, Sidebar, DetailPanel, fmtTime */
/* global DiscoverScreen, ConfigureScreen, CommandScreen, OffloadScreen, Radar */
const { useState, useEffect, useRef, useMemo, useCallback } = React;

/* ====== Map view (Leaflet) ====== */
function MapView({ fleet, selectedId, onSelect, addMode, onAddAt, onCancelAdd }) {
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());

  useEffect(() => {
    if (mapRef.current) return;
    const map = L.map(mapEl.current, {
      center: [38, 14],
      zoom: 4,
      zoomControl: true,
      worldCopyJump: true,
      attributionControl: true,
    });
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png",
      { attribution: "© OpenStreetMap, © CARTO", subdomains: "abcd", maxZoom: 19 }
    ).addTo(map);
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png",
      { subdomains: "abcd", maxZoom: 19, pane: "shadowPane" }
    ).addTo(map);
    mapRef.current = map;
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = (e) => {
      if (addMode) onAddAt(e.latlng.lat, e.latlng.lng);
    };
    map.on("click", handler);
    map.getContainer().style.cursor = addMode ? "crosshair" : "";
    return () => map.off("click", handler);
  }, [addMode, onAddAt]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set();
    fleet.forEach(b => {
      seen.add(b.id);
      let marker = markersRef.current.get(b.id);
      const html = `
        <div class="buoy-marker status-${b.status} ${b.status==="alive"?"pulse":""} ${selectedId===b.id?"selected":""}">
          <div class="ring"></div>
          <div class="core"></div>
          <div class="label">${b.id}</div>
        </div>`;
      const icon = L.divIcon({
        className: "buoy-divicon",
        html,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      if (!marker) {
        marker = L.marker([b.lat, b.lng], { icon }).addTo(map);
        marker.on("click", () => onSelect(b.id));
        markersRef.current.set(b.id, marker);
      } else {
        marker.setLatLng([b.lat, b.lng]);
        marker.setIcon(icon);
      }
    });
    [...markersRef.current.keys()].forEach(id => {
      if (!seen.has(id)) {
        map.removeLayer(markersRef.current.get(id));
        markersRef.current.delete(id);
      }
    });
  }, [fleet, selectedId, onSelect]);

  useEffect(() => {
    const unsub = BuoyData.subscribeTx((id) => {
      const m = markersRef.current.get(id);
      if (!m) return;
      const el = m.getElement();
      if (!el) return;
      const inner = el.querySelector(".buoy-marker");
      if (!inner) return;
      inner.classList.add("tx-flash");
      setTimeout(() => inner.classList.remove("tx-flash"), 400);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!selectedId || !mapRef.current) return;
    const b = fleet.find(x => x.id === selectedId);
    if (b) mapRef.current.panTo([b.lat, b.lng], { animate: true, duration: 0.5 });
  }, [selectedId]);

  return (
    <div className="main">
      <div id="map" ref={mapEl} />
      {addMode && (
        <div className="add-mode-banner">
          Click anywhere on the ocean to deploy a new buoy
          <button onClick={onCancelAdd}>Cancel</button>
        </div>
      )}
    </div>
  );
}

/* ====== Iridium nav indicator + popover ====== */
function IridiumNav({ log, txCount }) {
  const [open, setOpen] = useState(false);
  const [tx, setTx] = useState(false);
  const bodyRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (txCount === 0) return;
    setTx(true);
    const t = setTimeout(() => setTx(false), 350);
    return () => clearTimeout(t);
  }, [txCount]);

  useEffect(() => {
    if (open && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [open, log]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const recent = log.slice(-100);
  return (
    <div className="iridium-nav" ref={wrapRef}>
      <button className={"iridium-nav-btn" + (open ? " open" : "")}
        onClick={() => setOpen(o => !o)}>
        <span className={"iridium-pulse" + (tx ? " tx" : "")} />
        <span className="label">SBD</span>
        <span className="count">{log.length}</span>
        <span className="caret">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="iridium-pop">
          <div className="iridium-pop-head">
            <div className="title">
              <span className="iridium-pulse" />
              Iridium ground-station console · {log.length} msg
            </div>
            <button className="clear" onClick={(e) => { e.stopPropagation(); BuoyData.resetFleet(); }}>
              Clear
            </button>
          </div>
          <div className="iridium-pop-body" ref={bodyRef}>
            {recent.length === 0 && (
              <div className="empty">Waiting for transmissions…</div>
            )}
            {recent.map((l, i) => (
              <div className="line" key={i}>
                <span className="ts">{fmtTime(l.t)}</span>{" "}
                <span className={l.kind === "rx" ? "rx-tag" : l.kind === "tx" ? "tx-tag" : "err-tag"}>
                  [{l.kind.toUpperCase()}]
                </span>{" "}
                {l.msg}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ====== Tweaks ====== */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "showLabels": true,
  "showLegend": true,
  "showConsole": true,
  "tickRate": "normal"
}/*EDITMODE-END*/;

function AppTweaks() {
  if (!window.useTweaks) return null;
  const [tweaks, setTweak] = window.useTweaks(TWEAK_DEFAULTS);

  useEffect(() => {
    document.body.classList.toggle("hide-marker-labels", !tweaks.showLabels);
    document.body.classList.toggle("hide-legend", !tweaks.showLegend);
    document.body.classList.toggle("hide-console", !tweaks.showConsole);
  }, [tweaks]);

  return (
    <window.TweaksPanel title="Tweaks">
      <window.TweakSection title="Display">
        <window.TweakToggle label="Buoy ID labels" value={tweaks.showLabels}
          onChange={v => setTweak("showLabels", v)} />
        <window.TweakToggle label="Map legend" value={tweaks.showLegend}
          onChange={v => setTweak("showLegend", v)} />
        <window.TweakToggle label="Iridium console" value={tweaks.showConsole}
          onChange={v => setTweak("showConsole", v)} />
      </window.TweakSection>
      <window.TweakSection title="Simulation">
        <window.TweakButton label="Reset fleet & log" onClick={() => BuoyData.resetFleet()} />
      </window.TweakSection>
    </window.TweaksPanel>
  );
}

/* ====================================================
   VESSEL CONNECT PANEL
   Full vessel UI integrated into the existing dashboard.
   Matches the dark theme of the main site.
   ==================================================== */

/* ── packet builder (mirrors nrf.h) ─────────────────── */
function buildPacket(cfg) {
  const pkt = new Array(32).fill(0);
  pkt[0] = (cfg.cmd || 0x01) & 0xFF;
  const ssid = (cfg.ssid || "").slice(0, 12);
  for (let i = 0; i < ssid.length; i++) pkt[1 + i] = ssid.charCodeAt(i);
  const pass = (cfg.password || "").slice(0, 12);
  for (let i = 0; i < pass.length; i++) pkt[13 + i] = pass.charCodeAt(i);
  const ip = cfg.ip || [192, 168, 137, 1];
  pkt[25] = ip[0]; pkt[26] = ip[1]; pkt[27] = ip[2]; pkt[28] = ip[3];
  const port = cfg.port || 5555;
  pkt[29] = (port >> 8) & 0xFF;
  pkt[30] =  port       & 0xFF;
  return pkt;
}
window.buildPacket = buildPacket;

/* ── vessel tab bar ─────────────────────────────────── */
const VESSEL_TABS = [
  { id: "discover",  label: "Discover"  },
  { id: "configure", label: "Configure" },
  { id: "command",   label: "Command"   },
  { id: "offload",   label: "Offload"   },
];

const DEMO_CONTACTS = [
  {
    id: "BY-G17", name: "Group17-Buoy",
    mac: "B1:B2:B3:B4:B5", channel: 76,
    online: true, rssi: -61, range: 0.38,
    pending: 96, battery: 12.8,
    pipe: "0xB1B2B3B4B5",
    lastContact: "just now",
    deployment: "2026-05-06",
    bearing: 45,
  },
];

function VesselPanel() {
  const [vesselTab,  setVesselTab]  = useState("discover");
  const [contacts,   setContacts]   = useState(DEMO_CONTACTS);
  const [selectedId, setSelectedId] = useState("BY-G17");
  const [sweeping,   setSweeping]   = useState(true);
  const [command,    setCommand]    = useState(0x01);
  const [txState,    setTxState]    = useState("idle");
  const [cmdReady,   setCmdReady]   = useState(false);

  const [config, setConfig] = useState({
    ssid:     "OTSILBUOY",
    password: "buoytest12345",
    ip:       [192, 168, 137, 1],
    port:     5555,
  });

  // Wait for BuoyCommands
  useEffect(() => {
    if (window.BuoyCommands) { setCmdReady(true); return; }
    const handler = () => setCmdReady(true);
    window.addEventListener("buoycommands:ready", handler);
    return () => window.removeEventListener("buoycommands:ready", handler);
  }, []);

  // Live contacts from Firebase
  useEffect(() => {
    if (!cmdReady) return;
    const unsub = window.BuoyCommands.subscribeContacts((live) => {
      if (live.length > 0) setContacts(live);
    });
    return unsub;
  }, [cmdReady]);

  // Live offload status
  useEffect(() => {
    if (!cmdReady) return;
    const unsub = window.BuoyCommands.subscribeStatus((s) => {
      if (!s || !s.state) return;
      if (s.state === "tx_nrf")    setTxState("tx");
      if (s.state === "nrf_ack")   setTxState("ack");
      if (s.state === "nrf_fail")  setTxState("fail");
      if (s.state === "complete")  setTxState("idle");
      if (s.state === "streaming" || s.state === "connected") {
        setVesselTab("offload");
      }
    });
    return unsub;
  }, [cmdReady]);

  const handleFire = useCallback((cmdCode, cfg) => {
    if (!cmdReady) { alert("Firebase not ready"); return; }
    setTxState("tx");
    window.BuoyCommands.sendCommand(cfg, cmdCode);
    setTimeout(() => setVesselTab("offload"), 600);
  }, [cmdReady]);

  return (
    <div className="vessel-panel">
      {/* vessel tab bar — styled to match existing site */}
      <div className="vessel-tabbar">
        <div className="vessel-tabbar-left">
          {VESSEL_TABS.map(t => (
            <button key={t.id}
              className={"vessel-tab" + (vesselTab === t.id ? " active" : "")}
              onClick={() => setVesselTab(t.id)}>
              {t.label}
              {t.id === "offload" && txState === "tx" && (
                <span className="vessel-tab-dot" />
              )}
            </button>
          ))}
        </div>
        <div className={"vessel-fb-pill" + (cmdReady ? " ok" : "")}>
          <span className="vessel-fb-dot" />
          {cmdReady ? "Firebase live" : "connecting…"}
        </div>
      </div>

      {/* screen content */}
      <div className="vessel-screen">
        {vesselTab === "discover" && (
          <DiscoverScreen
            contacts={contacts}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            sweeping={sweeping}
            setSweeping={setSweeping}
            onProceed={() => setVesselTab("configure")}
          />
        )}
        {vesselTab === "configure" && (
          <ConfigureScreen config={config} setConfig={setConfig} />
        )}
        {vesselTab === "command" && (
          <CommandScreen
            config={config}
            command={command}
            setCommand={setCommand}
            onFire={handleFire}
            txState={txState}
          />
        )}
        {vesselTab === "offload" && (
          <OffloadScreen />
        )}
      </div>
    </div>
  );
}

/* ====== App root ====== */
function App() {
  const [fleet,      setFleet]      = useState(BuoyData.getFleet());
  const [log,        setLog]        = useState(BuoyData.getLog());
  const [selectedId, setSelectedId] = useState(null);
  const [addMode,    setAddMode]    = useState(false);
  const [paused,     setPaused]     = useState(false);
  const [txCount,    setTxCount]    = useState(0);
  const [mode,       setMode]       = useState("fleet");  // "fleet" | "vessel"

  useEffect(() => {
    const u1 = BuoyData.subscribe(setFleet);
    const u2 = BuoyData.subscribeLog(setLog);
    const u3 = BuoyData.subscribeTx(() => setTxCount(c => c + 1));
    BuoyData.startSim();
    return () => { u1(); u2(); u3(); };
  }, []);

  const selected = useMemo(
    () => fleet.find(b => b.id === selectedId) || null,
    [fleet, selectedId]
  );

  const onAdd = () => { setAddMode(true); setSelectedId(null); };
  const onAddAt = (lat, lng) => {
    const b = BuoyData.addBuoy({ lat, lng });
    setAddMode(false);
    setSelectedId(b.id);
  };
  const onTogglePause = () => {
    if (paused) { BuoyData.resumeSim(); setPaused(false); }
    else        { BuoyData.pauseSim();  setPaused(true);  }
  };
  const onReset = () => {
    if (confirm("Reset fleet and clear telemetry log?")) BuoyData.resetFleet();
  };

  return (
    <div className="app">
      {/* ── Top bar with mode switcher ── */}
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark" />
          <div className="brand-name">
            Buoy Fleet <span>Iridium SBD ground station</span>
          </div>
        </div>

        {/* Mode switcher — Fleet Map / Vessel Connect */}
        <div className="mode-switcher">
          <button
            className={"mode-btn" + (mode === "fleet" ? " active" : "")}
            onClick={() => setMode("fleet")}>
            Fleet Map
          </button>
          <button
            className={"mode-btn" + (mode === "vessel" ? " active" : "")}
            onClick={() => setMode("vessel")}>
            Vessel Connect
          </button>
        </div>

        {/* Existing top bar stats — only in fleet mode */}
        {mode === "fleet" && (
          <TopBarStats
            fleet={fleet}
            txCount={txCount}
            log={log}
            paused={paused}
            onTogglePause={onTogglePause}
            onReset={onReset}
          />
        )}
      </div>

      {/* ── Fleet mode ── */}
      {mode === "fleet" && (
        <>
          <Sidebar fleet={fleet} selectedId={selectedId} onSelect={setSelectedId}
            onAdd={onAdd} />
          <MapView fleet={fleet} selectedId={selectedId} onSelect={setSelectedId}
            addMode={addMode} onAddAt={onAddAt} onCancelAdd={() => setAddMode(false)} />
          {selected && (
            <DetailPanel
              buoy={selected}
              onClose={() => setSelectedId(null)}
              onStatus={(s) => BuoyData.setStatus(selected.id, s)}
              onCmd={(c) => BuoyData.sendCommand(selected.id, c)}
              onRemove={() => {
                if (confirm(`Decommission ${selected.id}?`)) {
                  BuoyData.removeBuoy(selected.id);
                  setSelectedId(null);
                }
              }}
            />
          )}
          <AppTweaks />
        </>
      )}

      {/* ── Vessel Connect mode ── */}
      {mode === "vessel" && <VesselPanel />}
    </div>
  );
}

/* ── TopBarStats extracted so it only renders in fleet mode ── */
function TopBarStats({ fleet, txCount, log, paused, onTogglePause, onReset }) {
  const counts = useMemo(() => {
    const c = { alive: 0, warn: 0, error: 0, offline: 0, deploy: 0 };
    fleet.forEach(b => c[b.status]++);
    return c;
  }, [fleet]);

  return (
    <div className="topbar-stats">
      <div className="stat">FLEET <b>{fleet.length}</b></div>
      <div className="stat" style={{ color: "#4ade80" }}>● ALIVE <b>{counts.alive}</b></div>
      <div className="stat" style={{ color: "#f5b948" }}>● WARN <b>{counts.warn}</b></div>
      <div className="stat" style={{ color: "#f06d6d" }}>● ERR <b>{counts.error}</b></div>
      <div className="stat" style={{ color: "#7f8c98" }}>● OFF <b>{counts.offline}</b></div>
      <div className="stat" style={{ color: "#6aa9ff" }}>● DEP <b>{counts.deploy}</b></div>
      <IridiumNav log={log} txCount={txCount} />
      <button className="status-pill" style={{ flex: "none", padding: "4px 10px", marginLeft: 8 }}
        onClick={onTogglePause}>{paused ? "▶ Resume" : "❚❚ Pause"}</button>
      <button className="status-pill" style={{ flex: "none", padding: "4px 10px" }}
        onClick={onReset}>Reset</button>
    </div>
  );
}

Object.assign(window, { IridiumNav });

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
