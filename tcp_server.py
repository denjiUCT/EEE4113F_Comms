"""
tcp_server.py — EEE4113F vessel-side relay (v2)
================================================
Three jobs in one process:

  1. FIREBASE LISTENER  — watches commands/pending in RTDB.
                          When the operator clicks "Transmit" in the
                          browser UI, this wakes up and fires the ESP32.

  2. ESP32 SERIAL BRIDGE — sends the 32-byte NRF packet to the vessel
                           ESP32 over USB serial. The ESP32 does the
                           actual radio.write() to the buoy.

  3. TCP SERVER  — listens on port 5555 for the buoy's binary stream.
                   Decodes 16-byte sensor packets, writes readings to
                   Firebase fleet/BY-G17, and streams live progress
                   back to Firebase offload_status so the browser UI
                   can animate in realtime.

Run:
    pip install firebase-admin pyserial
    python tcp_server.py

Requires:
    firebase_service_account.json  in same directory
    Vessel ESP32 flashed with Otsile's NRF transmitter sketch,
    connected via USB (update ESP32_PORT below).
"""

import json
import serial
import serial.tools.list_ports
import socket
import struct
import threading
import time
from datetime import datetime, timezone

import firebase_admin
from firebase_admin import credentials, db

# ── Configuration ─────────────────────────────────────────────────────────────
SERVICE_ACCOUNT_PATH = "firebase_service_account.json"
FIREBASE_DB_URL      = "https://buoy-comms-default-rtdb.europe-west1.firebasedatabase.app"
BUOY_ID              = "BY-G17"
TCP_HOST             = "0.0.0.0"
TCP_PORT             = 5555
PACKET_SIZE          = 16
INVALID_INT16        = 0x8000

# ── Vessel ESP32 serial port ──────────────────────────────────────────────────
# Update this to match your vessel ESP32 port.
# Mac:     /dev/cu.usbserial-0001
# Windows: COM3  (check Device Manager)
# Auto-detect: set to None and the script will find the first ESP32
ESP32_PORT  = None   # ← set to None for auto-detect or e.g. "/dev/cu.usbserial-0001"
ESP32_BAUD  = 115200

# ── Packet struct: 6× int16 + 1× uint32, big-endian ──────────────────────────
PACKET_STRUCT = struct.Struct(">hhhhhhI")

# ── NRF packet builder (mirrors Otsile's build_offload_packet()) ──────────────
NRF_PKT_SIZE     = 32
NRF_SSID_MAX     = 12
NRF_PASS_MAX     = 12

def build_nrf_packet(cmd_code, ssid, password, ip, port):
    """
    Build the 32-byte NRF payload that the vessel ESP32 will transmit.
    Format matches buoy nrf.h exactly:
      byte 0:      cmd
      bytes 1-12:  SSID (null-padded)
      bytes 13-24: password (null-padded)
      bytes 25-28: IP (4 bytes)
      bytes 29-30: port (big-endian uint16)
      byte 31:     reserved
    """
    pkt = bytearray(NRF_PKT_SIZE)
    pkt[0] = cmd_code & 0xFF

    ssid_b = ssid.encode("ascii")[:NRF_SSID_MAX]
    pkt[1:1 + len(ssid_b)] = ssid_b

    pass_b = password.encode("ascii")[:NRF_PASS_MAX]
    pkt[13:13 + len(pass_b)] = pass_b

    pkt[25] = ip[0]; pkt[26] = ip[1]; pkt[27] = ip[2]; pkt[28] = ip[3]
    pkt[29] = (port >> 8) & 0xFF
    pkt[30] =  port       & 0xFF
    return bytes(pkt)


