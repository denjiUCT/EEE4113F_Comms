/* global React, ReactDOM, L, BuoyData, TopBar, Sidebar, DetailPanel, fmtTime */
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
      if (addMode) {
        onAddAt(e.latlng.lat, e.latlng.lng);
      }
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

/* ====== Tweaks (variations) ====== */
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

/* ====== App root ====== */
function App() {
  const [fleet, setFleet] = useState(BuoyData.getFleet());
  const [log, setLog] = useState(BuoyData.getLog());
  const [selectedId, setSelectedId] = useState(null);
  const [addMode, setAddMode] = useState(false);
  const [paused, setPaused] = useState(false);
  const [txCount, setTxCount] = useState(0);
  const [mode, setMode] = useState("fleet");

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

  const onAdd = () => {
    setAddMode(true);
    setSelectedId(null);
  };
  const onAddAt = (lat, lng) => {
    const b = BuoyData.addBuoy({ lat, lng });
    setAddMode(false);
    setSelectedId(b.id);
  };
  const onTogglePause = () => {
    if (paused) { BuoyData.resumeSim(); setPaused(false); }
    else { BuoyData.pauseSim(); setPaused(true); }
  };
  const onReset = () => {
    if (confirm("Reset fleet and clear telemetry log?")) BuoyData.resetFleet();
  };

  return (
    <div className="app">
      <TopBar fleet={fleet} txCount={txCount} log={log}
        paused={paused} onTogglePause={onTogglePause} onReset={onReset}
        mode={mode} onModeChange={setMode} />
      {mode === "fleet" && (
        <>
          <Sidebar fleet={fleet} selectedId={selectedId} onSelect={setSelectedId}
            onAdd={onAdd} />
          <MapView fleet={fleet} selectedId={selectedId} onSelect={setSelectedId}
            addMode={addMode} onAddAt={onAddAt} onCancelAdd={() => setAddMode(false)} />
        </>
      )}
      {mode === "connect" && window.LocalConnectApp && <window.LocalConnectApp fleet={fleet} log={log} />}
      {mode === "fleet" && selected && (
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
    </div>
  );
}

Object.assign(window, { IridiumNav });

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
