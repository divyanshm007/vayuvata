# LIVVAir Protect — Admin Panel (frontend)

React 18 + TypeScript + Vite + MUI + Recharts. One login page for `SuperAdmin`, `Admin` and `User`; the role comes from `GET /api/v1/auth/me`, and the backend remains the source of truth for authorization.

## Run / build

```bash
npm install
npm run dev        # http://localhost:5173  (dev CORS origin is already allowed by the backend)
npm test           # vitest
npm run build      # type-check + production build -> dist/
npm run preview    # serve dist/ locally
```

API address: `VITE_API_BASE_URL` (`.env.development`, `.env.production`; default `http://localhost:5080`). It is baked in at build time, so set it before `npm run build`.

## Deploying `dist/`

`dist/` is static (like an Angular build). Serve it from any static host with an SPA fallback (unknown paths -> `index.html`).
The backend must list the panel's origin in `Cors:AllowedOrigins` (e.g. `Cors__AllowedOrigins__0=https://admin.example.com`).

## Auth and sessions

- Login: `POST /auth/login` -> access token (memory only) + refresh token.
- Refresh token: `sessionStorage` (this tab) or `localStorage` if "Keep me signed in" is ticked. The backend returns tokens in the JSON body (no HttpOnly cookie), so this is the safest compatible option; any script running on the origin could read it, so keep the host's CSP strict and add no third-party scripts. Moving to cookies would need a backend change and was not made.
- 401 -> one shared refresh (single-flight, avoids rotation races) -> retry. A rejected refresh clears the session and returns to login; a network error does not log the user out.
- Logout calls `POST /auth/logout`; change-password adopts the fresh session the API returns.

## Endpoints integrated

Auth: login, refresh, change-password, logout, me. Users: list, get, create, update, status, admin-assignment, reset-password, devices; `/admins/{id}/users` (list/create); `/superadmin/users` is wrapped in `usersApi.standalone` (the Users page uses `GET /users?standalone=true` for the same data). Devices: create, list, get, update, status, rotate-key, assign, unassign, assignments. Sensor data: list, get, device latest, device history. Health.
Not used by design: `POST /sensor-data` (ESP32 ingestion with `X-Device-Key`).

## Notes and gaps

- Sensor timestamps are device wall-clock (IST) with no zone; they are shown as stored and labelled "IST". Date filters are sent as typed (device time), not converted to UTC. Audit timestamps (created, last sign-in, assigned) are UTC and shown in the browser's locale.
- "Reporting" = latest reading within 30 minutes. Active/inactive, reporting and assigned are shown separately.
- No aggregation endpoint exists: charts use the latest 300 readings in the range (3 pages of 100), exports are capped the same way, and "latest AQI" columns fetch up to 24 devices' latest readings.
- Not built (no API): Audit Logs, notifications, editing own profile (the backend only lets Admin/SuperAdmin update users), trend arrows.
- Not run against a live API in this session (backend was not running); API behaviour is covered by mocked tests only. Do a smoke test with each role after deploying.

## Live Device Map (`/device-map`)

Shows each authorised device's latest GPS position on an OpenStreetMap map (Leaflet + React Leaflet, marker clustering, no API key).
Visible to all three roles; the content is limited to the devices the caller may see.

**Endpoints used** (frontend service: `src/features/device-map/services/gpsDataService.ts`)
- `GET /api/v1/gps-data` - newest 5,000 reports, all devices. Reports are grouped by `deviceId`; the latest is chosen by `recordedAt` (ties: larger `id`), never by response order.
- `GET /api/v1/gps-data/current?deviceId=` - one device's latest report (used on selection and in "View GPS Details"). 404 = unknown device or no data yet, 409 `device_inactive` = inactive device; both are handled, not treated as failures.
- `GET /api/v1/devices` - the caller's authorised device list (scoped by the backend). GPS rows are joined to it.
- `POST /api/v1/gps-data` is **not** used: it is the Raspberry Pi upload (X-Device-Key) and the panel never handles device keys.

**Rules**: a marker needs `fix:true` and finite, in-range coordinates; `(0,0)` is rejected as zero-filled data. A newer "no fix" report keeps the last known position and is flagged. Invalid rows are ignored and listed under *Data notes*. Positions older than `VITE_GPS_STALE_MINUTES` (default 10) are marked stale.

**Refresh**: every `VITE_GPS_REFRESH_SECONDS` (default 60, minimum 30; the Pi reports about once a minute). One request cycle at a time, paused while the tab is hidden, last good data kept if a refresh fails. A refresh never moves the camera; it only moves on first load, on "Fit all markers", and when a device is selected.

### Privacy limitation and the backend changes needed
The two GPS read endpoints are **public** (no login, all devices). The panel filters to the caller's authorised devices, but that is only a presentation safeguard: anyone can call `GET /gps-data` directly and see every device's location. Server-enforced privacy needs backend changes (not made here):
1. Require login on both reads (`[Authorize(Policies.AnyRole)]`) and scope them with the existing `db.VisibleGpsLocations(caller)` helper (already in `Authorization/ScopeAuthorizationHandler.cs`, currently unused by the controller): SuperAdmin all, Admin their users' devices, User their assigned devices. Keep `POST` public (device key).
2. `GET /gps-data/current` should answer 404 for devices outside the caller's scope (no enumeration).
3. Add a latest-position-per-device read (for example `GET /gps-data/latest`, optional `deviceIds`) so clients do not download up to 5,000 rows (about 1 MB) every minute.
4. Rate-limit the reads, and confirm the public listener only exposes `POST /gps-data`.

The map uses the public OpenStreetMap tile server, which has a fair-use policy; for heavy traffic switch `TileLayer` in `DeviceMap.tsx` to a hosted tile provider. Attribution is shown on the map.