# ── Sensor packet decoder ─────────────────────────────────────────────────────
def decode_packet(raw):
    if len(raw) != PACKET_SIZE:
        raise ValueError(f"expected {PACKET_SIZE} bytes, got {len(raw)}")

    do_r, temp_r, flu_r, et_r, eh_r, volt_r, ts = PACKET_STRUCT.unpack(raw)

    def s(v):
        return None if v == INVALID_INT16 else v / 100.0

    batt_v   = s(volt_r)
    batt_pct = None
    if batt_v is not None:
        batt_pct = round(max(0.0, min(100.0, (batt_v - 10.5) / 2.7 * 100)), 1)

    return {
        "do_mgL":       s(do_r),
        "water_temp":   s(temp_r),
        "fluorescence": s(flu_r),
        "int_temp":     s(et_r),
        "int_humidity": s(eh_r),
        "battery_v":    batt_v,
        "battery_pct":  batt_pct,
        "timestamp_s":  ts,
        "salinity":     None,
    }


# ── Firebase helpers ──────────────────────────────────────────────────────────
def now_iso():
    return datetime.now(timezone.utc).isoformat()

def now_ms():
    return int(datetime.now(timezone.utc).timestamp() * 1000)

def write_reading(decoded, packet_count):
    reading = {
        "water_temp":   decoded["water_temp"],
        "salinity":     decoded["salinity"],
        "do_mgL":       decoded["do_mgL"],
        "battery_pct":  decoded["battery_pct"],
        "battery_v":    decoded["battery_v"],
        "int_temp":     decoded["int_temp"],
        "int_humidity": decoded["int_humidity"],
        "heading":      0,
        "drift_kn":     0.0,
    }
    msg = (f"MO|T={decoded['water_temp']}"
           f"|DO={decoded['do_mgL']}"
           f"|BAT={decoded['battery_pct']}%"
           f"|ts={decoded['timestamp_s']}")

    try:
        buoy_ref = db.reference(f"fleet/{BUOY_ID}")
        buoy_ref.update({
            "status":       "alive",
            "last_contact": now_iso(),
            "last_message": msg,
        })
        buoy_ref.child("reading").set(reading)
        db.reference("iridium_log").push({
            "t":    now_ms(),
            "buoy": BUOY_ID,
            "kind": "rx",
            "msg":  f"{BUOY_ID} → TCP/MO  T:{decoded['water_temp']}°C  "
                    f"DO:{decoded['do_mgL']}  BAT:{decoded['battery_pct']}%  "
                    f"[pkt #{packet_count}]",
        })
        print(f"[firebase] wrote packet #{packet_count} → {msg}")
    except Exception as e:
        print(f"[firebase] write error: {e}")


def update_offload_status(state, step, packets_rx, total, throughput, 
                           bytes_rx, log_entry=None):
    try:
        update = {
            "state":        state,
            "current_step": step,
            "packets_rx":   packets_rx,
            "total":        total,
            "throughput":   round(throughput, 1),
            "bytes":        bytes_rx,
            "updated_at":   now_ms(),
        }
        db.reference("offload_status").update(update)
        if log_entry:
            db.reference("offload_status/stream_log").push({
                "t":     now_ms(),
                "tag":   log_entry.get("tag", "TCP"),
                "msg":   log_entry.get("msg", ""),
                "level": log_entry.get("level", ""),
            })
    except Exception as e:
        print(f"[firebase] status update error: {e}")


# ── Vessel ESP32 serial bridge ────────────────────────────────────────────────
def find_esp32_port():
    """Auto-detect the vessel ESP32 USB serial port."""
    ports = serial.tools.list_ports.comports()
    for p in ports:
        desc = (p.description or "").lower()
        if any(k in desc for k in ["cp210", "ch340", "ftdi", "uart", "esp32"]):
            print(f"[serial] auto-detected ESP32 on {p.device} ({p.description})")
            return p.device
    # fallback — return first available port
    if ports:
        print(f"[serial] using first available port: {ports[0].device}")
        return ports[0].device
    return None

