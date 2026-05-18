/* global React, BuoyData, Sparkline, fmtCoord, fmtAgo, fmtTime, STATUS_LABELS */
const { useState: useStateD, useMemo: useMemoD } = React;

function StatusBar({ status, onChange }) {
  const opts = ["alive", "warn", "error", "offline"];
  return (
    <div className="status-bar">
      {opts.map(s => (
        <div key={s}
          className={"status-pill " + (status === s ? "active " + s : "")}
          onClick={() => onChange(s)}>
          {STATUS_LABELS[s]}
        </div>
      ))}
    </div>
  );
}

// Coerce possibly-missing Firebase/hardware fields to a safe number so the
// panel never crashes on .toFixed() when the ESP32 omits a sensor.
const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

function OverviewTab({ buoy }) {
  const raw = buoy.reading || {};
  const r = {
    water_temp:   n(raw.water_temp),
    do_mgL:       n(raw.do_mgL),
    salinity:     n(raw.salinity),
    battery_pct:  n(raw.battery_pct),
    battery_v:    n(raw.battery_v),
    int_temp:     n(raw.int_temp),
    int_humidity: n(raw.int_humidity),
    heading:      n(raw.heading),
    drift_kn:     n(raw.drift_kn),
  };
  const hist = buoy.history || [];
  const battColor = r.battery_pct < 20 ? "var(--st-error)"
    : r.battery_pct < 40 ? "var(--st-warn)" : "var(--st-alive)";
  return (
    <React.Fragment>
      <div className="section">
        <div className="section-title">Position</div>
        <div className="kv-grid">
          <div className="kv">
            <div className="k">Coordinates</div>
            <div className="v" style={{fontSize:13}}>{fmtCoord(buoy.lat, buoy.lng)}</div>
          </div>
          <div className="kv">
            <div className="k">Heading / Drift</div>
            <div className="v">{Math.round(r.heading)}°<small>true</small> · {r.drift_kn.toFixed(2)}<small>kn</small></div>
          </div>
          <div className="kv">
            <div className="k">Last Contact</div>
            <div className="v" style={{fontSize:13}}>{buoy.status === "deploy" ? "—" : fmtAgo(buoy.last_contact)}</div>
          </div>
          <div className="kv">
            <div className="k">Deployed</div>
            <div className="v" style={{fontSize:13}}>{buoy.deployed}</div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-title">Ocean Sensors</div>
        <div className="sensor-card">
          <div className="sensor-head">
            <span className="sensor-name">Water Temperature</span>
            <span className="sensor-value">{r.water_temp.toFixed(2)}<small>°C</small></span>
          </div>
          <Sparkline data={hist.map(h => h.water_temp)} color="#4dd6e1" />
        </div>
        <div className="sensor-card">
          <div className="sensor-head">
            <span className="sensor-name">Dissolved Oxygen</span>
            <span className="sensor-value">{r.do_mgL.toFixed(2)}<small>mg/L</small></span>
          </div>
          <Sparkline data={hist.map(h => h.do_mgL)} color="#7be0a4" />
        </div>
        <div className="sensor-card">
          <div className="sensor-head">
            <span className="sensor-name">Salinity</span>
            <span className="sensor-value">{r.salinity.toFixed(2)}<small>PSU</small></span>
          </div>
          <Sparkline data={hist.map(h => h.salinity)} color="#c8a4ff" />
        </div>
      </div>

      <div className="section">
        <div className="section-title">System</div>
        <div className="sensor-card">
          <div className="sensor-head">
            <span className="sensor-name">Battery</span>
            <span className="sensor-value" style={{color: battColor}}>
              {r.battery_pct.toFixed(0)}<small>%</small> · {r.battery_v.toFixed(2)}<small>V</small>
            </span>
          </div>
          <div className="battery-bar">
            <div style={{width: r.battery_pct + "%", background: battColor}} />
          </div>
        </div>
        <div className="kv-grid" style={{marginTop:8}}>
          <div className="kv">
            <div className="k">Internal Temp</div>
            <div className={"v" + (r.int_temp > 40 ? " error" : r.int_temp > 35 ? " warn" : "")}>
              {r.int_temp.toFixed(1)}<small>°C</small>
            </div>
          </div>
          <div className="kv">
            <div className="k">Internal Humidity</div>
            <div className={"v" + (r.int_humidity > 80 ? " error" : r.int_humidity > 70 ? " warn" : "")}>
              {r.int_humidity.toFixed(0)}<small>%RH</small>
            </div>
          </div>
        </div>
      </div>
    </React.Fragment>
  );
}

