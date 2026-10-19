# VayuVata Backend

ASP.NET Core Web API (.NET 10) + SQL Server for air-quality monitoring. **One project, one folder** — controllers, models, DTOs, EF Core, services, auth and validators all live in this directory (exactly one `.csproj`).

## Roles

| Role | Can do |
|---|---|
| `SuperAdmin` | Everything: create Admins/Users, assign Users to Admins, register devices, assign any device, see all data |
| `Admin` | Create/manage **own** Users (`ManagerId` = their id), assign devices to own Users, see data of devices assigned to own Users. Cannot touch standalone Users or other Admins' Users |
| `User` | See own profile, own assigned devices and their readings |

A *standalone user* is a regular `User` managed directly by the SuperAdmin: `ManagerId` = the SuperAdmin's id. There is no tenant/organization layer.

## Quick start (development)

Prerequisites: .NET 10 SDK, SQL Server (default instance `localhost`, Windows auth), `dotnet-ef` tool.

```bash
cd VayuVata/backend
# Secrets live in user-secrets / environment variables, never in source control.
dotnet user-secrets set "Jwt:Key" "<random string, >= 32 chars>"
dotnet user-secrets set "Bootstrap:SuperAdminEmail" "you@example.com"
dotnet user-secrets set "Bootstrap:SuperAdminPassword" "<strong password, >= 10 chars>"
dotnet run -- --migration-status          # lists applied / pending migrations (needs ConnectionStrings:Migration, see below)
dotnet run -- --migrate                   # applies pending migrations (explicit step; start-up never migrates)
dotnet run --launch-profile http          # http://localhost:5080/swagger
```

Schema changes are an explicit step (`--migrate`), never part of API start-up; the app only creates the bootstrap SuperAdmin if none exists. For local development with Windows auth the migration connection string can simply equal the default one: `ConnectionStrings__Migration` is read **only** by `--migrate` / `--migration-status`. Then log in via `POST /api/v1/auth/login`.

## Manager hierarchy (`Users.ManagerId`)

| Account | Role | ManagerId |
|---|---|---|
| System Super Admin | SuperAdmin | NULL |
| Rahul | Admin | NULL |
| Amit, Priya | User | the Admin's id (Admin-managed) |
| Neha | User | the **SuperAdmin's id** (standalone) |

Ids always come from the database. `ManagerId` replaced `AdminId` (migration `ManagerHierarchy`: add column, copy `AdminId` -> `ManagerId`, verify, then drop the old column; reversible; it refuses to run and names the ids if a legacy standalone User with no manager exists, so no manager is ever guessed). Database rules: `CK_Users_Manager` (SuperAdmin/Admin have no manager, a User always has one and never itself), trigger `TR_Users_ManagerRules` (a manager must be an Admin or SuperAdmin; managers cannot be demoted while they manage Users), FK `FK_Users_Users_ManagerId`. Because managers never have a manager, cycles are impossible. The service additionally requires the Admin manager to be **active**.

| Endpoint | Who | Notes |
|---|---|---|
| `POST /users` | SuperAdmin, Admin | SuperAdmin: `role: Admin` (no manager); `role: User` without `managerId` = standalone (manager = caller); with `managerId` = active Admin. Admin: always manager = caller (another `managerId` -> 403) |
| `GET /admins/{adminId}/users` | SuperAdmin (any Admin), Admin (own id only) | paged, `{adminId, adminName, totalCount, page, pageSize, items}`; another Admin -> 403 |
| `POST /admins/{adminId}/users` | SuperAdmin (active Admin), Admin (own id only) | body `{name,email,password}`; same creation service as `POST /users` |
| `GET /superadmin/users` | SuperAdmin | Users with `ManagerId` = the authenticated SuperAdmin; `search`, paging; `managerRole`, `assignmentType: Standalone` |
| `PATCH /users/{id}/admin-assignment` | SuperAdmin | body `{managerId}` (required): active Admin id = assign to that Admin; SuperAdmin's own id = standalone. `null` is rejected. Logged as an `AUDIT manager change` line. Devices, assignments and sensor history are preserved |
| `GET /users` | SuperAdmin, Admin | SuperAdmin filters: `role`, `managerId`, `standalone`, `isActive`, `search`. Admin: own Users only; `managerId` other than their own or `standalone` -> 403 |

