# Test Cases

IDs match `Run-ApiTests.ps1` and `TestResults.md`. "Auto" = executed by the script against the `VayuVata` database (tagged test rows only, removed afterwards). "Manual" = executed by hand (see the bottom of `TestResults.md`).

## Deployment, Swagger, database
| ID | Scenario | Expected | Type |
|----|----------|----------|------|
| W01 | `GET /api/v1/health` | 200, `database: Connected` | Auto |
| W02 | Migrations on a clean database | `InitialCreate` recorded in `__EFMigrationsHistory` | Auto |
| W03 | Filtered unique index on active assignments exists | `UX_DeviceAssignments_ActiveDevice` unique + filtered | Auto |
| W04 | OpenAPI contains every implemented endpoint | 21 paths present | Auto |
| W05 | OpenAPI declares Bearer JWT scheme | `securitySchemes.Bearer` | Auto |
| W06 | Swagger UI loads | 200 `/swagger/index.html` | Auto |
| W07 | OpenAPI schemas have example values | LoginRequest example present | Auto |
| W08/W09 | Hand-written `Database/*.sql` scripts equal the EF schema | identical columns / indexes | Auto |
| W10 | No stack traces / unhandled exceptions in the app log | none | Auto |
| M01 | Swagger UI **Authorize** with a JWT, then Execute `GET /auth/me` | 200 with profile | Manual |
| M02 | Fresh start against the real `VayuVata` DB: DB created, migrated, SuperAdmin bootstrapped, health OK | OK | Manual |

## Authentication
| ID | Scenario | Expected |
|----|----------|----------|
| A01 | SuperAdmin login | 200; token, expiry, userId, name, email, role |
| A02 / A03 / A04 | Admin / User / standalone User login | 200 |
| A05 / A06 | Wrong password / unknown email | 401 |
| A07 / A08 | Missing / garbage token | 401 |
| A09 (+A09b control) | Expired JWT (same key) | 401 (control: valid hand-built JWT → 200) |
| A10 | JWT signed with another key | 401 |
| A11 / A11b | Forged role claim (wrong key / valid key but role ≠ DB role) | 401 |
| A12 | `/auth/me` | 200, no password data |
| A13 | `role` field in login body | ignored |
| A14–A16b | Refresh, single-use rotation, logout revocation, raw token not stored | 200 / 401 / 204 / hashed |
| A17 / A18 | Inactive account cannot log in; its existing JWT is rejected | 401 |
| A19 | Repeated logins | 429 |

## Users
| ID | Scenario | Expected |
|----|----------|----------|
| U01–U03 | SuperAdmin creates Admins, a User under an Admin, a standalone User | 201 |
| U04 | Admin creates a User | 201, owned by that Admin |
| U05 / U05b / U05c | Admin puts user under another Admin / creates an Admin / role `SuperAdmin` requested | 403 / 403 / 400 |
| U06 / U06b | Regular User creates / lists users | 403 |
| U07 | Admin lists users | only own Users |
| U08 / U09 | Admin reads other Admin's User / standalone User | 404 |
| U10 | Admin edits, deactivates, resets password of out-of-scope users | 404 |
| U11 / U11b | Admin / User changes Admin assignment | 403 |
| U12 / U12b / U12c | SuperAdmin moves user, makes standalone, targets a non-Admin | 200 / 200 / 400 |
| U13 / U14 | Duplicate email (case-insensitive) / weak password | 409 / 400 |
| U15 / U15b | Deactivate the last active SuperAdmin | 409 `last_superadmin`, still active |
| U16 | Admin resets password | old password fails, new works |
| U17 | User reads self / another user | 200 / 404 |
| U18 | `pageSize=1000` | clamped to 100 |
| U19 | Passwords stored as BCrypt | none plain |
| U20 | DB check constraint blocks AdminId on an Admin | blocked |