def send_to_esp32(nrf_packet):
    """
    Send the 32-byte NRF packet to the vessel ESP32 via serial.
    The ESP32 sketch reads from Serial and calls radio.write().
    We send: 'P' + 32 bytes + '\n' as a simple framing protocol.
    """
    port = ESP32_PORT or find_esp32_port()
    if not port:
        print("[serial] no ESP32 port found — cannot send NRF command")
        return False

    try:
        with serial.Serial(port, ESP32_BAUD, timeout=3) as ser:
            time.sleep(0.1)
            # Frame: 'P' (packet) + 32 bytes raw
            frame = b'P' + nrf_packet
            ser.write(frame)
            ser.flush()
            # Wait for ACK response from ESP32
            deadline = time.time() + 5.0
            while time.time() < deadline:
                line = ser.readline().decode("utf-8", errors="ignore").strip()
                if not line:
                    continue
                print(f"[ESP32] {line}")
                if "TX OK" in line:
                    print("[serial] vessel ESP32 → NRF packet sent, buoy ACK received")
                    return True
                if "FAILED" in line or "ERROR" in line:
                    print("[serial] vessel ESP32 → NRF transmission failed")
                    return False
    except serial.SerialException as e:
        print(f"[serial] error: {e}")
    return False


# ── TCP server (receives buoy binary stream) ──────────────────────────────────
def handle_buoy_connection(conn, addr, total_expected):
    print(f"[tcp] buoy connected from {addr[0]}:{addr[1]}")
    update_offload_status("connected", 7, 0, total_expected, 0, 0,
        {"tag": "TCP", "msg": f"buoy connected from {addr[0]}", "level": "good"})

    buf          = b""
    packet_count = 0
    bytes_rx     = 0
    t_start      = time.time()

    try:
        while True:
            chunk = conn.recv(512)
            if not chunk:
                break
            buf      += chunk
            bytes_rx += len(chunk)

            while len(buf) >= PACKET_SIZE:
                raw = buf[:PACKET_SIZE]
                buf = buf[PACKET_SIZE:]

                try:
                    decoded      = decode_packet(raw)
                    packet_count += 1
                    elapsed      = max(0.001, time.time() - t_start)
                    throughput   = (bytes_rx / 1024) / elapsed

                    print(f"[pkt #{packet_count}] "
                          f"T={decoded['water_temp']}°C  "
                          f"DO={decoded['do_mgL']}  "
                          f"V={decoded['battery_v']}V  "
                          f"ts={decoded['timestamp_s']}s")

                    write_reading(decoded, packet_count)

                    update_offload_status(
                        "streaming", 8,
                        packet_count, total_expected,
                        throughput, bytes_rx,
                        {"tag": f"PKT#{packet_count}",
                         "msg": f"T={decoded['water_temp']}°C  "
                                f"DO={decoded['do_mgL']}  "
                                f"BAT={decoded['battery_pct']}%  "
                                f"ts={decoded['timestamp_s']}s"}
                    )

                except ValueError as e:
                    print(f"[pkt] decode error: {e} — raw: {raw.hex()}")

    except ConnectionResetError:
        print(f"[tcp] {addr[0]} reset connection")
    except Exception as e:
        print(f"[tcp] error: {e}")
    finally:
        conn.close()
        elapsed    = max(0.001, time.time() - t_start)
        throughput = (bytes_rx / 1024) / elapsed
        print(f"[tcp] done — {packet_count} packets  "
              f"{bytes_rx} bytes  {throughput:.1f} KB/s")

        update_offload_status(
            "complete", 9,
            packet_count, packet_count,
            throughput, bytes_rx,
            {"tag": "FIN", 
             "msg": f"session closed · {packet_count} packets · "
                    f"{bytes_rx} B · {throughput:.1f} KB/s",
             "level": "good"}
        )
        # Clear pending command now that offload is done
        try:
            db.reference("commands/pending").set(None)
        except Exception:
            pass