Moving a User to another manager changes who can see that User's devices and readings (visibility is resolved through `User.ManagerId`), never the data itself.

## Configuration

Keys are in `appsettings.json`; override with environment variables (`__` = `:`). See `.env.example`.

| Key | Purpose |
|---|---|
| `ConnectionStrings:Default` | SQL Server connection (default: `Server=localhost;Database=VayuVata;Trusted_Connection=True;TrustServerCertificate=True;`) |
| `Jwt:Key` | **Required**, ≥ 32 chars. App refuses to start without it |
| `Jwt:Issuer/Audience/AccessTokenMinutes/RefreshTokenDays` | Token settings (15 min / 7 days) |
| `Bootstrap:SuperAdminEmail/Password/Name` | First SuperAdmin (only used while no SuperAdmin exists) |
| `Swagger:Enabled` | Swagger UI at `/swagger` (on in Development, **off** by default) |
| `ConnectionStrings:Migration` | Used **only** by `VayuVata --migrate` / `--migration-status` (login with DDL rights). Never given to the running API |
| `Database:ApplyMigrationsOnStartup` | **Removed.** Still readable but ignored (a warning is logged); start-up never changes the schema |
| `Database:AllowProductionMigration` | Must be `true` before `--migrate` will run with `ASPNETCORE_ENVIRONMENT=Production` (default false) |
| `Auth:MaxFailedAttempts` / `Auth:LockoutMinutes` | Per-account lockout: 5 wrong passwords inside 15 minutes lock login for 15 minutes (defaults) |
| `RefreshTokens:Cleanup:*` | `Enabled` (true), `RetentionDays` (30), `BatchSize` (500), `MaxBatchesPerRun` (20), `IntervalMinutes` (360) |
| `Ingest:FutureToleranceMinutes` / `Ingest:MissingRecordedAtOffsetMinutes` | Device-clock semantics of ingest: 360 / 330 (the ESP32 reports IST wall-clock time) |
| `DeviceAuth:AcceptStoredHashAsKey` | **Security-sensitive, default false.** Lets a device present the stored key hash instead of its key (see "Stage B" below) |
| `Cors:AllowedOrigins` | Allowed browser origins (empty = no CORS) |
| `RateLimiting:LoginPermitLimit` | Login/refresh attempts per IP per minute (default 10) |
| `Https:Redirect` | Enable HTTPS redirection |
| `DeviceAuth:AllowMissingKeyInDevelopment` | Dev-only: registered active devices may post without `X-Device-Key`. Ignored outside `Development` |

## Database

Name: `VayuVata`. Tables: `Users`, `Devices`, `DeviceAssignments`, `SensorData`, `RefreshTokens` (+ `__EFMigrationsHistory`).

**Option A – EF migrations (recommended)**
```bash
dotnet ef database update          # creates the database if needed and applies Migrations/
dotnet ef migrations add <Name> -o Migrations   # after model changes
```

**Option B – SQL scripts** (`Database/`, same schema as the migrations, verified identical by the test suite)
```bash
sqlcmd -S localhost -E -C -i Database/CreateDatabase.sql
sqlcmd -S localhost -E -C -I -d VayuVata -i Database/CreateTables.sql
sqlcmd -S localhost -E -C -I -d VayuVata -i Database/CreateIndexes.sql
sqlcmd -S localhost -E -C -d VayuVata -i Database/SeedSuperAdmin.sql -v Email="you@example.com" Name="Super Admin" PasswordHash="<bcrypt>"
```
Use `-I` (QUOTED_IDENTIFIER ON): SQL Server requires it for tables with filtered indexes. Use one option per database, not both.

**Reset** (`Database/ResetDatabase.sql`) is destructive and refuses to run unless you pass `Confirm=YES_DROP_VAYUVATA`; it first takes a `BACKUP … WITH CHECKSUM`, runs `RESTORE VERIFYONLY`, and only then drops:
```bash
sqlcmd -S localhost -E -C -i Database/ResetDatabase.sql -v Confirm="YES_DROP_VAYUVATA" BackupPath="D:\Backups\VayuVata_pre_reset.bak"
```