## Devices
| ID | Scenario | Expected |
|----|----------|----------|
| D01 / D01b | SuperAdmin registers device; key returned once, stored hashed | 201 |
| D02 | Duplicate physical DeviceId | 409 |
| D03 | Admin / User registers device | 403 |
| D04 | One User gets multiple devices | 2 devices |
| D05 | Re-assign to same user | 409 |
| D06 / D07 | Admin assigns to another Admin's User / standalone User | 403 |
| D08 | User assigns | 403 |
| D09 / D10 | Admin touches / sees a device assigned outside scope | 404 |
| D11 / D12 | Admin assigns an unassigned device to own User; Admin list scoped | 200 |
| D13 | User device list | own devices only |
| D14 / D15 / D16 | Inactive device / inactive user / Admin-role target | 409 / 409 / 400 |
| D17 | Reassignment keeps history, one active | 2 rows, 1 active |
| D18 | User reads assignment history | 403 |
| D19 | Unassign (and unassign twice) | 200 / 409 |
| D20 | 16 concurrent assign requests to one device | exactly 1 active assignment, only 200/409 |
| D21 | Raw SQL insert of 2nd active assignment | blocked by unique index |
| D30 / D31 | Key rotation (old key rejected) / non-SuperAdmin rotation | 200 / 403 |

## Sensor data
| ID | Scenario | Expected |
|----|----------|----------|
| S10 | Valid device + key | 201 |
| S11 / S12 | Unknown device / inactive device | 401 / 403 |
| S13 / S14 / S15 | Missing key / another device's key / user JWT as credential | 401 |
| S16 / S17 / S17b | Out-of-range values / future time / UTC `Z` timestamps | 400 / 400 / ok |
| S18 | Duplicate `(deviceId, recordedAt)` | 409 |
| S19 | Omitted measurements | NULL in API and DB |
| S20 / S21 / S22 | data_date/time consistency, server `created_at`, exact column names | ok |
| S23 | Invalid `sortBy` | 400 |
| S30–S33 | SuperAdmin all / Admin scope / User own / standalone own | per role |
| S34 / S35 | Cross-scope access via `deviceId` filter | 0 rows |
| S36 / S37 | Cross-scope access by id / latest / history | 404 |
| S38 / S39 | Latest reading; from/to filter | correct |
| S40 / S41 | Pagination and asc sort; no unauthorized rows on any page | ok |
| S42 | Other Admin's User sees only their device | ok |
| S01 / S02 | Reassignment preserves readings; new owner sees history, old owner loses access | ok |

## Phase 2 additions (all automated)
| ID | Scenario | Expected |
|----|----------|----------|
| E01 / E01b / E01c | `PUT /users/{id}`: Admin on own User; SuperAdmin on any; duplicate email; Regular User | 200 / 200 / 409 / 403 |
| E02 / E02b | `PUT /devices/{id}` by SuperAdmin; Admin/User attempts (also PATCH status) | 200, DeviceId unchanged / 403 |
| E03 | Deactivate then reactivate a device; ingestion with a correct key | 403 while inactive, 201 after |
| E04 | Reactivated user logs in again | 200 |
| E05 / E05a | Paging of `GET /users/{id}/devices` and `GET /devices/{id}/assignments` (`page=2&pageSize=1`) | correct page/size/totalPages |
| E05b / E05c / E05d | Device filters `assigned=false`, `isActive=false`; cross-scope device lists | filtered / 404 |
| E06 / E06b / E06c | Standalone User: profile (role User, AdminId null), 403 on every admin endpoint, own devices only | ok |
| E07 / E07b / E07c | Admin cannot read/deactivate the SuperAdmin; Admin/User cannot read out-of-scope device or history by id | 404 |
| E08 / E08b / E08c | Logout without token; deactivation and password reset revoke refresh tokens | 401 |
| E09 - E09e | Malformed JSON, wrong types, bad query types, unknown route, wrong media type | 400 `ApiError` / 404 JSON / 415 |
| E10 / E10b | Sort by `aqi`; page beyond the end | ordered; empty items + totalCount |
| W04b | OpenAPI documents exactly 27 operations | 27 |
| W11a - W11d | Ingestion secured by `X-Device-Key` scheme only; Bearer on protected ops only; `ApiError` documented for 400/401/403; `/auth/me` 401 without token, 200 with | ok |
| W12 | Health returns 503 while SQL Server is unreachable (separate instance with an unreachable connection string; creates nothing) and the API stays up | 503 `Unreachable` |
| W11 (final) | Cleanup removed every tagged test row; SuperAdmin intact | 0 leftovers |

