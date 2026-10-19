# Anti-theft tracking plan (weak satellite signal, internet still available)

**Status:** plan only, nothing built yet. Written 18 Oct 2026 so the work can be picked up later.

**Goal:** if a device is stolen or moved and the satellite signal is weak, still get a **current** position from whatever the device can reach, and raise an alert when it moves or goes silent. No "last known position" is shown as if it were current.

**Hardware today:** Raspberry Pi with a SIM7600 4G modem (it has a GNSS receiver). The Pi posts to `POST /api/v1/gps-data` about once a minute (`pi-router-gps-push`). The API already accepts `source: "gps" | "cell"` and a "no fix" report with no position.

## 1. What a thief can and cannot stop

| Situation | What still works |
|---|---|
| Antenna covered, device indoors, weak satellites | Cell-tower and Wi-Fi positioning (approximate, but current) |
| Internet and SIM still working | All positioning methods and all alerts |
| SIM removed, power cut, or a signal jammer | No tracking is possible. Only an "offline" alert, plus a battery backup, helps |

## 2. Position sources, best to worst (always labelled, never disguised as GPS)

1. **Satellite fix.** A few metres. Enable all systems (GPS, GLONASS, BeiDou, Galileo) and A-GPS (`AT+CGPS=1,2`) so it works at weaker signal.
2. **Wi-Fi positioning.** The Pi scans nearby Wi-Fi networks and a location service converts them to a position. In cities often 20 to 100 m, even indoors.
3. **Cell-tower positioning.** The modem's `AT+CLBS`, or tower IDs (MCC, MNC, LAC, CID) sent to a location service. Roughly 100 m to a few km.
4. **IP-address location.** City-level only and unreliable on mobile networks. Show as "very approximate", or skip.
5. **No position.** Say so. Do not reuse an old position as if it were current.

## 3. Raspberry Pi work

- Read satellite count, signal quality and fix type every cycle (`AT+CGNSSINFO`); enable multi-constellation (`AT+CGNSSMODE`) and A-GPS.
- No fix for about 30 s: collect cell info and a Wi-Fi scan, and try the modem's own location command.
- Report fields: `source` (gps / wifi / cell / none), `accuracyM`, satellites, HDOP or signal quality, plus the raw cell and Wi-Fi observations (the server calculates the position).
- **Fast mode:** the server's reply can tell the Pi to report every 10 to 15 s ("stolen mode").
- **Offline buffer:** keep reports while the internet is down and send them when it returns.
- Optional: SMS fallback when mobile data fails but the SIM works (needs an SMS plan).
- Optional: tamper inputs (motion sensor, power-loss "last message") and a small battery backup.
- Location-service API keys stay on the server, never on the Pi.
- Check first: antenna placement (sky view, active antenna). This fixes most weak-signal cases.

## 4. Backend work

- Extend the GPS record: `accuracy_m`, `satellites`, `source` (gps / wifi / cell), signal quality. New EF migration plus validation.
- **Position lookup service:** takes the cell and Wi-Fi observations, asks a provider, stores the result with its accuracy. Provider behind one adapter so it can be changed (Google, Unwired Labs, Combain, OpenCelliD). Key kept as a server secret.
- **Stolen mode** per device (SuperAdmin only, logged): the server tells the Pi to report faster and sends alerts immediately.
- **Alerts:** device left its installed area (use the accuracy to avoid false alarms), no report for N minutes (offline), power lost or tamper signal. Email first; SMS or push later.
- **Security:** `GET /api/v1/gps-data` and `/gps-data/current` are public today. For anti-theft they must require a login and be limited to the user's own devices. (`/gps-data/history` already does.)
- Retention rule for location data.

## 5. Frontend work

- **Map markers by type:** normal pin for satellite positions; pin plus an **accuracy circle** for Wi-Fi and cell, labelled "approximate".
- **No live position:** list the device as "No live position" with the time since its last report; draw no marker.
- Trail of recent positions; Location history filters by source and accuracy (the history table exists already).
- **Stolen mode** switch, red banner and alert list (SuperAdmin). Admin and User see alerts for their own devices.
- **Installed area:** a circle per device on the map, with the leave-area alert.
- Notification bell with unread alerts.

## 6. Suggested order

1. Pi: A-GPS, multi-constellation, antenna check (cheap, fixes most cases).
2. Backend and Pi: accuracy and source fields, Wi-Fi and cell lookup.
3. Frontend: approximate markers with accuracy circles, "No live position" state.
4. Backend and frontend: installed area, offline alert, email alerts.
5. Everything together: stolen mode with fast reporting.
6. Last, optional: SMS, tamper input, battery backup.

## 7. Decisions needed before building

- Which location provider? Google is the most accurate but needs a billing key; Unwired Labs has a small free plan.
- How should alerts reach you: email, SMS or phone push?
- Should the Pi reach the server over mobile data only, or also over home Wi-Fi?

## 8. Other known open items (not part of tracking)

- 498 older sensor readings (11 to 12 Oct) are not processed into `ManipulatedSensorData`, so dates before 14 Oct 19:05 show nothing. Backfill is an idempotent `EXEC dbo.ProcessSensorData` run; waiting for approval.
- Done (19 Oct 2026): the government sync no longer reads the whole feed. It finds each device's nearest station from the stored station list and asks data.gov.in for that one station only (about 7 rows), every 2 hours. Nothing is purged, so history is kept. The table was truncated once on 19 Oct at the owner's request.
- Done (19 Oct 2026): `vayuvata_uat` was found to be a `db_owner` member of the UAT database (the hardening notes say it must not be). It was removed after a rolled-back dry run; a background watcher was left to roll it back if the first real device post failed. If ingestion ever returns HTTP 500 after this, re-add with `ALTER ROLE db_owner ADD MEMBER vayuvata_uat;` using the migration login, then investigate.
