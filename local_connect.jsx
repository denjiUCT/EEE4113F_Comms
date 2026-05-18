/* global React, BuoyData, fmtTime */

const {
  useEffect: lcUseEffect,
  useMemo: lcUseMemo,
  useRef: lcUseRef,
  useState: lcUseState,
} = React;

const LC_COMMANDS = [
  {
    code: 0x01,
    key: "offload",
    name: "CMD_OFFLOAD",
    label: "Offload sensor packets",
    desc: "Wake buoy, join the laptop hotspot, and stream pending records to the ground station.",
  },
  {
    code: 0x02,
    key: "ping",
    name: "CMD_PING",
    label: "Ping buoy",
    desc: "Verify NRF link and IRQ wake without opening a WiFi session.",
  },
  {
    code: 0x03,
    key: "reset",
    name: "CMD_RESET_READ_PTR",
    label: "Reset read pointer",
    desc: "Rewind flash read pointer so the next offload replays buffered records.",
  },
];

const LC_TIMELINE = [
  { t: "T+0", tag: "S1", name: "NRF tx" },
  { t: "T+5 ms", tag: "S2", name: "IRQ wake" },
  { t: "T+300 ms", tag: "S3", name: "Boot" },
  { t: "T+500 ms", tag: "S4", name: "Sample" },
  { t: "T+1.5 s", tag: "S5", name: "WiFi join" },
  { t: "T+2.0 s", tag: "S6", name: "HTTP open" },
  { t: "T+2.2 s", tag: "S7", name: "POST /data" },
  { t: "T+2.6 s", tag: "S8", name: "Firebase write" },
];

function lcAsciiBytes(text, width) {
  const bytes = Array(width).fill(0);
  String(text || "").slice(0, width).split("").forEach((ch, i) => {
    bytes[i] = ch.charCodeAt(0) & 0x7f;
  });
  return bytes;
}

function lcBuildPacket(config) {
  const bytes = Array(32).fill(0);
  bytes[0] = Number(config.cmd || 0x01) & 0xff;
  lcAsciiBytes(config.ssid, 12).forEach((b, i) => { bytes[1 + i] = b; });
  lcAsciiBytes(config.password, 12).forEach((b, i) => { bytes[13 + i] = b; });
  (config.ip || [192, 168, 137, 1]).slice(0, 4).forEach((b, i) => {
    bytes[25 + i] = Math.max(0, Math.min(255, Number(b) || 0));
  });
  const port = Math.max(1, Math.min(65535, Number(config.port) || 5000));
  bytes[29] = (port >> 8) & 0xff;
  bytes[30] = port & 0xff;
  return bytes;
}

function lcDecodeRecord(buf) {
  const view = buf instanceof DataView ? buf : new DataView(buf);
  const scale = (offset) => {
    const raw = view.getInt16(offset, false);
    return raw === -32768 ? null : raw / 100;
  };
  return {
    do_mgL: scale(0),
    water_temp: scale(2),
    fluorescence: scale(4),
    int_temp: scale(6),
    int_humidity: scale(8),
    battery_v: scale(10),
    timestamp_s: view.getUint32(12, false),
  };
}

function lcHex(n) {
  return Number(n || 0).toString(16).toUpperCase().padStart(2, "0");
}

function lcNow() {
  return new Date().toLocaleTimeString("en-ZA", { hour12: false });
}

function lcContactFromBuoy(buoy, i) {
  const reading = buoy.reading || {};
  const last = buoy.last_contact ? new Date(buoy.last_contact).getTime() : 0;
  const online = buoy.status !== "offline" && (!last || Date.now() - last < 15 * 60 * 1000);
  return {
    id: buoy.id,
    name: buoy.name || buoy.id,
    online,
    range: Math.min(0.92, 0.22 + i * 0.11),
    bearing: (320 + i * 41) % 360,
    rssi: online ? Math.round(-42 - i * 5 - Math.random() * 4) : null,
    pipe: "0xB1B2B3B4B5",
    mac: `BY:${String(i + 17).padStart(2, "0")}:G17`,
    channel: 76,
    pending: Math.max(1, Math.round((buoy.history || []).length || 12)),
    battery: Number(reading.battery_v || 12.8),
    lastContact: buoy.last_contact ? fmtTime(buoy.last_contact) : "never",
    deployment: buoy.deployed || "2026-05-06",
  };
}

