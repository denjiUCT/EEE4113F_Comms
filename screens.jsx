/* screens.jsx — vessel UI screens wired to Firebase
   
   Changes from original:
   - CommandScreen: onFire now calls BuoyCommands.sendCommand()
   - OffloadScreen: reads live progress from Firebase offload_status
   - DiscoverScreen: contacts come from Firebase nrf_contacts
   - All simulation state replaced with real Firebase listeners
*/
const { useMemo: scrUseMemo, useState: scrUseState, useEffect: scrUseEffect,
        useRef: scrUseRef } = React;

/* ----------------------------------------------------------------- */
/* DISCOVER                                                           */
/* ----------------------------------------------------------------- */
function DiscoverScreen({ contacts, selectedId, setSelectedId, sweeping, setSweeping, onProceed }) {
  const sel = contacts.find(c => c.id === selectedId);

  // Subscribe to real contacts from Firebase
  scrUseEffect(() => {
    if (!window.BuoyCommands) return;
    // BuoyCommands.subscribeContacts is called by parent App
    // contacts prop is already live from Firebase
  }, []);

  return (
    <div className="discover">
      <Radar
        contacts={contacts}
        selectedId={selectedId}
        onSelect={setSelectedId}
        sweeping={sweeping}
      />

      <div className="side-panel">
        <div className="panel">
          <div className="panel-head">
            <span>Registered Buoys</span>
            <span>{contacts.filter(c => c.online).length}/{contacts.length}</span>
          </div>
          <div className="contact-list">
            {contacts.length === 0 && (
              <div style={{ color: "var(--ink-3)", fontSize: 12, padding: "16px 8px", textAlign: "center" }}>
                No buoys detected yet.<br />
                Start sweep to scan for contacts.
              </div>
            )}
            {contacts.map(c => (
              <div key={c.id}
                className={`contact-row ${selectedId === c.id ? "sel" : ""} ${c.online ? "" : "offline"}`}
                onClick={() => setSelectedId(c.id)}>
                <div className="blip" />
                <div>
                  <div className="name">{c.name}</div>
                  <div className="meta">{c.mac} · ch{c.channel}</div>
                </div>
                <div className="rssi">
                  {c.online
                    ? <>{c.rssi} dBm<br /><span style={{ color: "var(--ink-3)" }}>{(c.range * 1000).toFixed(0)} m</span></>
                    : "—"}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <span>Selected · {sel ? sel.name : "—"}</span>
            <span>{sel?.online ? "ONLINE" : "OFFLINE"}</span>
          </div>
          <div className="panel-body">
            {sel ? (
              <div className="kv-grid">
                <div className="k">Pipe address</div>
                <div className="v">{sel.pipe}</div>
                <div className="k">RF channel</div>
                <div className="v">{sel.channel} · 2.476 GHz</div>
                <div className="k">Data rate</div>
                <div className="v">250 kbps</div>
                <div className="k">PA level</div>
                <div className="v">LOW</div>
                <div className="k">Pending packets</div>
                <div className="v good">{sel.pending?.toLocaleString()}</div>
                <div className="k">Battery</div>
                <div className={`v ${sel.battery < 3.4 ? "warn" : ""}`}>{sel.battery?.toFixed(2)} V</div>
                <div className="k">Last contact</div>
                <div className="v">{sel.lastContact}</div>
                <div className="k">Deployment</div>
                <div className="v">{sel.deployment}</div>
              </div>
            ) : (
              <div style={{ color: "var(--ink-3)", fontSize: 13, padding: "8px 4px" }}>
                Tap a contact on the radar or select one from the list.
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn ghost" onClick={() => setSweeping(s => !s)} style={{ flex: 1 }}>
            {sweeping ? <><Icon.Stop /> Halt sweep</> : <><Icon.Play /> Resume sweep</>}
          </button>
          <button className="btn" disabled={!sel?.online} onClick={onProceed} style={{ flex: 1.4 }}>
            Open session →
          </button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* CONFIGURE                                                          */
/* ----------------------------------------------------------------- */
function ConfigureScreen({ config, setConfig }) {
  const bytes = scrUseMemo(() => buildPacket(config), [config]);

  const byteCategory = (i) => {
    if (i === 0) return "cmd";
    if (i >= 1 && i <= 12) return "ssid";
    if (i >= 13 && i <= 24) return "pass";
    if (i >= 25 && i <= 28) return "ip";
    if (i >= 29 && i <= 30) return "port";
    return "rsv";
  };

  return (
    <div className="cfg-grid">
      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head"><span>WiFi · Fog node hotspot</span><span>192.168.137.0/24</span></div>
        <div className="panel-body">
          <div className="field">
            <label>SSID <span style={{ color: "var(--ink-3)" }}>· max 12 chars</span></label>
            <input className="input" maxLength={12}
              value={config.ssid}
              onChange={e => setConfig({ ...config, ssid: e.target.value })} />
            <div className="hint">{config.ssid.length}/12 characters · ASCII only</div>
          </div>
          <div className="field">
            <label>Passphrase <span style={{ color: "var(--ink-3)" }}>· WPA2-PSK</span></label>
            <input className="input" maxLength={12}
              type="text"
              value={config.password}
              onChange={e => setConfig({ ...config, password: e.target.value })} />
            <div className="hint">{config.password.length}/12 characters</div>
          </div>

          <div style={{ height: 1, background: "var(--line)", margin: "18px 0" }} />

          <label style={{
            fontFamily: "var(--font-mono)", fontSize: 10.5, letterSpacing: "0.12em",
            textTransform: "uppercase", color: "var(--ink-2)", display: "block", marginBottom: 6
          }}>TCP server IPv4</label>
          <div className="row-3" style={{ marginBottom: 14 }}>
            {[0, 1, 2, 3].map(i => (
              <input key={i} className="input" style={{ textAlign: "center" }}
                value={config.ip[i]}
                onChange={e => {
                  const v = Math.max(0, Math.min(255, parseInt(e.target.value || "0", 10) || 0));
                  const next = [...config.ip]; next[i] = v;
                  setConfig({ ...config, ip: next });
                }} />
            ))}
          </div>
          <div className="field">
            <label>TCP port</label>
            <input className="input" type="number" min={1} max={65535}
              value={config.port}
              onChange={e => setConfig({ ...config, port: parseInt(e.target.value || "5555", 10) })} />
            <div className="hint">Big-endian on wire · 0x{config.port.toString(16).padStart(4, "0").toUpperCase()}</div>
          </div>
        </div>
      </div>

      <div>
        <div className="panel" style={{ padding: 0, marginBottom: 18 }}>
          <div className="panel-head"><span>NRF24L01+ Radio</span><span>FIXED</span></div>
          <div className="panel-body">
            <div className="kv-grid">
              <div className="k">Carrier</div><div className="v">2.476 GHz · ch 76</div>
              <div className="k">Data rate</div><div className="v">250 kbps</div>
              <div className="k">Modulation</div><div className="v">GFSK</div>
              <div className="k">CRC</div><div className="v">16-bit</div>
              <div className="k">PA</div><div className="v">RF24_PA_LOW</div>
              <div className="k">Payload</div><div className="v">32 B fixed</div>
              <div className="k">Auto-ACK</div><div className="v good">enabled · 15 retries</div>
              <div className="k">Pipe</div><div className="v">0xB1 B2 B3 B4 B5</div>
            </div>
          </div>
        </div>

        <div className="bytemap-wrap">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>32-byte payload preview</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-2)" }}>
              CRC{" "}<span style={{ color: "var(--accent-2)" }}>OK</span>
              {" · "}{bytes.length} B
            </div>
          </div>
          <div className="bytemap" style={{ marginTop: 22 }}>
            {bytes.map((b, i) => (
              <div key={i} className={`byte ${byteCategory(i)}`}>
                <span className="idx">{i.toString(16).toUpperCase().padStart(2, "0")}</span>
                {b.toString(16).toUpperCase().padStart(2, "0")}
              </div>
            ))}
          </div>
          <div className="legend">
            <div className="li"><span className="sw cmd" /> CMD</div>
            <div className="li"><span className="sw ssid" /> SSID</div>
            <div className="li"><span className="sw pass" /> PASS</div>
            <div className="li"><span className="sw ip" /> IP</div>
            <div className="li"><span className="sw port" /> PORT</div>
            <div className="li"><span className="sw rsv" /> RSV</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* COMMAND                                                            */
/* ----------------------------------------------------------------- */
function CommandScreen({ config, command, setCommand, onFire, txState }) {
  const opts = [
    { code: 0x01, name: "CMD_OFFLOAD", label: "Offload sensor packets",
      desc: "Wake buoy, connect WiFi using payload creds, stream all pending packets to embedded TCP endpoint." },
    { code: 0x02, name: "CMD_PING", label: "Ping buoy",
      desc: "Hardware ACK only · verifies radio link & confirms buoy IRQ wake without WiFi handshake." },
    { code: 0x03, name: "CMD_RESET_READ_PTR", label: "Reset flash read pointer",
      desc: "Rewinds rtc_flash_read_addr to 0. Next CMD_OFFLOAD will re-transmit the full circular buffer." },
  ];

  const cmdName = command === 0x01 ? "CMD_OFFLOAD"
                : command === 0x02 ? "CMD_PING"
                : "CMD_RESET_READ_PTR";

  const txLabel = txState === "tx"    ? "Transmitting…"
                : txState === "ack"   ? "ACK received ✓"
                : txState === "fail"  ? "TX failed — retry?"
                : `radio.write() → Transmit ${cmdName}`;

  return (
    <div className="cfg-grid">
      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head"><span>Select command</span><span>VESSEL → BUOY</span></div>
        <div className="panel-body">
          <div className="cmd-grid">
            {opts.map(o => (
              <div key={o.code}
                className={`cmd-opt ${command === o.code ? "sel" : ""}`}
                onClick={() => setCommand(o.code)}>
                <span className="radio" />
                <div>
                  <div className="label">{o.label}</div>
                  <div className="sub">{o.name} · {o.desc}</div>
                </div>
                <div className="code">0x{o.code.toString(16).padStart(2, "0").toUpperCase()}</div>
              </div>
            ))}
          </div>

          <div style={{ height: 1, background: "var(--line)", margin: "22px 0 18px" }} />

          <div className="kv-grid" style={{ marginBottom: 18 }}>
            <div className="k">Auto-ACK window</div><div className="v">56.25 ms · 15 retries × 3.75 ms</div>
            <div className="k">Expected ACK latency</div><div className="v">2 – 18 ms</div>
            <div className="k">EXT1 wakeup pin</div><div className="v">GPIO33 · active-low</div>
            <div className="k">Expected wake → ready</div><div className="v">≈ 500 ms (S2–S8)</div>
          </div>

          {/* Firebase status indicator */}
          <div style={{
            padding: "10px 12px", borderRadius: 6, marginBottom: 14,
            background: "var(--bg-0)", border: "1px solid var(--line)",
            fontFamily: "var(--font-mono)", fontSize: 11,
          }}>
            <span style={{ color: "var(--ink-3)" }}>// firebase commands/pending</span><br />
            <span style={{ color: "var(--ink-2)" }}>
              {txState === "idle" && "→ waiting for operator input"}
              {txState === "tx"   && <span style={{ color: "var(--warn)" }}>→ writing command to Firebase…</span>}
              {txState === "ack"  && <span style={{ color: "var(--good)" }}>→ tcp_server.py picked up command ✓</span>}
              {txState === "fail" && <span style={{ color: "var(--bad)" }}>→ NRF TX failed — no buoy ACK</span>}
            </span>
          </div>

          <button className="btn"
            onClick={() => onFire(command, config)}
            disabled={txState === "tx"}
            style={{ width: "100%", justifyContent: "center" }}>
            {txLabel}
          </button>
        </div>
      </div>

      <div className="bytemap-wrap">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Payload that will be transmitted</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-2)" }}>
            32 B · CRC-16
          </div>
        </div>
        <div className="bytemap" style={{ marginTop: 22 }}>
          {buildPacket({ ...config, cmd: command }).map((b, i) => {
            const cat = i === 0 ? "cmd" : i <= 12 ? "ssid" : i <= 24 ? "pass"
                      : i <= 28 ? "ip" : i <= 30 ? "port" : "rsv";
            return (
              <div key={i} className={`byte ${cat}`}>
                <span className="idx">{i.toString(16).toUpperCase().padStart(2, "0")}</span>
                {b.toString(16).toUpperCase().padStart(2, "0")}
              </div>
            );
          })}
        </div>

        <div style={{
          marginTop: 22, padding: "12px 14px",
          fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--ink-1)",
          background: "var(--bg-0)", border: "1px solid var(--line)", borderRadius: 6
        }}>
          <div style={{ color: "var(--ink-3)", marginBottom: 6 }}>// firebase_commands.js</div>
          <div><span style={{ color: "#7e94c4" }}>BuoyCommands</span>.<span style={{ color: "#7ee6dc" }}>sendCommand</span>(config, <span style={{ color: "#f0d895" }}>0x{command.toString(16).padStart(2,"0").toUpperCase()}</span>);</div>
          <div style={{ color: "var(--ink-3)", marginTop: 4 }}>// → writes to Firebase commands/pending</div>
          <div style={{ color: "var(--ink-3)" }}>// → tcp_server.py fires vessel ESP32</div>
          <div style={{ color: "var(--ink-3)" }}>// → ESP32 calls radio.write(payload, 32)</div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* OFFLOAD — reads live progress from Firebase offload_status        */
/* ----------------------------------------------------------------- */
const TIMELINE = [
  { t: "T+0",       tag: "S1", name: "NRF tx" },
  { t: "T+5 ms",    tag: "S2", name: "IRQ ↓ · ESP wakeup" },
  { t: "T+300 ms",  tag: "S3", name: "Boot complete" },
  { t: "T+400 ms",  tag: "S4", name: "Peripherals init" },
  { t: "T+500 ms",  tag: "S5", name: "Sensor sample" },
  { t: "T+510 ms",  tag: "S6", name: "Flash write" },
  { t: "T+1.5 s",   tag: "S7", name: "WiFi associated" },
  { t: "T+2.5 s",   tag: "S8", name: "TCP connected" },
  { t: "T+2.5 s",   tag: "S9", name: "Stream live" },
  { t: "T+3.5 s",   tag: "S10", name: "Stream complete" },
];

function OffloadScreen() {
  const [status, setStatus]     = scrUseState({});
  const [streamLog, setLog]     = scrUseState([]);
  const logRef                  = scrUseRef([]);

  // Subscribe to Firebase offload_status
  scrUseEffect(() => {
    if (!window.BuoyCommands) return;
    const unsub = window.BuoyCommands.subscribeStatus((s) => {
      setStatus(s);
    });

    // Subscribe to stream log separately
    if (window.firebaseDB && window.firebaseRef && window.firebaseOnValue) {
      const logUnsub = window.firebaseOnValue(
        window.firebaseRef(window.firebaseDB, "offload_status/stream_log"),
        (snap) => {
          const data = snap.val() || {};
          const entries = Object.values(data)
            .sort((a, b) => a.t - b.t)
            .slice(-50);
          logRef.current = entries;
          setLog([...entries]);
        }
      );
      return () => { unsub(); logUnsub(); };
    }
    return unsub;
  }, []);

  const packetsRx    = status.packets_rx   || 0;
  const totalPackets = status.total        || 0;
  const throughput   = status.throughput   || 0;
  const bytes        = status.bytes        || 0;
  const currentStep  = status.current_step || 0;
  const state        = status.state        || "idle";
  const progress     = totalPackets > 0 ? packetsRx / totalPackets : 0;

  const tcpStateLabel = currentStep >= 9 ? "FIN_ACK · session closed"
                      : currentStep >= 7 ? "ESTABLISHED · streaming"
                      : currentStep >= 6 ? "SYN_SENT"
                      : state === "tx_nrf" ? "NRF TX in progress"
                      : state === "nrf_ack" ? "NRF ACK · buoy booting"
                      : "—";

  return (
    <div className="offload">
      <div className="timeline">
        <div className="tl-head">
          <h3>Wake → offload sequence</h3>
          <div className="total">step {Math.min(currentStep + 1, TIMELINE.length)} of {TIMELINE.length}</div>
        </div>
        <div className="steps">
          {TIMELINE.map((s, i) => {
            const cls = i < currentStep ? "done" : i === currentStep ? "active" : "";
            return (
              <div key={i} className={`step ${cls}`}>
                <div className="s-tag">{s.tag}</div>
                <div className="s-name">{s.name}</div>
                <div className="s-t">{s.t}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="stream">
        <div className="stream-head">
          <h3>TCP 192.168.137.x → 192.168.137.1 : 5555</h3>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 11,
            color: state === "streaming" ? "var(--good)"
                 : state === "complete"  ? "var(--accent-2)"
                 : "var(--ink-2)"
          }}>
            {tcpStateLabel}
          </span>
        </div>
        <div className="stream-body">
          {streamLog.length === 0 && (
            <div style={{ color: "var(--ink-3)", fontSize: 11, padding: "20px 0", textAlign: "center" }}>
              {state === "idle" ? "Waiting for offload command…"
               : state === "tx_nrf" ? "Transmitting NRF packet to buoy…"
               : state === "nrf_ack" ? "NRF ACK received — buoy booting…"
               : "Waiting for TCP connection…"}
            </div>
          )}
          {streamLog.map((l, i) => (
            <div key={i} className={`stream-line ${l.level || ""}`}>
              <span className="t">{new Date(l.t).toTimeString().slice(0, 8)}</span>
              <span className="tag">{l.tag}</span>
              <span>{l.msg}</span>
            </div>
          ))}
        </div>
        <div className="stream-foot">
          <span>16 B records · no delimiter · raw binary</span>
          <span>{packetsRx.toLocaleString()} / {Math.max(totalPackets, packetsRx).toLocaleString()} packets · {bytes} B</span>
        </div>
      </div>

      <div className="rail">
        <div className="metric">
          <div className="m-label">Progress</div>
          <div className="m-value">{Math.round(progress * 100)}<span className="u">%</span></div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="m-sub">
            {packetsRx.toLocaleString()} / {Math.max(totalPackets, packetsRx).toLocaleString()} packets received
          </div>
        </div>
        <div className="metric">
          <div className="m-label">Throughput</div>
          <div className="m-value">{throughput.toFixed(1)}<span className="u">KB/s</span></div>
          <div className="m-sub">WPA2 · 802.11n · 2.4 GHz</div>
        </div>
        <div className="metric">
          <div className="m-label">State</div>
          <div className="m-value" style={{ fontSize: 14, textTransform: "uppercase",
            color: state === "complete" ? "var(--good)"
                 : state === "streaming" ? "var(--accent)"
                 : state.includes("fail") ? "var(--bad)"
                 : "var(--ink-1)" }}>
            {state || "idle"}
          </div>
          <div className="m-sub">Firebase offload_status</div>
        </div>
        <div className="metric">
          <div className="m-label">rtc_flash_read_addr</div>
          <div className="m-value" style={{ fontSize: 18 }}>
            0x{(packetsRx * 16).toString(16).toUpperCase().padStart(8, "0")}
          </div>
          <div className="m-sub">
            advances 16 B per successful WiFiClient.write()
          </div>
        </div>
      </div>
    </div>
  );
}

window.DiscoverScreen   = DiscoverScreen;
window.ConfigureScreen  = ConfigureScreen;
window.CommandScreen    = CommandScreen;
window.OffloadScreen    = OffloadScreen;
