"""
setup_firebase.py — EEE4113F Ocean Buoy RTDB bootstrap

Seeds the Realtime Database with the BY-G17 buoy structure, then reads
it back to confirm the writes landed.

Usage:
    pip install firebase-admin
    python setup_firebase.py

Requires:
    firebase_service_account.json  (placeholder — replace with your own)
    FIREBASE_DB_URL                (edit the constant below)
"""

from datetime import datetime, timezone

import firebase_admin
from firebase_admin import credentials, db

# ---------------------------------------------------------------------------
# Configuration — REPLACE THESE PLACEHOLDERS with your Firebase project values
# ---------------------------------------------------------------------------
SERVICE_ACCOUNT_PATH = "firebase_service_account.json"   # PLACEHOLDER
FIREBASE_DB_URL = "https://buoy-comms-default-rtdb.europe-west1.firebasedatabase.app"  # PLACEHOLDER


# ---------------------------------------------------------------------------
# Seed payload (mirrors the structure shown in the project brief)
# ---------------------------------------------------------------------------
BUOY_ID = "BY-G17"

SEED_BUOY = {
    "id":           BUOY_ID,
    "name":         "Group17-Buoy",
    "lat":          -33.9249,
    "lng":           18.4241,
    "status":       "alive",
    "deployed":     "2026-05-06",
    "last_contact": "2026-05-06T13:00:00Z",
    "last_message": "MO|T=23.5|S=35.2|BAT=87%",
    "reading": {
        "water_temp":   23.5,
        "salinity":     35.2,
        "do_mgL":        7.2,
        "battery_pct":  87,
        "battery_v":    12.8,
        "int_temp":     24.1,
        "int_humidity": 52.3,
        "heading":       0,
        "drift_kn":      0.1,
    },
}


def init_firebase():
    cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
    firebase_admin.initialize_app(cred, {"databaseURL": FIREBASE_DB_URL})
    print(f"[init] connected to {FIREBASE_DB_URL}")


def write_seed():
    root = db.reference(f"fleet/{BUOY_ID}")
    root.set(SEED_BUOY)
    print(f"[write] fleet/{BUOY_ID}  ← full buoy document")

    for key, value in SEED_BUOY.items():
        if key == "reading":
            continue
        print(f"        ├─ {key}: {value}")
    for key, value in SEED_BUOY["reading"].items():
        print(f"        └─ reading/{key}: {value}")

    db.reference("iridium_log").child("seed").set({
        "t":    int(datetime.now(timezone.utc).timestamp() * 1000),
        "buoy": BUOY_ID,
        "kind": "rx",
        "msg":  f"{BUOY_ID} → SBD/MO  seed bootstrap",
    })
    print("[write] iridium_log/seed  ← seed log entry")


def verify():
    snapshot = db.reference(f"fleet/{BUOY_ID}").get()
    if not snapshot:
        print("[verify] FAIL — no data read back")
        return False

    print("\n[verify] read-back from RTDB:")
    for key, value in snapshot.items():
        if isinstance(value, dict):
            print(f"  {key}:")
            for sub_key, sub_value in value.items():
                print(f"    {sub_key}: {sub_value}")
        else:
            print(f"  {key}: {value}")

    required_top = {"id", "name", "lat", "lng", "status", "deployed",
                    "last_contact", "last_message", "reading"}
    missing = required_top - set(snapshot.keys())
    if missing:
        print(f"[verify] FAIL — missing fields: {missing}")
        return False

    print("\n[verify] OK — all required fields present")
    return True


def main():
    init_firebase()
    write_seed()
    ok = verify()
    print("\n" + ("=" * 40))
    print("setup_firebase.py:", "SUCCESS" if ok else "FAILED")


if __name__ == "__main__":
    main()