### Key constraints
- `Users.Email` unique; `CK_Users_Role`; `CK_Users_Manager` + trigger `TR_Users_ManagerRules` (only a `User` has a `ManagerId`, always an Admin or SuperAdmin, never itself).
- `Devices.DeviceId` (physical ESP32 id) unique and distinct from `Devices.Id`.
- `UX_DeviceAssignments_ActiveDevice`: **filtered unique index** `WHERE IsActive = 1` → a device has at most one active assignment, even under concurrent requests.
- `SensorData.device_id` → FK to `Devices.DeviceId`; indexes on `device_id`, `recorded_at`, and unique `(device_id, recorded_at)`.

## Sensor-data contract (ESP32)

No firmware/payload definition existed in the repository, so this contract was defined here. **Please confirm it matches the firmware** — only the field naming/units are assumptions.

- `SensorData` keeps the exact column names requested (`ID`, `device_id`, `data_date`, `data_time`, `recorded_at`, `aqi`, `aqi_status`, `pm10`, `pm25`, `no2_ppm`, `so2_ppm`, `co_ppm`, `tvoc_ppb`, `humidity`, `temperature`, `outer_temperature`, `outer_humidity`, `created_at`); C# properties are mapped explicitly.
- Types: `aqi int`, `pm10/pm25 decimal(8,2)`, `no2/so2/co_ppm decimal(10,4)`, `tvoc_ppb decimal(10,2)`, `humidity/outer_humidity decimal(5,2)`, `temperature/outer_temperature decimal(6,2)`. All measurements are **nullable**; omitted values stay `NULL` (never 0).
- **Timestamps are all UTC.** `recorded_at` = device measurement time (ISO-8601, optional; server time if omitted). `data_date`/`data_time` are the UTC date/time parts of `recorded_at`, computed by the server. `created_at` is `SYSUTCDATETIME()` from SQL Server. API responses carry an explicit `Z`.
- **Duplicate prevention:** `(device_id, recorded_at)` is the reading identity (unique index). A resubmission returns `409 duplicate_reading`. Devices should therefore send a stable `recordedAt` (millisecond precision) and may safely retry.
- Validation ranges: aqi 0–1000, pm 0–10000, humidity 0–100, temperature −60…150, etc.; `recordedAt` may not be >5 min in the future.

### Device credentials
`POST /api/v1/sensor-data` is authenticated with a **per-device API key** in the `X-Device-Key` header — never a user JWT.

- **Provisioning:** `POST /api/v1/devices` (SuperAdmin) returns `apiKey` (`vv_…`) **once**. Flash it into the ESP32. Only its SHA-256 hash is stored (`Devices.ApiKeyHash`); it cannot be recovered.
- **Rotation:** `POST /api/v1/devices/{id}/rotate-key` (SuperAdmin) issues a new key; the old key stops working immediately. Re-flash the device.
- Unknown device or bad/missing key → `401` (same answer, no device enumeration); inactive device → `403`.
- **Development-only mode:** `DeviceAuth__AllowMissingKeyInDevelopment=true` lets a *registered, active* device post without a key, only when `ASPNETCORE_ENVIRONMENT=Development`. Off by default; ignored in any other environment.

Example:
```bash
curl -X POST http://localhost:5080/api/v1/sensor-data -H "Content-Type: application/json" -H "X-Device-Key: vv_..." \
  -d '{"deviceId":"ESP32-A1B2C3","recordedAt":"2026-10-11T08:30:00Z","aqi":87,"pm25":22.5,"humidity":55.3}'
```

## Endpoints (`/api/v1`)

