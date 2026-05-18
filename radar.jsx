/* Radar — polar sweep with detected buoy contacts */
const { useEffect, useRef, useState } = React;

function Radar({ contacts, selectedId, onSelect, sweeping }) {
  const [angle, setAngle] = useState(0);
  const reqRef = useRef();
  const lastTs = useRef(0);

  useEffect(() => {
    if (!sweeping) return;
    const tick = (ts) => {
      if (!lastTs.current) lastTs.current = ts;
      const dt = ts - lastTs.current;
      lastTs.current = ts;
      setAngle(a => (a + dt * 0.08) % 360);
      reqRef.current = requestAnimationFrame(tick);
    };
    reqRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(reqRef.current);
  }, [sweeping]);

  // SVG coords: center 250,250, max radius 230
  const cx = 250, cy = 250;
  const rings = [0.25, 0.5, 0.75, 1.0];
  const labels = ["250m", "500m", "750m", "1.0km"];
  const maxR = 230;

  return (
    <div className="radar-wrap">
      <div className="radar-header">
        <div className="kvs">
          <div className="kv">CHANNEL <b>76 · 2.476 GHz</b></div>
          <div className="kv">MODE <b>NRF24L01+ · 250 kbps</b></div>
        </div>
        <div className="kvs right">
          <div className="kv">BEARING <b>{angle.toFixed(0).padStart(3, "0")}°</b></div>
          <div className="kv">{sweeping ? "SWEEPING" : "IDLE"}</div>
        </div>
      </div>

      <svg className="radar-svg" viewBox="0 0 500 500" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="rgrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(79,209,197,0.18)" />
            <stop offset="80%" stopColor="rgba(79,209,197,0.02)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          <linearGradient id="sweepGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(79,209,197,0.0)" />
            <stop offset="80%" stopColor="rgba(79,209,197,0.35)" />
            <stop offset="100%" stopColor="rgba(126,230,220,0.55)" />
          </linearGradient>
        </defs>

        <circle cx={cx} cy={cy} r={maxR} fill="url(#rgrad)" />

        {/* range rings */}
        {rings.map((r, i) => (
          <g key={r}>
            <circle cx={cx} cy={cy} r={r * maxR}
              fill="none" stroke="rgba(79,209,197,0.18)" strokeWidth="1"
              strokeDasharray={i === rings.length - 1 ? "0" : "2 3"} />
            <text x={cx + 6} y={cy - r * maxR + 4}
              fontFamily="JetBrains Mono, monospace" fontSize="9"
              fill="rgba(168,198,223,0.55)">{labels[i]}</text>
          </g>
        ))}

        {/* crosshairs */}
        <line x1={cx - maxR} y1={cy} x2={cx + maxR} y2={cy}
          stroke="rgba(79,209,197,0.12)" strokeWidth="1" />
        <line x1={cx} y1={cy - maxR} x2={cx} y2={cy + maxR}
          stroke="rgba(79,209,197,0.12)" strokeWidth="1" />

        {/* bearing ticks */}
        {Array.from({ length: 36 }).map((_, i) => {
          const a = (i * 10) * Math.PI / 180;
          const x1 = cx + Math.cos(a) * (maxR - 4);
          const y1 = cy + Math.sin(a) * (maxR - 4);
          const x2 = cx + Math.cos(a) * maxR;
          const y2 = cy + Math.sin(a) * maxR;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={i % 9 === 0 ? "rgba(126,230,220,0.7)" : "rgba(79,209,197,0.3)"}
            strokeWidth="1" />;
        })}

        {/* compass labels */}
        <text x={cx} y={cy - maxR - 8} textAnchor="middle"
          fontFamily="JetBrains Mono" fontSize="10" fill="#7ee6dc" fontWeight="600">N</text>
        <text x={cx + maxR + 12} y={cy + 4} textAnchor="middle"
          fontFamily="JetBrains Mono" fontSize="10" fill="rgba(168,198,223,0.7)">E</text>
        <text x={cx} y={cy + maxR + 16} textAnchor="middle"
          fontFamily="JetBrains Mono" fontSize="10" fill="rgba(168,198,223,0.7)">S</text>
        <text x={cx - maxR - 12} y={cy + 4} textAnchor="middle"
          fontFamily="JetBrains Mono" fontSize="10" fill="rgba(168,198,223,0.7)">W</text>

        {/* sweep beam */}
        {sweeping && (
          <g transform={`rotate(${angle - 90} ${cx} ${cy})`}>
            <path d={`M ${cx} ${cy} L ${cx + maxR} ${cy} A ${maxR} ${maxR} 0 0 0 ${cx + Math.cos(-Math.PI / 4) * maxR} ${cy + Math.sin(-Math.PI / 4) * maxR} Z`}
              fill="url(#sweepGrad)" />
            <line x1={cx} y1={cy} x2={cx + maxR} y2={cy}
              stroke="#7ee6dc" strokeWidth="1.2" opacity="0.9" />
          </g>
        )}

        {/* center dot */}
        <circle cx={cx} cy={cy} r="4" fill="#7ee6dc" />
        <circle cx={cx} cy={cy} r="9" fill="none" stroke="rgba(126,230,220,0.6)" strokeWidth="1" />
        <text x={cx} y={cy + 28} textAnchor="middle"
          fontFamily="JetBrains Mono" fontSize="10" fill="rgba(168,198,223,0.7)">FOG NODE</text>

        {/* contacts */}
        {contacts.map(c => {
          const a = c.bearing * Math.PI / 180;
          const r = c.range * maxR;
          const x = cx + Math.cos(a - Math.PI / 2) * r;
          const y = cy + Math.sin(a - Math.PI / 2) * r;
          const isSel = c.id === selectedId;
          // Animate echo opacity based on sweep proximity
          const sweepDelta = Math.abs(((angle - c.bearing) + 540) % 360 - 180);
          const echoStrength = c.online
            ? Math.max(0.4, 1 - sweepDelta / 60)
            : 0.25;
          return (
            <g key={c.id} onClick={() => onSelect(c.id)} style={{ cursor: "pointer" }}>
              {c.online && (
                <circle cx={x} cy={y} r="18" fill="rgba(79,209,197,0.10)"
                  opacity={echoStrength * 0.5} />
              )}
              <circle cx={x} cy={y} r={isSel ? 9 : 6}
                fill={c.online ? "#4fd1c5" : "#3f5a72"}
                opacity={echoStrength}
                stroke={isSel ? "#7ee6dc" : "transparent"}
                strokeWidth="2" />
              {isSel && (
                <circle cx={x} cy={y} r="14"
                  fill="none" stroke="#7ee6dc" strokeWidth="1"
                  strokeDasharray="2 2">
                  <animate attributeName="r" values="14;20;14" dur="2s" repeatCount="indefinite" />
                </circle>
              )}
              <text x={x + 14} y={y - 8}
                fontFamily="JetBrains Mono" fontSize="10"
                fill={isSel ? "#e6f3ff" : "rgba(168,198,223,0.85)"}>
                {c.name}
              </text>
              <text x={x + 14} y={y + 5}
                fontFamily="JetBrains Mono" fontSize="9"
                fill="rgba(107,137,164,0.85)">
                {c.online ? `${(c.range * 1000).toFixed(0)}m · ${c.rssi}dBm` : "offline"}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="radar-foot">
        <div>{contacts.filter(c => c.online).length} CONTACTS · {contacts.length} REGISTERED</div>
        <div>RANGE 1.0 km · PIPE 0xB1B2B3B4B5</div>
      </div>
    </div>
  );
}

window.Radar = Radar;
