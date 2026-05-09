# Buoy Fleet — Iridium SBD Ground Station Dashboard

A browser-based monitoring dashboard for a multi-buoy ocean sensing network. Simulates Iridium Short Burst Data (SBD) communications and provides a real-time interface for fleet management, sensor telemetry, and remote command dispatch.

---

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Project Structure](#project-structure)
4. [Getting Started](#getting-started)
5. [Architecture](#architecture)
6. [Sensor Data](#sensor-data)
7. [Buoy Status States](#buoy-status-states)
8. [Iridium Simulation](#iridium-simulation)
9. [Data Persistence](#data-persistence)
10. [Integrating the Real Iridium Modem](#integrating-the-real-iridium-modem)
11. [API Reference](#api-reference)
12. [Design System](#design-system)

---

## Overview

This dashboard was designed for the EEE4113F project, which involves deploying a network of ocean buoys that report environmental and system telemetry over the Iridium satellite network. Since the physical Iridium modem is not yet available, this dashboard simulates the full communications loop — including Mobile Originated (MO) transmissions from buoys, Mobile Terminated (MT) command delivery to buoys, and ACK responses — while providing a production-ready UI that can be wired to the real modem with minimal changes.

---

## Features

### Map
- CARTO dark-tile Leaflet map centred on the Mediterranean seed fleet
- Custom animated markers: colour-coded by status, alive buoys pulse continuously
- Markers flash white on every Iridium transmission event
- Click any marker or sidebar row to select a buoy and pan the map to it
- **Add buoy**: click `+ Add buoy`, then click any ocean location — the buoy is provisioned immediately in `deploy` state

### Sidebar
- Live fleet count and per-buoy rows sorted by priority (alive → warn → error → deploy → offline)
- Search by buoy ID or name
- Filter chips: All / Alive / Warn / Error / Deploy / Offline
- Each row shows battery percentage and time since last contact

### Detail Panel (click any buoy)
**Overview tab**
- GPS coordinates, heading (°true), drift speed (knots)
- Last contact time and deployment date
- Live sparkline charts for: Water Temperature, Dissolved Oxygen, Salinity
- Battery percentage + voltage with colour-coded bar (green/amber/red)
- Internal temperature and humidity with threshold warnings

**Telemetry tab**
- Full per-buoy Iridium SBD message log
- Columns: timestamp · direction (MO/MT/CMD) · payload string

**Command tab**
- Send Mobile-Terminated commands: `PING`, `SAMPLE_NOW`, `SLEEP 3600`, `REBOOT`, `GPS_FIX`, `FW_CHECK`
- Simulated ACK arrives 1.5–3 s after dispatch (replace with real modem callback)
- Decommission button — permanently removes the buoy from the fleet

### Top Bar
- Live fleet statistics: total, alive, warning, error, offline, deploying
- **Pause / Resume** — freezes the simulation tick without clearing data
- **Reset** — wipes localStorage and reseeds the fleet from defaults

---

## Project Structure

```
buoy-dashboard/
├── index.html          # Entry point — loads CDN scripts and wires the app
├── styles.css          # Full design system (CSS custom properties, all component styles)
├── data.js             # Fleet model, sensor simulation, localStorage persistence, public API
├── components.jsx      # Sparkline, TopBar, Sidebar, and shared helper functions
├── detail.jsx          # DetailPanel, OverviewTab, TelemetryTab, CommandTab, StatusBar
├── app.jsx             # MapView (Leaflet), IridiumNav popover, App root, ReactDOM render
└── tweaks-panel.jsx    # Design-time tweaks panel (TweaksPanel + form controls)
```

**Load order matters** (defined in `index.html`):

```
data.js → tweaks-panel.jsx → components.jsx → detail.jsx → app.jsx
```

Each `.jsx` file runs in the browser via Babel Standalone — no build step required.

---

## Getting Started

### Requirements
- A modern browser (Chrome, Firefox, Edge, Safari)
- Internet connection (for Google Fonts, Leaflet, React, and CARTO map tiles — all loaded from CDN)
- No Node.js, no build tools, no server required for local use

### Running locally

Open `index.html` directly in your browser:

```bash
# Option 1: double-click index.html in your file manager

# Option 2: serve with Python (avoids some browser CORS quirks with local scripts)
cd EEE4113F_Comms/buoy-dashboard
python3 -m http.server 8080
# then open http://localhost:8080
```

> **Note:** Loading `.jsx` files via `<script src="...">` requires either a server or a browser that permits local XHR. If you see a blank page, use the Python server option above.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│                  Browser                    │
│                                             │
│  ┌──────────┐   ┌────────────────────────┐  │
│  │  data.js │   │    React UI (JSX)      │  │
│  │          │◄──│  app / components /    │  │
│  │  Fleet   │   │  detail / topbar /     │  │
│  │  Store   │──►│  sidebar / map         │  │
│  │          │   └────────────────────────┘  │
│  │  Sim     │                               │
│  │  Timer   │   ┌────────────────────────┐  │
│  │          │   │     Leaflet Map        │  │
│  │  Pub/Sub │──►│  (CARTO dark tiles)    │  │
│  └──────────┘   │  Custom divIcon markers│  │
│       │         └────────────────────────┘  │
│       ▼                                     │
│  localStorage                               │
│  (fleet + log)                              │
└─────────────────────────────────────────────┘
```

### Data flow

1. `data.js` initialises the fleet from localStorage (or seeds from `SEED` array on first load)
2. `startSim()` begins a 2.2 s interval; each tick gives every non-offline buoy a 30% chance to "transmit"
3. A transmission calls `evolve()` to update sensor readings, appends to `history[]` and `telemetry[]`, pushes to the global log, and fires the `subscribeTx` listeners
4. React components subscribe via `BuoyData.subscribe()` and re-render on every fleet change
5. All mutations (`setStatus`, `addBuoy`, `removeBuoy`, `sendCommand`) write through to localStorage immediately

---

## Sensor Data

Each buoy carries the following measurements:

| Field | Unit | Description |
|---|---|---|
| `water_temp` | °C | Sea surface temperature |
| `do_mgL` | mg/L | Dissolved oxygen concentration |
| `salinity` | PSU | Practical Salinity Units |
| `int_temp` | °C | Internal enclosure temperature |
| `int_humidity` | %RH | Internal enclosure relative humidity |
| `battery_pct` | % | Battery state of charge |
| `battery_v` | V | Battery terminal voltage |
| `heading` | ° | Compass heading (true north) |
| `drift_kn` | knots | Drift speed estimate |

### Thresholds (UI warning colours)

| Sensor | Warn | Error |
|---|---|---|
| Internal temp | > 35 °C | > 40 °C |
| Internal humidity | > 70 %RH | > 80 %RH |
| Battery | < 40 % | < 20 % |

### History buffer
Each buoy keeps the last **60 samples** in `history[]`, used to render sparkline charts. On first load, 20 back-dated samples are synthesised to pre-fill the charts.

---

## Buoy Status States

| Status | Marker colour | Meaning |
|---|---|---|
| `alive` | Green `#4ade80` | Operational, transmitting normally |
| `warn` | Amber `#f5b948` | Degraded — battery forced below 35 %, anomalies may appear |
| `error` | Red `#f06d6d` | Fault — internal temp +12 °C, humidity +10 %, battery capped at 18 % |
| `offline` | Grey `#7f8c98` | No link — excluded from simulation ticks |
| `deploy` | Blue `#6aa9ff` | Newly provisioned, not yet in service — excluded from simulation ticks |

Status can be changed at any time from the **status pills** in the detail panel header.

---

## Iridium Simulation

The simulator in `data.js` mimics the Iridium SBD protocol structure:

| Direction | Label | Meaning |
|---|---|---|
| Buoy → Ground | `MO` (Mobile Originated) | Sensor reading transmitted by the buoy |
| Ground → Buoy | `MT` (Mobile Terminated) | Command sent down to the buoy |
| System | `CMD` | Status change or provisioning event |

**Tick rate:** every 2 200 ms, each active buoy has a 30 % probability of transmitting.

**MO payload format:**
```
MO|T=<water_temp>|DO=<do_mgL>|S=<salinity>|BAT=<battery_pct>%
```

**MT command format:**
```
MT|<COMMAND>
```

**ACK (simulated):** arrives 1.5–3 s after MT dispatch:
```
ACK|<COMMAND>|OK
```

The global log (accessible via the navbar SBD pill) shows all MO/MT/CMD traffic across the entire fleet.

---

## Data Persistence

All fleet state is written to the browser's `localStorage` under two keys:

| Key | Contents |
|---|---|
| `buoy.fleet.v1` | Full fleet array including readings, history, and telemetry logs |
| `buoy.iridium.log.v1` | Global Iridium message log (capped at 200 entries) |

**Reset** clears both keys and reseeds the fleet from `SEED` in `data.js`.

To pre-configure a different seed fleet, edit the `SEED` array at the top of `data.js`.

---

## Integrating the Real Iridium Modem

`data.js` is the only file that needs to change. The public API on `window.BuoyData` is the integration boundary — the UI subscribes to it and does not care how data arrives.

### Steps

1. **Replace `startSim()`** — remove or disable the `setInterval` tick. Instead, listen on your modem's serial/USB/TCP interface for incoming SBD messages.

2. **Parse MO messages** — when a message arrives from the modem, call:
   ```js
   BuoyData._ingestMO(buoyId, parsedReading);
   ```
   You will need to add this internal helper to `data.js` (it is just `tickBuoy` without the random walk — apply the real reading directly).

3. **Wire `sendCommand(id, cmd)`** — replace the `setTimeout` ACK stub with actual modem write:
   ```js
   function sendCommand(id, cmd) {
     const b = fleet.find(x => x.id === id);
     if (!b) return;
     b.telemetry.unshift({ t: Date.now(), dir: "tx", payload: `MT|${cmd}` });
     modem.send(b.imei, `MT|${cmd}`);   // <-- your modem write here
     notify(); notifyLog();
     // call notify() again when the real ACK arrives from the modem
   }
   ```

4. **Wire `addBuoy({ lat, lng, name })`** — provision the buoy in your backend/database, then call the existing function to add it to the local fleet store.

5. **Persist to a real DB** — replace `localStorage.setItem(...)` in `save()` and `saveLog()` with API calls to your backend (e.g., `POST /api/fleet`, `POST /api/log`).

The rest of the UI — map, sidebar, detail panel, charts — requires no changes.

---

## API Reference

All functions are on `window.BuoyData`:

| Function | Description |
|---|---|
| `getFleet()` | Returns current fleet array |
| `getLog()` | Returns global Iridium message log array |
| `subscribe(fn)` | Register a fleet-change listener. Returns an unsubscribe function |
| `subscribeLog(fn)` | Register a log-change listener. Returns an unsubscribe function |
| `subscribeTx(fn)` | Register a per-transmission listener (fires with buoy ID). Returns an unsubscribe function |
| `startSim()` | Start the simulation tick (idempotent) |
| `pauseSim()` | Pause simulation without clearing data |
| `resumeSim()` | Resume simulation after pause |
| `isPaused()` | Returns `true` if simulation is paused |
| `setStatus(id, status)` | Change a buoy's status (`"alive"`, `"warn"`, `"error"`, `"offline"`) |
| `addBuoy({ lat, lng, name })` | Add a new buoy; returns the new buoy object |
| `removeBuoy(id)` | Permanently remove a buoy from the fleet |
| `sendCommand(id, cmd)` | Dispatch an MT command string to a buoy |
| `resetFleet()` | Clear localStorage and reseed from defaults |

### Buoy object shape

```js
{
  id: "BY-001",           // unique identifier
  name: "Atlas-1",        // human-readable name
  lat: 36.95,             // latitude
  lng: -8.20,             // longitude
  status: "alive",        // alive | warn | error | offline | deploy
  deployed: "2025-08-12", // ISO date string
  reading: {              // latest sensor snapshot
    water_temp, do_mgL, salinity,
    int_temp, int_humidity,
    battery_v, battery_pct,
    heading, drift_kn
  },
  history: [...],         // last 60 samples (same fields as reading + t: timestamp)
  telemetry: [...],       // last 50 SBD messages { t, dir: "rx"|"tx"|"cmd", payload }
  last_contact: "<ISO>"   // timestamp of last received MO message
}
```

---

## Design System

Defined via CSS custom properties in `styles.css`:

| Variable | Value | Use |
|---|---|---|
| `--bg-0` | `#07101a` | Page background |
| `--bg-1` | `#0c1822` | Panel / sidebar background |
| `--bg-2` | `#122230` | Input / card background |
| `--bg-3` | `#1a2e3f` | Active / hover states |
| `--accent` | `#4dd6e1` | Cyan-teal interactive colour |
| `--st-alive` | `#4ade80` | Status green |
| `--st-warn` | `#f5b948` | Status amber |
| `--st-error` | `#f06d6d` | Status red |
| `--st-offline` | `#7f8c98` | Status grey |
| `--st-deploy` | `#6aa9ff` | Status blue |
| `--mono` | JetBrains Mono | Telemetry values and IDs |
| `--sans` | Helvetica Neue | UI labels and navigation |

---

*EEE4113F Communications — UCT Electrical Engineering*