| Area | Endpoint | Access |
|---|---|---|
| Auth | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` | public / any role |
| Users | `POST /users`, `GET /users`, `GET /users/{id}`, `PUT /users/{id}`, `PATCH /users/{id}/status`, `POST /users/{id}/reset-password`, `GET /users/{id}/devices` | SuperAdmin, Admin (own scope); `GET {id}` and `{id}/devices` also for the user themself |
| Users | `PATCH /users/{id}/admin-assignment` | SuperAdmin only (body `{managerId}`) |
| Users | `GET /admins/{adminId}/users`, `POST /admins/{adminId}/users` | SuperAdmin; Admin for own id |
| Users | `GET /superadmin/users` | SuperAdmin only |
| Devices | `POST /devices`, `PUT /devices/{id}`, `PATCH /devices/{id}/status`, `POST /devices/{id}/rotate-key` | SuperAdmin only |
| Devices | `GET /devices`, `GET /devices/{id}` | scoped by role |
| Devices | `POST /devices/{id}/assign`, `POST /devices/{id}/unassign`, `GET /devices/{id}/assignments` | SuperAdmin, Admin (scope) |
| Sensor | `POST /sensor-data` | device key (`X-Device-Key`) |
| Sensor | `GET /sensor-data`, `GET /sensor-data/{id}`, `GET /devices/{id}/sensor-data/latest`, `GET /devices/{id}/sensor-data/history` | scoped by role |
| Ops | `GET /health` | public (200 / 503) |

Swagger documents every endpoint, DTO schema, example values and status codes; use **Authorize** and paste the `accessToken` from `/auth/login`. The ESP32 header `X-Device-Key` is shown on `POST /sensor-data`.

### Behaviour worth knowing
- **Auth model:** access JWT (15 min, claims `sub`, `role`, `email`, `name`) + single-use rotating refresh token (7 days, stored as SHA-256). Logout revokes the refresh token; the short-lived access token expires on its own. Every request re-checks that the account still exists, is active and still has the role in the token (deactivated users get `401` immediately). Role always comes from the token/DB, never from a request body.
- **Scoping is enforced inside the SQL queries** (`Authorization/ScopeAuthorizationHandler.cs` → `ScopeFilters`). Out-of-scope ids return `404` (not `403`) to avoid confirming that they exist.
- **Admin device scope:** an Admin sees only devices *currently assigned to themselves* (by the SuperAdmin) or *to one of their own Users*, and can pass such a device on only to their own Users. Unassigned devices and devices of anyone else are invisible to an Admin (404). Only the SuperAdmin can hand an unassigned device to an Admin or User. A User sees only the devices assigned to them.
- **Sensor access follows the *current* assignment:** after reassignment the new owner sees the device's full history and the previous owner no longer sees it. No readings or assignments are ever deleted.
- Roles are immutable after creation (`PUT /users/{id}` edits name/email only). `SuperAdmin` accounts cannot be created through the API (only bootstrap). The last active SuperAdmin cannot be deactivated (`409 last_superadmin`); nobody can deactivate themself.
- Deactivating a user revokes their refresh tokens. It does **not** auto-unassign their devices.
- Errors share one shape: `{ "status", "code", "message", "errors"?, "traceId" }` for validation, malformed JSON/query values, unknown routes (404) and unsupported media types (415). Unhandled errors return a generic 500 (details only in logs).
- If SQL Server is unreachable at startup the API still starts and `GET /api/v1/health` returns **503** until the database is back (no crash loop).
- Swagger shows Bearer only on protected operations; `POST /sensor-data` is secured by the separate `DeviceKey` (`X-Device-Key`) scheme.
- Passwords: BCrypt; policy ≥ 10 chars with upper, lower, digit. Login/refresh are rate limited per IP (`429`).

## Testing

`Tests/` contains `ApiTest.http` (manual requests), `TestCases.md` (scenarios), `Verify.sql` (SQL checks), `Run-ApiTests.ps1` (automated) and `TestResults.md` (output of the last real run).

```powershell
pwsh ./Tests/Run-ApiTests.ps1      # PowerShell 7+, needs SQL Server + sqlcmd
```
The script builds into `Tests/.run/bin` (so it works while the backend is running), starts a second instance on port 5099 against the same `VayuVata` database (using the existing SuperAdmin from user-secrets), runs every scenario and rewrites `TestResults.md`. Nothing is dropped: every test record is tagged (`@vvtest.local` e-mails, `VVTEST-` device ids) and only those rows are removed before and after the run, in one SQL transaction; the schema, migrations and SuperAdmin are preserved. Identity counters are not reset. The SQL-script parity check uses scratch tables in `tempdb`.

## Deployment notes
- Set `ASPNETCORE_ENVIRONMENT=Production`; provide `Jwt__Key`, `ConnectionStrings__Default`, `Cors__AllowedOrigins__0=…` via secrets/env. Leave `Swagger__Enabled=false` unless you want it exposed. Run `dotnet ef database update` (or the SQL scripts) as a deployment step rather than relying on auto-migration.
- Terminate TLS at a reverse proxy or Kestrel and set `Https__Redirect=true`; HSTS is enabled outside Development.
- Use a SQL login/managed identity instead of `Trusted_Connection` for remote servers, and a valid certificate instead of `TrustServerCertificate=True`.
- `GET /api/v1/health` is suitable for load-balancer probes.

## Project layout
```
Controllers/  Models/  DTOs/{Auth,Users,Devices,SensorData}/  Data/(Configurations)  Services/
Middleware/   Authorization/  Validators/  Helpers/  Migrations/  Database/  Tests/  Properties/
```



## Docker / UAT

`Dockerfile` (multi-stage, .NET 10, non-root) and `docker-compose.uat.yml` run the API with **its own SQL Server container**; nothing else is touched.

```bash
cp .env.uat.example .env.uat         # fill in SA_PASSWORD, JWT_KEY, SUPERADMIN_*; never commit .env.uat
docker compose --env-file .env.uat -f docker-compose.uat.yml up -d --build
docker compose --env-file .env.uat -f docker-compose.uat.yml ps          # api + sqlserver should be "healthy"
curl http://localhost:8081/api/v1/health
```

- API: `http://<host>:${API_PORT:-8081}`, Swagger at `/swagger` (`SWAGGER_ENABLED`), environment `Staging`.
- SQL Server is not published to the host. Data lives in the `vayuvata-sqldata` volume; `docker compose ... down` keeps it, `down -v` deletes it.
- On start the API applies EF migrations and bootstraps the SuperAdmin (UAT only; for production run migrations as a deploy step).
- TLS is expected to terminate at your UAT reverse proxy / load balancer (`Https__Redirect=false`). Do not expose the container directly to the internet without one.
- To ship the image to a UAT host without a registry: `docker save vayuvata-api:uat | gzip > vayuvata-api-uat.tar.gz` -> copy -> `docker load`.