function TelemetryTab({ buoy }) {
  return (
    <div className="section">
      <div className="section-title">Iridium SBD Log · {buoy.telemetry.length} messages</div>
      <div className="telemetry-log">
        {buoy.telemetry.length === 0 && (
          <div style={{color: "var(--fg-3)", fontSize: 11, padding: "20px 0", textAlign: "center"}}>
            No transmissions yet.
          </div>
        )}
        {buoy.telemetry.map((t, i) => (
          <div key={i} className="telemetry-row">
            <span className="ts">{fmtTime(t.t)}</span>
            <span className={"dir " + (t.dir === "tx" || t.dir === "cmd" ? "cmd" : "")}>
              {t.dir === "rx" ? "← MO" : t.dir === "tx" ? "→ MT" : "CMD"}
            </span>
            <span className="payload">{t.payload}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CommandTab({ buoy, onCmd, onRemove }) {
  const cmds = [
    { c: "PING", label: "Ping device" },
    { c: "SAMPLE_NOW", label: "Force sample" },
    { c: "SLEEP 3600", label: "Sleep for 1h" },
    { c: "REBOOT", label: "Reboot MCU" },
    { c: "GPS_FIX", label: "Force GPS fix" },
    { c: "FW_CHECK", label: "Check firmware" },
  ];
  return (
    <React.Fragment>
      <div className="section">
        <div className="section-title">Send Mobile-Terminated</div>
        <div className="cmd-panel">
          {cmds.map(o => (
            <button key={o.c} onClick={() => onCmd(o.c)}>
              <span style={{color:"var(--fg-2)"}}>$</span> {o.c}
              <span className="arrow">→</span>
            </button>
          ))}
        </div>
      </div>
      <div className="section">
        <div className="section-title">Lifecycle</div>
        <div className="cmd-panel">
          <button className="danger" onClick={onRemove}>
            Decommission &amp; remove buoy
            <span className="arrow">↗</span>
          </button>
        </div>
      </div>
    </React.Fragment>
  );
}

function DetailPanel({ buoy, onClose, onStatus, onCmd, onRemove }) {
  const [tab, setTab] = useStateD("overview");
  if (!buoy) return null;

  return (
    <div className="detail">
      <div className="detail-head">
        <div className="row1">
          <div>
            <div className="name">{buoy.name}</div>
            <div className="id">{buoy.id} · IMEI 30043410{buoy.id.slice(3)}{Math.abs(Math.round(buoy.lat*100))}</div>
          </div>
          <button className="detail-close" onClick={onClose}>×</button>
        </div>
        <StatusBar status={buoy.status} onChange={onStatus} />
      </div>
      <div className="detail-tabs">
        <button className={tab==="overview"?"active":""} onClick={()=>setTab("overview")}>Overview</button>
        <button className={tab==="telemetry"?"active":""} onClick={()=>setTab("telemetry")}>Telemetry</button>
        <button className={tab==="command"?"active":""} onClick={()=>setTab("command")}>Command</button>
      </div>
      <div className="detail-body">
        {tab === "overview" && <OverviewTab buoy={buoy} />}
        {tab === "telemetry" && <TelemetryTab buoy={buoy} />}
        {tab === "command" && <CommandTab buoy={buoy} onCmd={onCmd} onRemove={onRemove} />}
      </div>
    </div>
  );
}

Object.assign(window, { DetailPanel });
