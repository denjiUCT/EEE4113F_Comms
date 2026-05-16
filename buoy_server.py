"""
buoy_server.py — EEE4113F ground-station relay

Receives sensor packets from the ESP32 over the local Wi-Fi network,
pushes them into Firebase Realtime Database, and exposes simple status
and history endpoints for debugging.

Run:
    pip install firebase-admin flask
    python buoy_server.py

Endpoints:
    POST /data       JSON payload from ESP32 (see PACKET_KEYS below)
    GET  /status     server health JSON
    GET  /readings   last 20 ingested records

Binary packet format (16 bytes, big-endian) — for reference only.
The ESP32 should pre-decode this into the JSON shape below before POSTing:

    offset  width  field          encoding
    ─────── ─────  ─────────────  ──────────────────────────────
    0..1      2    DO             int16 BE, mg/L × 100,  0x8000 invalid
    2..3      2    WATER_TEMP     int16 BE, °C   × 100,  0x8000 invalid
    4..5      2    FLUORESCENCE   int16 BE, RFU  × 100,  0x8000 invalid
    6..7      2    ENCL_TEMP      int16 BE, °C   × 100,  0x8000 invalid
    8..9      2    ENCL_HUMID     int16 BE, %RH  × 100,  0x8000 invalid
    10..11    2    VOLTAGE        int16 BE, V    × 100,  0x8000 invalid
    12..15    4    TIMESTAMP      uint32 BE, seconds since deploy epoch
"""

import struct
from collections import deque
from datetime import datetime, timezone

import firebase_admin
from firebase_admin import credentials, db
from flask import Flask, jsonify, request

# ---------------------------------------------------------------------------
# Configuration — REPLACE PLACEHOLDERS before running
# ---------------------------------------------------------------------------
SERVICE_ACCOUNT_PATH = "firebase_service_account.json"   # PLACEHOLDER
FIREBASE_DB_URL = "https://buoy-comms-default-rtdb.europe-west1.firebasedatabase.app"  # PLACEHOLDER

BUOY_ID = "BY-G17"
PORT = 5000
HISTORY_MAX = 20
RECV_BUFFER = deque(maxlen=HISTORY_MAX)

PACKET_KEYS = (
    "temperature", "conductivity", "do_mgL",
    "battery_pct", "battery_v", "int_temp", "int_humidity",
    "latitude", "longitude",
)

INVALID_INT16 = 0x8000
PACKET_STRUCT = struct.Struct(">hhhhhhI")  # 16 bytes


# ---------------------------------------------------------------------------
# Firebase init
# ---------------------------------------------------------------------------
def init_firebase():
    cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
    firebase_admin.initialize_app(cred, {"databaseURL": FIREBASE_DB_URL})
    print(f"[firebase] connected → {FIREBASE_DB_URL}")


# ---------------------------------------------------------------------------
# Binary packet decoder (kept here so the ESP32 firmware author has a
# reference Python implementation of the spec).
# ---------------------------------------------------------------------------
def decode_packet(buf: bytes) -> dict:
    if len(buf) != 16:
        raise ValueError(f"packet must be 16 bytes, got {len(buf)}")

    do_raw, temp_raw, flu_raw, enc_t_raw, enc_h_raw, volt_raw, ts = \
        PACKET_STRUCT.unpack(buf)

    def scale(raw):
        return None if raw == INVALID_INT16 else raw / 100.0

    return {
        "do_mgL":       scale(do_raw),
        "temperature":  scale(temp_raw),
        "fluorescence": scale(flu_raw),
        "int_temp":     scale(enc_t_raw),
        "int_humidity": scale(enc_h_raw),
        "battery_v":    scale(volt_raw),
        "timestamp_s":  ts,
    }


# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------
app = Flask(__name__)


@app.post("/data")
def ingest():
    if not request.is_json:
        return jsonify({"status": "error", "msg": "expected JSON"}), 400

    payload = request.get_json(silent=True) or {}
    missing = [k for k in PACKET_KEYS if k not in payload]
    if missing:
        return jsonify({"status": "error", "msg": f"missing fields: {missing}"}), 400

    now_iso = datetime.now(timezone.utc).isoformat()

    reading = {
        "water_temp":   payload["temperature"],
        "salinity":     payload["conductivity"],
        "do_mgL":       payload["do_mgL"],
        "battery_pct":  payload["battery_pct"],
        "battery_v":    payload["battery_v"],
        "int_temp":     payload["int_temp"],
        "int_humidity": payload["int_humidity"],
    }

    last_message = (
        f"MO|T={reading['water_temp']}"
        f"|S={reading['salinity']}"
        f"|BAT={reading['battery_pct']}%"
    )

    print(f"[POST /data] {now_iso}  {payload}")

    try:
        buoy_ref = db.reference(f"fleet/{BUOY_ID}")
        buoy_ref.update({
            "lat":          payload["latitude"],
            "lng":          payload["longitude"],
            "status":       "alive",
            "last_contact": now_iso,
            "last_message": last_message,
        })
        buoy_ref.child("reading").set(reading)

        db.reference("iridium_log").push({
            "t":    int(datetime.now(timezone.utc).timestamp() * 1000),
            "buoy": BUOY_ID,
            "kind": "rx",
            "msg":  f"{BUOY_ID} → SBD/MO  T:{reading['water_temp']}°C  "
                    f"S:{reading['salinity']}  BAT:{reading['battery_pct']}%",
        })
    except Exception as exc:
        print(f"[POST /data] firebase write failed: {exc}")
        return jsonify({"status": "error", "msg": str(exc)}), 502

    RECV_BUFFER.append({"received_at": now_iso, "payload": payload, "reading": reading})

    return jsonify({"status": "ok"}), 200


@app.get("/status")
def status():
    return jsonify({
        "status":        "ok",
        "buoy":          BUOY_ID,
        "received":      len(RECV_BUFFER),
        "history_max":   HISTORY_MAX,
        "firebase_url":  FIREBASE_DB_URL,
        "server_time":   datetime.now(timezone.utc).isoformat(),
    })


@app.get("/readings")
def readings():
    return jsonify({
        "buoy":  BUOY_ID,
        "count": len(RECV_BUFFER),
        "items": list(RECV_BUFFER),
    })


@app.errorhandler(404)
def not_found(_):
    return jsonify({"status": "error", "msg": "not found"}), 404


@app.errorhandler(500)
def server_error(exc):
    print(f"[500] {exc}")
    return jsonify({"status": "error", "msg": "internal server error"}), 500


if __name__ == "__main__":
    init_firebase()
    print(f"[server] listening on 0.0.0.0:{PORT}  (POST /data, GET /status, GET /readings)")
    app.run(host="0.0.0.0", port=PORT, debug=False)