## UAT deployment on a shared server (non-Docker)

Used for `72.61.170.214` (production keeps running there, untouched). Self-contained `linux-x64` publish, no .NET install needed on the server.

- App: `/opt/vayuvata-uat/app` (root-owned, not writable by others), service `vayuvata-uat` running as the system user `vayuvata-uat`, hardened systemd unit with memory/CPU/IO caps and a high OOM score so UAT is stopped before production under pressure.
- Config and secrets: `/opt/vayuvata-uat/secrets/` (root-only, mode 600): `uat.env`, `mssql-sa.pass`, `db-login.pass`, `jwt.key`, `uat-superadmin.pass`, and one `<DeviceId>.key` per registered device.
- Database: its own SQL Server 2025 Developer instance bound to `127.0.0.1:1433`, database `VayuVata`, limited login `vayuvata_uat` (db_owner of that database only). Never reachable from outside.
- Listeners: private HTTP `127.0.0.1:5080` (full API + Swagger; use an SSH tunnel: `ssh -L 5080:127.0.0.1:5080 root@<server>`), public HTTPS `0.0.0.0:5443` where `PublicListenerGuard` serves ONLY `POST /api/v1/sensor-data` and answers everything else with an empty 404. Public requests are limited to 16 KB and `RateLimiting:IngestPermitPerMinute` per client IP.
- TLS: self-signed RSA-2048 certificate with the server IP as SAN, TLS 1.2/1.3 only. Pin it on the device (certificate or SPKI hash); never disable validation. Fingerprints are in `/opt/vayuvata-uat/certs/fingerprint.txt`.
- Run the automated suite against UAT with the `VV_*` environment variables documented at the top of `Tests/Run-ApiTests.ps1` (SQL login through an SSH tunnel to port 1433).
- Known behaviour: a request body over 16 KB is rejected with 400 (not 413).

### UAT: public Swagger / full API on port 5081 (added on request)
HTTPS `0.0.0.0:5081` (same pinned self-signed certificate) serves the **full API and Swagger** to anyone on the internet (no `PublicListenerGuard` on this port; only port 5443 is restricted to sensor ingestion). Open `https://72.61.170.214:5081/swagger`, accept the self-signed certificate warning, then Authorize with a JWT from `POST /api/v1/auth/login`. Login is rate limited (10/min per IP). To close it again: `ufw delete allow 5081/tcp`, remove the three `Kestrel__Endpoints__Admin__*` lines from `/opt/vayuvata-uat/secrets/uat.env` (a backup of the previous file is `uat.env.bak-before-5081`), and `systemctl restart vayuvata-uat`.