def run_tcp_server(total_expected_ref):
    """Run TCP server in background thread."""
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((TCP_HOST, TCP_PORT))
    srv.listen(3)
    srv.settimeout(1.0)
    print(f"[tcp] listening on {TCP_HOST}:{TCP_PORT}")

    while True:
        try:
            conn, addr = srv.accept()
            t = threading.Thread(
                target=handle_buoy_connection,
                args=(conn, addr, total_expected_ref[0]),
                daemon=True
            )
            t.start()
        except socket.timeout:
            continue
        except Exception as e:
            print(f"[tcp] accept error: {e}")


# ── Firebase command listener ─────────────────────────────────────────────────
def watch_commands(total_expected_ref):
    """
    Listen to commands/pending in Firebase.
    When the browser UI writes a command, this fires the vessel ESP32
    and updates offload_status so the UI animates in realtime.
    """
    print("[firebase] watching commands/pending...")

    def on_command(event):
        data = event.data
        if not data:
            return  # command was cleared

        cmd_code = data.get("cmd", 0x01)
        ssid     = data.get("ssid", "OTSILBUOY")
        password = data.get("password", "buoytest12345")
        ip       = data.get("ip", [192, 168, 137, 1])
        port     = data.get("port", 5555)

        cmd_name = {0x01: "CMD_OFFLOAD", 0x02: "CMD_PING",
                    0x03: "CMD_RESET_READ_PTR"}.get(cmd_code, f"0x{cmd_code:02X}")

        print(f"\n[command] {cmd_name} received from browser UI")
        print(f"[command] SSID={ssid}  IP={ip}  port={port}")

        # Step 1: update status — transmitting NRF packet
        update_offload_status("tx_nrf", 0, 0, 0, 0, 0,
            {"tag": "NRF", "msg": f"{cmd_name} → vessel ESP32 → radio.write()"})

        # Step 2: build and send NRF packet to vessel ESP32
        nrf_pkt = build_nrf_packet(cmd_code, ssid, password, ip, port)
        print(f"[nrf] packet built: {nrf_pkt.hex()}")

        update_offload_status("tx_nrf", 1, 0, 0, 0, 0,
            {"tag": "NRF", "msg": "IRQ ↓ · waiting for buoy wakeup (~500ms)"})

        ok = send_to_esp32(nrf_pkt)

        if ok:
            print("[command] NRF ACK received — buoy waking")
            update_offload_status("nrf_ack", 2, 0, 0, 0, 0,
                {"tag": "NRF", "msg": "ACK received · buoy booting S0→S8",
                 "level": "good"})
            # Set a reasonable expected packet count
            # Real value comes from buoy's flash read/write pointer diff
            # Use 96 as placeholder (1 sample/15min × 24h)
            total_expected_ref[0] = 96
        else:
            print("[command] NRF failed — check vessel ESP32 connection")
            update_offload_status("nrf_fail", 0, 0, 0, 0, 0,
                {"tag": "NRF", "msg": "TX FAILED — no ACK · check ESP32 wiring",
                 "level": "bad"})

    db.reference("commands/pending").listen(on_command)


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print("=" * 55)
    print("  EEE4113F Vessel Relay — tcp_server v2")
    print(f"  Buoy:    {BUOY_ID}")
    print(f"  TCP:     0.0.0.0:{TCP_PORT}")
    print(f"  ESP32:   {ESP32_PORT or 'auto-detect'}")
    print(f"  Firebase: {FIREBASE_DB_URL}")
    print("=" * 55)

    # Init Firebase
    cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
    firebase_admin.initialize_app(cred, {"databaseURL": FIREBASE_DB_URL})
    print("[firebase] connected")

    # Shared mutable ref for expected packet count
    total_expected_ref = [0]

    # Start TCP server in background
    tcp_thread = threading.Thread(
        target=run_tcp_server,
        args=(total_expected_ref,),
        daemon=True
    )
    tcp_thread.start()

    # Watch Firebase for commands (blocking — runs in main thread)
    watch_commands(total_expected_ref)


if __name__ == "__main__":
    main()
