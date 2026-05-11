/* global React, ReactDOM, L, BuoyData */
const { useState, useEffect, useRef, useMemo, useCallback } = React;

/* ========= Helpers ========= */
const STATUS_LABELS = {
  alive: "Alive", warn: "Warning", error: "Error",
  offline: "Offline", deploy: "Deploying"
};
const STATUS_ORDER = ["alive", "warn", "error", "deploy", "offline"];

function fmtCoord(lat, lng) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(3)}°${ns}  ${Math.abs(lng).toFixed(3)}°${ew}`;
}
function fmtAgo(iso) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d/60)}m ago`;
  if (d < 86400) return `${Math.floor(d/3600)}h ago`;
  return `${Math.floor(d/86400)}d ago`;
}
function fmtTime(t) {
  const d = new Date(t);
  return d.toTimeString().slice(0, 8);
}

/* ========= Sparkline ========= */
function Sparkline({ data, color = "#4dd6e1", min, max }) {
  if (!data || data.length < 2) {
    return <svg className="sensor-spark" viewBox="0 0 100 36" preserveAspectRatio="none" />;
  }
  const lo = min !== undefined ? min : Math.min(...data);
  const hi = max !== undefined ? max : Math.max(...data);
  const span = hi - lo || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = 32 - ((v - lo) / span) * 28;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const area = `0,36 ${pts} 100,36`;
  return (
    <svg className="sensor-spark" viewBox="0 0 100 36" preserveAspectRatio="none">
      <polygon points={area} fill={color} fillOpacity="0.08" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.2"
        vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ========= Top bar ========= */
function TopBar({ fleet, txCount, log, paused, onTogglePause, onReset }) {
  const counts = useMemo(() => {
    const c = { alive: 0, warn: 0, error: 0, offline: 0, deploy: 0 };
    fleet.forEach(b => c[b.status]++);
    return c;
  }, [fleet]);

  const IridiumNav = window.IridiumNav;

  return (
    <div className="topbar">
      <div className="brand">
        <div className="brand-mark" />
        <div className="brand-name">Buoy Fleet <span>Iridium SBD ground station</span></div>
      </div>
      <div className="topbar-stats">
        <div className="stat">FLEET <b>{fleet.length}</b></div>
        <div className="stat" style={{color:"#4ade80"}}>● ALIVE <b>{counts.alive}</b></div>
        <div className="stat" style={{color:"#f5b948"}}>● WARN <b>{counts.warn}</b></div>
        <div className="stat" style={{color:"#f06d6d"}}>● ERR <b>{counts.error}</b></div>
        <div className="stat" style={{color:"#7f8c98"}}>● OFF <b>{counts.offline}</b></div>
        <div className="stat" style={{color:"#6aa9ff"}}>● DEP <b>{counts.deploy}</b></div>
        <button className="status-pill" style={{flex:"none", padding:"4px 10px", marginLeft:8}}
          onClick={onTogglePause}>{paused ? "▶ Resume" : "❚❚ Pause"}</button>
        <button className="status-pill" style={{flex:"none", padding:"4px 10px"}}
          onClick={onReset}>Reset</button>
      </div>
    </div>
  );
}

/* ========= Sidebar ========= */
function Sidebar({ fleet, selectedId, onSelect, onAdd }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");

  const filtered = fleet
    .filter(b => filter === "all" || b.status === filter)
    .filter(b =>
      !q ||
      b.id.toLowerCase().includes(q.toLowerCase()) ||
      b.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="sidebar-title">
          <span>Fleet · {fleet.length}</span>
          <button onClick={onAdd}>+ Add buoy</button>
        </div>
        <div className="search">
          <span className="search-icon" />
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search by ID or name…" />
        </div>
        <div className="filter-row">
          {[
            { k: "all", label: "All", c: "#b8c7d4" },
            { k: "alive", label: "Alive", c: "var(--st-alive)" },
            { k: "warn", label: "Warn", c: "var(--st-warn)" },
            { k: "error", label: "Error", c: "var(--st-error)" },
            { k: "deploy", label: "Deploy", c: "var(--st-deploy)" },
            { k: "offline", label: "Offline", c: "var(--st-offline)" },
          ].map(o => (
            <span key={o.k}
              className={"chip" + (filter === o.k ? " active" : "")}
              onClick={() => setFilter(o.k)}>
              <span className="dot" style={{ background: o.c }} />
              {o.label}
            </span>
          ))}
        </div>
      </div>
      <div className="sidebar-list">
        {filtered.map(b => (
          <div key={b.id}
            className={"buoy-row " + b.status + (selectedId === b.id ? " selected" : "")}
            onClick={() => onSelect(b.id)}>
            <div className={"status-dot status-" + b.status}
              style={{ background: `var(--st-${b.status})` }} />
            <div>
              <div className="name">{b.id} · {b.name}</div>
              <div className="meta">
                {b.lat.toFixed(2)}°, {b.lng.toFixed(2)}° · {STATUS_LABELS[b.status]}
              </div>
            </div>
            <div className="battery">
              {b.status === "deploy" ? "—" : Math.round(b.reading.battery_pct) + "%"}
              <div className="last">{b.status === "offline" ? "no link" : fmtAgo(b.last_contact)}</div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: "30px 14px", color: "var(--fg-3)", fontSize: 12, textAlign: "center" }}>
            No buoys match your filter.
          </div>
        )}
      </div>
    </aside>
  );
}

Object.assign(window, { Sparkline, TopBar, Sidebar, fmtCoord, fmtAgo, fmtTime, STATUS_LABELS, STATUS_ORDER });