function LocalRadar({ contacts, selectedId, onSelect, sweeping }) {
  const [angle, setAngle] = lcUseState(0);
  const lastTs = lcUseRef(0);

  lcUseEffect(() => {
    if (!sweeping) return undefined;
    let frame = 0;
    const tick = (ts) => {
      if (!lastTs.current) lastTs.current = ts;
      const dt = ts - lastTs.current;
      lastTs.current = ts;
      setAngle(a => (a + dt * 0.08) % 360);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [sweeping]);

  const cx = 250;
  const cy = 250;
  const maxR = 220;

  return (
    <section className="lc-radar">
      <div className="lc-radar-head">
        <div>CHANNEL <b>76 · 2.476 GHz</b></div>
        <div>BEARING <b>{String(Math.round(angle)).padStart(3, "0")}°</b></div>
      </div>
      <svg className="lc-radar-svg" viewBox="0 0 500 500" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="lc-rgrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(77,214,225,0.18)" />
            <stop offset="100%" stopColor="rgba(77,214,225,0.02)" />
          </radialGradient>
          <linearGradient id="lc-sweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(77,214,225,0)" />
            <stop offset="100%" stopColor="rgba(125,230,238,0.52)" />
          </linearGradient>
        </defs>
        <circle cx={cx} cy={cy} r={maxR} fill="url(#lc-rgrad)" />
        {[0.25, 0.5, 0.75, 1].map((r, i) => (
          <g key={r}>
            <circle cx={cx} cy={cy} r={r * maxR} fill="none"
              stroke="rgba(77,214,225,0.18)" strokeDasharray={i === 3 ? "0" : "2 4"} />
            <text x={cx + 8} y={cy - r * maxR + 4} className="lc-svg-label">
              {["250m", "500m", "750m", "1.0km"][i]}
            </text>
          </g>
        ))}
        <line x1={cx - maxR} y1={cy} x2={cx + maxR} y2={cy} className="lc-cross" />
        <line x1={cx} y1={cy - maxR} x2={cx} y2={cy + maxR} className="lc-cross" />
        {Array.from({ length: 36 }).map((_, i) => {
          const a = i * 10 * Math.PI / 180;
          return (
            <line key={i}
              x1={cx + Math.cos(a) * (maxR - 6)}
              y1={cy + Math.sin(a) * (maxR - 6)}
              x2={cx + Math.cos(a) * maxR}
              y2={cy + Math.sin(a) * maxR}
              stroke={i % 9 === 0 ? "rgba(125,230,238,0.72)" : "rgba(77,214,225,0.28)"}
              strokeWidth="1" />
          );
        })}
        {sweeping && (
          <g transform={`rotate(${angle - 90} ${cx} ${cy})`}>
            <path d={`M ${cx} ${cy} L ${cx + maxR} ${cy} A ${maxR} ${maxR} 0 0 0 ${cx + maxR * 0.7} ${cy - maxR * 0.7} Z`}
              fill="url(#lc-sweep)" />
            <line x1={cx} y1={cy} x2={cx + maxR} y2={cy} stroke="#7de6ee" strokeWidth="1.2" />
          </g>
        )}
        <circle cx={cx} cy={cy} r="5" fill="#7de6ee" />
        <text x={cx} y={cy + 28} textAnchor="middle" className="lc-svg-label">FOG NODE</text>
        {contacts.map(c => {
          const a = c.bearing * Math.PI / 180;
          const r = c.range * maxR;
          const x = cx + Math.cos(a - Math.PI / 2) * r;
          const y = cy + Math.sin(a - Math.PI / 2) * r;
          const selected = c.id === selectedId;
          const delta = Math.abs(((angle - c.bearing) + 540) % 360 - 180);
          const strength = c.online ? Math.max(0.38, 1 - delta / 70) : 0.3;
          return (
            <g key={c.id} onClick={() => onSelect(c.id)} className="lc-contact">
              <circle cx={x} cy={y} r={selected ? 9 : 6}
                fill={c.online ? "#4dd6e1" : "#54697a"}
                opacity={strength}
                stroke={selected ? "#e6eef5" : "transparent"}
                strokeWidth="2" />
              {selected && <circle cx={x} cy={y} r="15" fill="none" stroke="#7de6ee" strokeDasharray="2 2" />}
              <text x={x + 13} y={y - 7} className="lc-contact-name">{c.name}</text>
              <text x={x + 13} y={y + 6} className="lc-svg-label">
                {c.online ? `${Math.round(c.range * 1000)}m · ${c.rssi}dBm` : "offline"}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="lc-radar-foot">
        <span>{contacts.filter(c => c.online).length} contacts online</span>
        <span>NRF24L01+ · 250 kbps · pipe 0xB1B2B3B4B5</span>
      </div>
    </section>
  );
}

function LocalDiscover({ contacts, selectedId, setSelectedId, sweeping, setSweeping, onProceed }) {
  const selected = contacts.find(c => c.id === selectedId);
  return (
    <div className="lc-discover">
      <LocalRadar contacts={contacts} selectedId={selectedId} onSelect={setSelectedId} sweeping={sweeping} />
      <aside className="lc-side">
        <section className="lc-panel">
          <header><span>Registered buoys</span><b>{contacts.filter(c => c.online).length}/{contacts.length}</b></header>
          <div className="lc-list">
            {contacts.map(c => (
              <button key={c.id} className={"lc-contact-row" + (c.id === selectedId ? " active" : "") + (c.online ? "" : " offline")}
                onClick={() => setSelectedId(c.id)}>
                <span className="lc-dot" />
                <span><b>{c.name}</b><small>{c.mac} · ch{c.channel}</small></span>
                <span>{c.online ? `${c.rssi} dBm` : "offline"}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="lc-panel">
          <header><span>Selected</span><b>{selected?.online ? "ONLINE" : "OFFLINE"}</b></header>
          {selected ? (
            <dl className="lc-kv">
              <dt>Pipe address</dt><dd>{selected.pipe}</dd>
              <dt>RF channel</dt><dd>{selected.channel} · 2.476 GHz</dd>
              <dt>Pending packets</dt><dd>{selected.pending}</dd>
              <dt>Battery</dt><dd>{selected.battery.toFixed(2)} V</dd>
              <dt>Last contact</dt><dd>{selected.lastContact}</dd>
              <dt>Deployment</dt><dd>{selected.deployment}</dd>
            </dl>
          ) : <p className="lc-muted">Select a buoy contact to begin.</p>}
        </section>
        <div className="lc-actions">
          <button className="lc-btn ghost" onClick={() => setSweeping(s => !s)}>{sweeping ? "Halt sweep" : "Resume sweep"}</button>
          <button className="lc-btn" disabled={!selected?.online} onClick={onProceed}>Open session</button>
        </div>
      </aside>
    </div>
  );
}

function LocalConfigure({ config, setConfig }) {
  const bytes = lcUseMemo(() => lcBuildPacket(config), [config]);
  return (
    <div className="lc-grid2">
      <section className="lc-panel">
        <header><span>WiFi destination</span><b>HTTP / Flask</b></header>
        <label className="lc-field">SSID<input maxLength="12" value={config.ssid}
          onChange={e => setConfig({ ...config, ssid: e.target.value })} /></label>
        <label className="lc-field">Passphrase<input maxLength="12" value={config.password}
          onChange={e => setConfig({ ...config, password: e.target.value })} /></label>
        <div className="lc-iprow">
          {config.ip.map((part, i) => (
            <input key={i} value={part} onChange={e => {
              const next = config.ip.slice();
              next[i] = Math.max(0, Math.min(255, parseInt(e.target.value || "0", 10) || 0));
              setConfig({ ...config, ip: next });
            }} />
          ))}
        </div>
        <label className="lc-field">Flask port<input type="number" min="1" max="65535" value={config.port}
          onChange={e => setConfig({ ...config, port: parseInt(e.target.value || "5000", 10) })} /></label>
        <label className="lc-field">Server base URL<input value={config.serverBase}
          onChange={e => setConfig({ ...config, serverBase: e.target.value })} /></label>
      </section>
      <LocalPacket bytes={bytes} title="32-byte payload preview" />
    </div>
  );
}

function LocalCommand({ config, command, setCommand, onFire, txState }) {
  const cmd = LC_COMMANDS.find(c => c.code === command) || LC_COMMANDS[0];
  return (
    <div className="lc-grid2">
      <section className="lc-panel">
        <header><span>Select command</span><b>VESSEL → BUOY</b></header>
        <div className="lc-cmds">
          {LC_COMMANDS.map(c => (
            <button key={c.code} className={command === c.code ? "active" : ""} onClick={() => setCommand(c.code)}>
              <span />
              <b>{c.label}</b>
              <small>{c.name} · {c.desc}</small>
              <code>0x{lcHex(c.code)}</code>
            </button>
          ))}
        </div>
        <button className="lc-btn wide" disabled={txState === "tx"} onClick={onFire}>
          {txState === "tx" ? "Transmitting..." : `Transmit ${cmd.name}`}
        </button>
      </section>
      <LocalPacket bytes={lcBuildPacket({ ...config, cmd: command })} title="Payload that will be transmitted" />
    </div>
  );
}

function LocalPacket({ bytes, title }) {
  const cls = (i) => i === 0 ? "cmd" : i <= 12 ? "ssid" : i <= 24 ? "pass" : i <= 28 ? "ip" : i <= 30 ? "port" : "rsv";
  return (
    <section className="lc-packet">
      <header><span>{title}</span><b>{bytes.length} B</b></header>
      <div className="lc-bytes">
        {bytes.map((b, i) => <span key={i} className={cls(i)} data-i={lcHex(i)}>{lcHex(b)}</span>)}
      </div>
      <p>CMD · SSID[12] · PASS[12] · IPv4[4] · PORT[2] · RSV[1], all fixed width.</p>
    </section>
  );
}

function LocalOffload({ run }) {
  return (
    <div className="lc-offload">
      <section className="lc-timeline">
        {LC_TIMELINE.map((s, i) => (
          <div key={s.tag} className={i < run.step ? "done" : i === run.step ? "active" : ""}>
            <b>{s.tag}</b><span>{s.name}</span><small>{s.t}</small>
          </div>
        ))}
      </section>
      <section className="lc-stream">
        <header><span>Ground station stream</span><b>{run.state}</b></header>
        <div>
          {run.lines.map((line, i) => (
            <p key={i}><time>{line.t}</time><b>{line.tag}</b><span>{line.msg}</span></p>
          ))}
        </div>
      </section>
      <aside className="lc-metrics">
        <div><span>Progress</span><b>{Math.round(run.progress * 100)}%</b><meter min="0" max="1" value={run.progress} /></div>
        <div><span>Packets</span><b>{run.packetsRx}/{run.totalPackets}</b></div>
        <div><span>Bytes</span><b>{run.bytes}</b></div>
        <div><span>Throughput</span><b>{run.throughput.toFixed(1)} KB/s</b></div>
      </aside>
    </div>
  );
}

function LocalData({ readings, onRefresh, onPostSample, busy }) {
  const latest = readings[0]?.reading || {};
  return (
    <div className="lc-data">
      <section className="lc-table">
        <header>
          <span>Server readings</span>
          <div>
            <button className="lc-mini-btn" onClick={onRefresh} disabled={busy}>Refresh</button>
            <button className="lc-mini-btn" onClick={onPostSample} disabled={busy}>POST sample</button>
          </div>
        </header>
        <div className="lc-table-head"><span>Time</span><span>Temp</span><span>Salinity</span><span>DO</span><span>Battery</span></div>
        <div className="lc-table-body">
          {readings.map((row, i) => (
            <div key={i}>
              <span>{fmtTime(row.received_at)}</span>
              <span>{row.reading?.water_temp ?? "-"} °C</span>
              <span>{row.reading?.salinity ?? "-"}</span>
              <span>{row.reading?.do_mgL ?? "-"}</span>
              <span>{row.reading?.battery_pct ?? "-"}%</span>
            </div>
          ))}
          {readings.length === 0 && <p className="lc-muted">No Flask readings yet. Run `python buoy_server.py`, then post a sample.</p>}
        </div>
      </section>
      <aside className="lc-metrics">
        <div><span>Latest water temp</span><b>{latest.water_temp ?? "-"} °C</b></div>
        <div><span>Latest salinity</span><b>{latest.salinity ?? "-"}</b></div>
        <div><span>Latest DO</span><b>{latest.do_mgL ?? "-"} mg/L</b></div>
        <div><span>Latest battery</span><b>{latest.battery_pct ?? "-"}%</b></div>
      </aside>
    </div>
  );
}

function LocalConnectApp({ fleet }) {
  const contacts = lcUseMemo(() => {
    const source = fleet.length ? fleet : [{
      id: "BY-G17",
      name: "Group17-Buoy",
      status: "alive",
      deployed: "2026-05-06",
      last_contact: new Date().toISOString(),
      reading: { battery_v: 12.8 },
      history: Array(18).fill(0),
    }];
    return source.slice(0, 8).map(lcContactFromBuoy);
  }, [fleet]);

  const [screen, setScreen] = lcUseState("discover");
  const [selectedId, setSelectedId] = lcUseState(contacts[0]?.id || "BY-G17");
  const [sweeping, setSweeping] = lcUseState(true);
  const [command, setCommand] = lcUseState(0x01);
  const [txState, setTxState] = lcUseState("idle");
  const [busy, setBusy] = lcUseState(false);
  const [readings, setReadings] = lcUseState([]);
  const [config, setConfig] = lcUseState({
    cmd: 0x01,
    ssid: "EEE4113F",
    password: "oceanbuoy",
    ip: [192, 168, 137, 1],
    port: 5000,
    serverBase: "http://localhost:5000",
  });
  const [run, setRun] = lcUseState({
    step: 0,
    progress: 0,
    packetsRx: 0,
    totalPackets: 20,
    bytes: 0,
    throughput: 0,
    state: "IDLE",
    lines: [{ t: lcNow(), tag: "READY", msg: "Waiting for a local offload command." }],
  });

  lcUseEffect(() => {
    if (!contacts.find(c => c.id === selectedId) && contacts[0]) setSelectedId(contacts[0].id);
  }, [contacts, selectedId]);

  async function refreshReadings() {
    setBusy(true);
    try {
      const res = await fetch(`${config.serverBase.replace(/\/$/, "")}/readings`);
      if (!res.ok) throw new Error(`GET /readings returned ${res.status}`);
      const body = await res.json();
      setReadings((body.items || []).slice().reverse());
      setRun(r => ({
        ...r,
        lines: [{ t: lcNow(), tag: "HTTP", msg: `Fetched ${body.count || 0} buffered readings from Flask.` }, ...r.lines].slice(0, 80),
      }));
    } catch (err) {
      setRun(r => ({
        ...r,
        lines: [{ t: lcNow(), tag: "ERR", msg: err.message }, ...r.lines].slice(0, 80),
      }));
    } finally {
      setBusy(false);
    }
  }

  async function postSample() {
    setBusy(true);
    const sample = {
      temperature: Number((22.5 + Math.random() * 2).toFixed(2)),
      conductivity: Number((34.8 + Math.random()).toFixed(2)),
      do_mgL: Number((7 + Math.random() * 0.5).toFixed(2)),
      battery_pct: Math.round(82 + Math.random() * 10),
      battery_v: Number((12.5 + Math.random() * 0.3).toFixed(2)),
      int_temp: Number((23.5 + Math.random()).toFixed(2)),
      int_humidity: Number((51 + Math.random() * 4).toFixed(2)),
      latitude: -33.9249,
      longitude: 18.4241,
    };
    try {
      const res = await fetch(`${config.serverBase.replace(/\/$/, "")}/data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sample),
      });
      if (!res.ok) throw new Error(`POST /data returned ${res.status}`);
      setRun(r => ({
        ...r,
        lines: [{ t: lcNow(), tag: "POST", msg: `Sample accepted: ${sample.temperature} C, ${sample.conductivity} PSU.` }, ...r.lines].slice(0, 80),
      }));
      await refreshReadings();
    } catch (err) {
      setRun(r => ({
        ...r,
        lines: [{ t: lcNow(), tag: "ERR", msg: err.message }, ...r.lines].slice(0, 80),
      }));
    } finally {
      setBusy(false);
    }
  }

  function fireCommand() {
    const selected = contacts.find(c => c.id === selectedId);
    setTxState("tx");
    setScreen("offload");
    setRun({
      step: 0,
      progress: 0,
      packetsRx: 0,
      totalPackets: selected?.pending || 20,
      bytes: 0,
      throughput: 0,
      state: "TX",
      lines: [{ t: lcNow(), tag: "NRF", msg: `Transmitting command 0x${lcHex(command)} to ${selectedId}.` }],
    });

    LC_TIMELINE.forEach((s, i) => {
      setTimeout(() => {
        setRun(r => {
          const packets = Math.min(r.totalPackets, Math.round((i + 1) / LC_TIMELINE.length * r.totalPackets));
          return {
            ...r,
            step: i,
            progress: (i + 1) / LC_TIMELINE.length,
            packetsRx: packets,
            bytes: packets * 16,
            throughput: 5 + i * 1.8,
            state: i >= LC_TIMELINE.length - 1 ? "COMPLETE" : "RUNNING",
            lines: [{ t: lcNow(), tag: s.tag, msg: s.name }, ...r.lines].slice(0, 80),
          };
        });
        if (i === LC_TIMELINE.length - 1) {
          setTxState("idle");
          refreshReadings();
        }
      }, i * 430);
    });
  }

  const tabs = [
    ["discover", "Discover"],
    ["configure", "Configure"],
    ["command", "Command"],
    ["offload", "Offload"],
    ["data", "Data"],
  ];

  return (
    <main className="local-connect">
      <nav className="lc-nav">
        <div>
          <b>Local Buoy Connect</b>
          <span>Fog node control panel · BY-G17 · Flask {config.port}</span>
        </div>
        <div>
          {tabs.map(([key, label]) => (
            <button key={key} className={screen === key ? "active" : ""} onClick={() => setScreen(key)}>{label}</button>
          ))}
        </div>
      </nav>
      <section className="lc-content">
        {screen === "discover" && (
          <LocalDiscover contacts={contacts} selectedId={selectedId} setSelectedId={setSelectedId}
            sweeping={sweeping} setSweeping={setSweeping} onProceed={() => setScreen("configure")} />
        )}
        {screen === "configure" && <LocalConfigure config={config} setConfig={setConfig} />}
        {screen === "command" && <LocalCommand config={config} command={command} setCommand={setCommand} onFire={fireCommand} txState={txState} />}
        {screen === "offload" && <LocalOffload run={run} />}
        {screen === "data" && <LocalData readings={readings} onRefresh={refreshReadings} onPostSample={postSample} busy={busy} />}
      </section>
    </main>
  );
}

Object.assign(window, { LocalConnectApp, lcBuildPacket, lcDecodeRecord });