## Phase 3 - manager hierarchy (`ManagerId`), all automated unless noted
| ID | Scenario | Expected |
|----|----------|----------|
| N01 | SuperAdmin creates an Admin | `managerId` NULL, no assignmentType |
| N02 / N03 | SuperAdmin creates a standalone User; database row | `managerId` = SuperAdmin id (API and DB), `managerRole` SuperAdmin, `assignmentType` Standalone |
| N04 - N04d | SuperAdmin creates a User under an Admin; explicit own id; invalid managers (nonexistent, a User, Admin with manager, inactive Admin) | 201 AdminManaged / 400 |
| N05 / N05b | Admin creates a User (manager derived from caller; own id accepted) | 201, `managerId` = Admin |
| N06 / N07 / N07b | Admin creates under another Admin or the SuperAdmin; creates Admin/SuperAdmin; User creates | 403 / 403,400 / 403; nothing created |
| N08 / N08b | `GET /admins/{adminId}/users` equals the DB set for that Admin; paging; response shape | exact match, `adminId`, `adminName`, `totalCount` |
| N09 / N09b / N09c | Admin lists another Admin; User; non-Admin id; unknown id; no token | 403 (no data) / 403 / 404 / 404 / 401 |
| N10 / N10b / N10c | `POST /admins/{adminId}/users` as SuperAdmin, as Admin (own / another); errors | 201 / 201 / 403; 403, 404, 400, 409, 400 |
| N11 / N11b / N11c | `GET /superadmin/users` equals the DB set of SuperAdmin-managed Users; search, paging, fields, no password data; Admin/User/anonymous | exact match / 403 / 401 |
| N12 | Move a User Admin A to Admin B | same id, new `managerId`, lists follow |
| N13 | Move Admin-managed User to standalone (`managerId` = SuperAdmin id) | Standalone |
| N14 | Move standalone User under an Admin | AdminManaged |
| N15 / N15b | Ids and ManagerIds consistent after every move; idempotent re-assignment | ok / 200 |
| N16 / N16b / N16c | Invalid assignments (null, missing, inactive Admin, User as manager, unknown id); Admin/SuperAdmin targets and self-assignment; non-SuperAdmin callers | 400 / 400 / 403, 401, 404 |
| N17 / N17b | PUT with `role`/`managerId` in the body; User tries to change own manager | ignored / 403 |
| N18 / N18b | Admin general list scope; Admin vs standalone Users (GET/PUT/status/reset/devices) | own Users only / 404 |
| N19 | Admin vs another Admin's Users and the Admin account itself | 404 |
| N20 / N21 / N21b / N21c | Device + sensor visibility follows the manager (A1, A2, standalone, owner, SuperAdmin; latest/history; assign/unassign) | per scope |
| N22 / N22b | Manager moves preserve the User, assignment and all readings; assignment API still works | ok |
| N23 / N23b / N23c | Login/refresh after reassignment; reset revokes refresh tokens; last SuperAdmin protected | ok |
| N24 / N24b | OpenAPI contains the new endpoints with Bearer security and 400/401/403/404/409; `managerId` replaces `adminId` in schemas | ok |
| N25 / N25b | Users columns (ManagerId, no AdminId); FK, checks, trigger, indexes | ok |
| N26 / N26b | DB rejects 6 invalid manager shapes; accepts valid ones | BLOCKED / ALLOWED |
| N27 / N27b / N27c | `GET /users` filters (role, managerId, standalone, search); Admin cannot widen scope via query; manager fields on `GET /users/{id}` | ok / 403 |
| M02 / M04 | Manual: Swagger UI executions as an Admin; migration rehearsal (guard, copy, Down/Up, DB rules) | pass |