## Stage B: API quality, authentication, database access (UAT)

**Errors.** Every error body is an RFC 7807 problem document (`type`, `title`, `status`, `detail`, `instance`) that also keeps the original
fields (`code`, `message`, `errors`, `traceId`). It is labelled `application/json` (what existing clients and the ESP32 already receive) and
`application/problem+json` when the caller sends `Accept: application/problem+json`. `traceId` always equals the `X-Request-Id` response header,
which is also in the server log line for that request. Oversized bodies (> 16 KB) return **413** `payload_too_large`. 500 responses carry only the id.

**Headers.** Every response (including 401/404/429/5xx and the public listener's empty 404) has `X-Request-Id`, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, and (non-Swagger) `Cache-Control: no-store` + a restrictive CSP.
The `Server` header is removed. A caller-supplied `X-Request-Id` is echoed only if it is <= 64 safe characters.

**Logging.** One access-log line per request (`HTTP {method} {path} -> {status} in {ms} ms (ip, port, user id, request id)`). Headers, bodies and query
strings are never logged; paths pass through `LogRedactor` (JWT / device-key look-alikes masked); failed-login lines mask the e-mail
(`u***@host`) and state the reason (`unknown_account`, `wrong_password`, `locked`, `disabled`) **in the log only**. The framework's own request
lines (which contain the query string) are kept at Warning.

**Authentication.**
- *Lockout:* `Auth:MaxFailedAttempts` wrong passwords within `Auth:LockoutMinutes` lock that account for the same period. Unknown, wrong-password, locked and
  disabled accounts all get the same `401 Invalid email or password.` The counter resets on a successful login, on an Admin/SuperAdmin password reset
  and on re-activation; failures while locked are not counted (the lock cannot be extended by an attacker); it expires on its own. IP rate limiting is unchanged.
- *Refresh tokens:* single-use rotation with a **family** per login. Presenting an already-rotated token revokes the whole family (logged as a SECURITY
  warning); concurrent use of one token yields exactly one success (atomic `UPDATE ... WHERE RevokedAt IS NULL`). Other logins of the same user are unaffected.
  Tokens rotated before this release have no replacement link, so reusing *those* is a plain 401.
- *`POST /api/v1/auth/change-password`* (any role, JWT): `{currentPassword, newPassword}`. Always the caller's own account. Policy: 10-100 chars, upper + lower + digit,
  different from the current one. Revokes all of the user's refresh tokens and returns a fresh session. Wrong current password -> 400 `current_password_incorrect`
  and counts towards the lockout (6th try -> 429 `account_locked`).

**Database access.** Two SQL logins: the *runtime* login (`vayuvata_uat`) has `SELECT/INSERT/UPDATE` on schema `dbo` and `DELETE` on `RefreshTokens` only (no `db_owner`,
no DDL, cannot delete users/devices/assignments/readings); the *migration* login (`vayuvata_migrator`, `db_owner` of `VayuVata` only) is used by `--migrate`,
installed on the server as `/opt/vayuvata-uat/bin/migrate.sh [status|apply]` (`Database/migrate-uat.sh`). `--migrate` is repeatable (EF history), refuses any database
not named `VayuVata`, refuses `Production` unless `Database:AllowProductionMigration=true`, and never drops anything. Migration `AuthHardening` adds
`Users.FailedLoginCount/LastFailedLoginAt/LockoutUntil`, `RefreshTokens.FamilyId/ReplacedByTokenId` (+ indexes) and drops the redundant unique index
`IX_Devices_DeviceId` (uniqueness and the `SensorData` foreign key are enforced by `AK_Devices_DeviceId`; the migration refuses to drop it unless that constraint exists).

**Lists.** `includeTotal=false` on every paged list skips `COUNT(*)`: `totalCount`/`totalPages` become `null` and `hasNextPage` says whether another page exists.
Default behaviour is unchanged (`totalCount` present; `hasNextPage` is new and additive). Expired refresh tokens (expired more than 30 days ago) are deleted in bounded
batches by a background service; active, revoked-but-unexpired and recently expired tokens are never touched.

**ESP32 ingestion compatibility.** `POST /api/v1/sensor-data` keeps the contract the live device uses: optional `dataDate`/`dataTime` are accepted and stored as sent; an omitted
`recordedAt` is stamped UTC+330 min (IST wall-clock, `Ingest:MissingRecordedAtOffsetMinutes`); a supplied `recordedAt` is stored exactly as sent and may be up to 6 h ahead of UTC
(`Ingest:FutureToleranceMinutes`) because the device clock is IST. `DeviceAuth:AcceptStoredHashAsKey` (default **false**) additionally accepts the stored key hash as the key -
this is what the live firmware currently sends; it weakens device authentication (anyone who can read the `Devices` table can post as that device) and should be turned off
after the device is reflashed with its real `vv_` key.

## Sensor-data processing in SQL Server (`dbo.ManipulatedSensorData`)

**API reads use only `dbo.ManipulatedSensorData`.** `GET /sensor-data`, `GET /sensor-data/{id}`, `GET /devices/{id}/sensor-data/latest|history` and the `POST /sensor-data` response return the processed row (same JSON shape, same `id` as the raw reading; `aqi`/`aqiStatus` are the SQL-calculated values). `dbo.SensorData` is written by ingestion and read only by the SQL trigger; the API never returns it. The frontend needs no change.

```
ESP32 -> API -> dbo.SensorData -> AFTER INSERT trigger -> dbo.ProcessSensorData -> dbo.ManipulatedSensorData
```

Every reading inserted into `dbo.SensorData` (API ingestion or direct SQL, one row or many) is processed by the database itself:

| Object | Script | Purpose |
|---|---|---|
| `dbo.ManipulatedSensorData` | EF migration `SensorDataProcessing` (also in `Database/CreateTables.sql`) | the 18 source columns + `ManipulatedSensorDataID` (PK), `SourceSensorDataID` (FK, **unique** = one row per reading), `processed_at` (UTC, set by SQL Server). `ID` = the source ID (CHECK) |
| `dbo.SensorDataIdList` | `Database/Objects/01_SensorDataIdList.sql` | table type (one or many ids) |
| `dbo.ProcessSensorData` | `Database/Objects/02_ProcessSensorData.sql` | set-based, idempotent, never commits/rolls back, never swallows errors |
| `dbo.TR_SensorData_AfterInsert` | `Database/Objects/03_TR_SensorData_AfterInsert.sql` | thin trigger: ids from `inserted` -> procedure; INSERT only, never touches `SensorData`; `XACT_ABORT ON`, so a processing failure rolls back the source insert too |

* **AQI and status are calculated, never copied.** The device-reported `aqi` / `aqi_status` in `SensorData` are ignored; `ManipulatedSensorData.aqi` / `aqi_status` come from `pm25` and `pm10` using the firmware's `calculateAQI_INDIA()`: `(int)` truncation, Arduino `map()` integer arithmetic per interval, no clamping (above 500 it extrapolates exactly like the firmware), AQI = max(PM2.5 sub-index, PM10 sub-index), status Good/Satisfactory/Moderate/Poor/Very Poor/Severe at 50/100/200/300/400.
* If `pm25` **or** `pm10` is NULL the AQI cannot be calculated: `aqi` and `aqi_status` stay **NULL** (nothing is invented). All other measurements keep their value and precision (NULL stays NULL, 0 stays 0). The firmware's PM calibration (0.77 / 1.10) and moving average are already applied before upload and are **not** applied again.
* Only readings inserted **after** the migration are processed. Historical readings are **not** backfilled (a separate, explicitly approved operation). Backfill later = `EXEC dbo.ProcessSensorData` with the ids (idempotent).
* The EF mapping declares the trigger (`HasTrigger`) so EF does not use an `OUTPUT` clause on inserts. **Deploy the API build that contains this before applying the migration.**
* Apply: `VayuVata --migrate` (or `/opt/vayuvata-uat/bin/migrate.sh apply` on UAT). Re-running is a no-op; the procedure and trigger scripts are `CREATE OR ALTER`.
* Rollback (dev/UAT only, migration login): `dotnet ef database update AuthHardening` runs the migration's Down, which drops the trigger, procedure, type and table.
* Firmware note: `Tests/firmware/calculateAQI_INDIA.cpp` is a verbatim copy of the firmware function (the AQI test oracle). The firmware file in `Downloads` sends `rs485_temperature` / `rs485_humidity` in snake_case to the old Node endpoint; the .NET API stores the outer sensor as `outer_temperature` / `outer_humidity` (camelCase request names). No contract change was made here.

## GPS position reports (`dbo.GpsLocationData`)

Plain storage for the Raspberry Pi tracker - **only push and get, no trigger, no processing**.

| | |
|---|---|
| `POST /api/v1/gps-data` | Pi uploads one report per minute. Auth: header `X-Device-Key` (the device's own key from `POST /devices` / `rotate-key`; the device must be registered, `deviceId` ≤ 50 chars). Also reachable on the public port 5443 (the only other public route besides sensor-data) |
| `GET /api/v1/gps-data` | JWT, scoped exactly like sensor data (SuperAdmin all; Admin their Users' devices; User own). Filters `deviceId`, `from`, `to`, `fix`, `source`, `sortDir`, `page`, `pageSize`, `includeTotal`; newest first - `?deviceId=X&fix=true&pageSize=1` = latest position |

Payload: `deviceId, recordedAt (UTC ISO-8601, required, not in the future), fix (bool, required), source ("gps"|"cell"), lat, lon, altM, speedKmh, signalPct (0-100)`.
`fix:false` = "no fix" report: lat/lon/altM/speedKmh must be null (stored NULL). Validation: lat -90..90, lon -180..180, speed ≥ 0, source gps|cell -> otherwise **400**.
Responses: **201** stored, **200** duplicate `(deviceId, recordedAt)` (idempotent, returns the stored report), 400 bad payload, 401 bad/missing key (also unknown device), 403 inactive device, 413 body > 16 KB, 429 rate limit, 5xx server.
Table columns: `ID, device_id (FK -> Devices.DeviceId), recorded_at (UTC), received_at (SQL Server UTC), has_fix, source, latitude decimal(9,6), longitude decimal(9,6), altitude_m decimal(7,1), speed_kmh decimal(6,1), signal_pct tinyint`; unique `(device_id, recorded_at)`; CHECK constraints for ranges, source and fix/position consistency. Migration `GpsLocationData`.

## Government comparison (CPCB, data.gov.in)

Each device is compared with the nearest official monitoring station. Source: data.gov.in "Real time Air Quality Index from various locations" (CPCB, hourly, published about 2-3 h late). The feed has pollutant averages but **no official AQI**; AQI on both sides is calculated from PM2.5 / PM10 with the same formula.

- **How it fetches.** The station LIST (names + positions) is read from the whole feed only when empty or older than `DataGov:StationListRefreshDays` (7). Every `DataGov:IntervalMinutes` (default **120**) the service takes each active device's latest GPS fix, walks the nearest stations (max `DataGov:MaxCandidates` = 6, within `MaxMatchDistanceKm` = 50) and asks the feed for **that one station only** (`filters[station]`, about 7 rows) until one has fresh PM data. Nothing else is stored and **nothing is purged**: history is kept. The device itself still reports every minute.
- **Matching.** Nearest eligible station (fresh PM reading within `StaleAfterHours` = 3); the mapping only moves when another station is at least `SwitchHysteresisKm` (0.5) closer or the current one stops reporting. Mapping history is kept (`DeviceStationMappings.ValidTo`).
- **Config** (`DataGov:*`): `ApiKey` or `ApiKeyFile` (a server secret, never in git), `ResourceId`, `Enabled`, `IntervalMinutes`, `MaxMatchDistanceKm`, `StaleAfterHours`, `StationListRefreshDays`, `MaxCandidates`.
- **API** (`/api/v1/government`): `GET status`, `GET comparison[/{deviceId}]` (any role, own devices only), `POST sync` and `POST match` (SuperAdmin only).
- **Compared values.** The latest reading of each side with both times shown; PM2.5, PM10 and the calculated AQI are subtracted, gases are shown but not subtracted (units differ), TVOC / temperature / humidity have no government counterpart.