## Phase 4 - public listener guard and ingest rate limit (automated)
| ID | Scenario | Expected |
|----|----------|----------|
| P01 | Valid ingest through the public listener | 201 and stored |
| P02 | 36 other method/path combinations (login, users, devices, reads, health, Swagger, admin routes, wrong verbs, trailing slash / path tricks) with a valid SuperAdmin JWT and device key attached | empty 404 each |
| P03 | Private listener unaffected (health, login, users, Swagger) | 200 |
| P04 | Public ingest error contract: no key / invalid value / duplicate / unknown device | 401 / 400 / 409 / 401 (ApiError JSON) |
| P05 | Spoofed Host / X-Forwarded-* headers on the public listener | still 404 (guard uses the real local port) |
| P06 | A reading accepted on the public listener is visible via the private API | ok |
| P07 | Ingest is rate limited per client IP (limit 3/min in a dedicated instance) | 401 x3 then 429 |

UAT mode (`VV_*` environment variables, SQL login over an SSH tunnel, safety assertion on SQL Server major version and server name) ran the full suite, including P-series, against the UAT SQL Server 2025 instance: 209 passed, 0 failed.


## Stage B additions (P1 API quality, P2 authentication, P3 database)

Run with `Tests/Run-ApiTests.ps1` (UAT mode needs `VV_SQL_USER` = migration login, `VV_APP_USER` = restricted runtime login the API runs as).
The script first runs the explicit `--migration-status` / `--migrate` commands, then starts the API with the runtime login only.

| ID | Scenario |
|---|---|
| M01-M07 | Explicit migration command, idempotent re-run, start-up does not migrate (legacy flag ignored + warning), production/wrong-DB/no-login guards (exit 2), active sessions survive migration, new columns present, history row |
| G01-G05 | Runtime login: not db_owner/ddladmin/sysadmin; CREATE/ALTER/DROP INDEX/CREATE TRIGGER denied; DELETE denied on Users/Devices/DeviceAssignments/SensorData; SELECT/UPDATE and DELETE on RefreshTokens allowed; the API really runs with that login |
| X01-X02 | Duplicate index IX_Devices_DeviceId gone; AK_Devices_DeviceId + FK remain; DeviceId uniqueness and sensor-data FK still enforced by the database |
| T01-T04 | Refresh-token cleanup: expired > 30 days removed (two batches), active / revoked-unexpired / recently-expired kept, pre-existing sessions untouched, logged |
| L01-L09 | Lockout: 5 failures lock (correct password refused), temporary (~15 min), indistinguishable 401s (unknown / wrong / locked / disabled), no extension while locked, expiry recovery, counter reset, admin reset recovery, concurrent attempts atomic, SuperAdmin never failed |
| R01-R09 | Refresh: rotation chain, families, reuse revokes the family, other login unaffected, DB state, concurrent refresh = exactly one success, expired token, logout-revoked token, SECURITY log line without token value |
| C01-C11 | change-password: 401 anonymous, wrong current (400), policy (short / no digit / same / missing), success + fresh session + no password material, old/new password, target is always the caller, other sessions revoked, BCrypt hash changed, Admin can use it, brute force via stolen token locks (429), disabled user refused |
| H01-H17 | X-Request-Id on all responses and = traceId, echo/replace rules, security headers on 200/401/404/400 and public 404, no Server header, RFC 7807 fields + legacy fields, actionable validation errors, 413 on login and on ingest, access-log line format and user id, no secrets in logs, path redaction, masked e-mail in failed-login logs, 500 body generic + stack trace only in server log under the same request id |
| O01-O06 | OpenAPI: unique operationIds, documented error responses per operation, ApiError RFC 7807 fields + X-Request-Id header, additive-only compatibility with the Stage A contract (baseline file), exactly one new route, change-password documented |
| Q01-Q05 | includeTotal=false (totals null, hasNextPage), default unchanged, all 7 other list endpoints, invalid value 400, filters still apply |
| Z01-Z03 | SuperAdmin-only endpoints reject Admin/User/anonymous; route-id tampering returns 404; ESP32 ingestion contract unchanged |
| IN1-IN5 | Live-device compatibility: optional dataDate/dataTime, IST default timestamp, 6 h clock tolerance, stored-hash key refused by default and accepted only with `DeviceAuth:AcceptStoredHashAsKey` |
| A19, A19b | Login rate limit and 429 body/Retry-After/headers (throwaway instance with limit 5) |

`S21b` is reported as **skipped**: the UAT `SensorData.created_at` default was changed outside the migrations to `UTC + 330 min`; it is reported, not altered.
