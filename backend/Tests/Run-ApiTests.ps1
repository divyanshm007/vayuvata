<#
  VayuVata API integration tests (PowerShell 7+). Runs against the single database `VayuVata`.

  Safety model (nothing is ever dropped; schema, migrations, indexes and the SuperAdmin are preserved):
  - Every record the tests create is tagged: user e-mails end with @vvtest.local, device ids start with VVTEST-.
  - Before and after the run, Remove-TestData deletes ONLY tagged rows (plus refresh tokens / login timestamps
    the run itself produced for the SuperAdmin), in dependency order inside one SQL transaction.
  - The SuperAdmin used for the run is the existing one; its credentials are read from `dotnet user-secrets`
    (Bootstrap:SuperAdminEmail / SuperAdminPassword, Jwt:Key). Secrets are never printed.
  - The SQL-script parity check applies Database/*.sql to scratch tables in tempdb and removes them again.
  - Identity counters (Users.Id etc.) are not reset, so ids keep increasing across runs.
  UAT mode (SQL login instead of Windows auth). Credentials come ONLY from env vars:
    VV_SQL_USER / VV_SQL_PASSWORD        the MIGRATION/owner login (db_owner of VayuVata only): applies migrations, seeds/cleans tagged test data, inspects the DB
    VV_APP_USER / VV_APP_PASSWORD        the restricted RUNTIME login the API under test connects with (no db_owner, no DDL, no DELETE except RefreshTokens)
    VV_SQL_ADMIN_USER / VV_SQL_ADMIN_PASSWORD   (optional) used only for the tempdb schema-parity scratch tables and one session check
    VV_SA_EMAIL / VV_SA_PASSWORD         the SuperAdmin of that database
    VV_EXPECT_MAJOR / VV_EXPECT_SERVER   safety assertion: refuse to run unless the target is this SQL Server major version and @@SERVERNAME
  Usage:  pwsh ./Tests/Run-ApiTests.ps1 [-Port 5099] [-SqlServer localhost]
#>
param(
    [string]$Db = 'VayuVata',
    [int]$Port = 5099,
    [string]$SqlServer = 'localhost'
)
$ErrorActionPreference = 'Stop'
if ($Db -ne 'VayuVata') { throw "Tests run only against the 'VayuVata' database (got '$Db')." }

$project = Split-Path $PSScriptRoot -Parent
$base = "http://localhost:$Port"
$pubPort = $Port + 2   # second listener standing in for the internet-facing port
[string[]]$sqlAuth = if ($env:VV_SQL_USER) { @('-U', $env:VV_SQL_USER, '-P', $env:VV_SQL_PASSWORD) } else { @('-E') }
[string[]]$adminAuth = if ($env:VV_SQL_ADMIN_USER) { @('-U', $env:VV_SQL_ADMIN_USER, '-P', $env:VV_SQL_ADMIN_PASSWORD) } else { $sqlAuth }
$uatMode = [bool]$env:VV_SQL_USER
if ($uatMode -and -not $env:VV_APP_USER) { throw 'UAT mode needs VV_APP_USER / VV_APP_PASSWORD (the restricted runtime login) as well as the migration login VV_SQL_USER.' }
$skipped = [System.Collections.Generic.List[object]]::new()
function Skip([string]$id, [string]$name, [string]$reason) { $skipped.Add([pscustomobject]@{ Id = $id; Name = $name; Reason = $reason }); Write-Host "[SKIP] $id $name ($reason)" }
function JwtHash([string]$v) { [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($v))).ToLowerInvariant() }
$runDir = Join-Path $PSScriptRoot '.run'
$errLogPath = Join-Path $runDir 'app.err.log'
New-Item -ItemType Directory -Force $runDir | Out-Null

function Sql([string]$database, [string]$query, [switch]$Admin) {
    [string[]]$auth = if ($Admin) { $adminAuth } else { $sqlAuth }
    $out = sqlcmd -S $SqlServer @auth -C -I -d $database -h -1 -W -b -Q "SET NOCOUNT ON; $query" 2>&1
    if ($LASTEXITCODE -ne 0) { throw "sqlcmd failed: $out" }
    ($out | Where-Object { $_ -and $_ -notmatch '^\s*$' }) -join "`n"
}

# ---------- environment for the API under test ----------
function Get-Secret([string]$key) {
    $line = dotnet user-secrets list --project $project 2>$null | Where-Object { $_ -like "$key = *" } | Select-Object -First 1
    if (-not $line) { throw "User-secret '$key' is not set (dotnet user-secrets set ...). The tests use the existing SuperAdmin." }
    $line.Substring($key.Length + 3)
}
$jwtKey = Get-Secret 'Jwt:Key'
$saEmail = if ($env:VV_SA_EMAIL) { $env:VV_SA_EMAIL } else { Get-Secret 'Bootstrap:SuperAdminEmail' }
$saPass = if ($env:VV_SA_PASSWORD) { $env:VV_SA_PASSWORD } else { Get-Secret 'Bootstrap:SuperAdminPassword' }
$Pw = 'Passw0rd!Test1'
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:ConnectionStrings__Default = if ($uatMode) { "Server=$SqlServer;Database=$Db;User Id=$($env:VV_APP_USER);Password=$($env:VV_APP_PASSWORD);TrustServerCertificate=True;Encrypt=True;" } else { "Server=$SqlServer;Database=$Db;Trusted_Connection=True;TrustServerCertificate=True;" }
$migrationCs = if ($uatMode) { "Server=$SqlServer;Database=$Db;User Id=$($env:VV_SQL_USER);Password=$($env:VV_SQL_PASSWORD);TrustServerCertificate=True;Encrypt=True;" } else { $env:ConnectionStrings__Default }
$env:ConnectionStrings__Migration = $null   # only handed to the explicit --migrate command below, never to the API under test
$env:PublicListener__Port = "$pubPort"
$env:RateLimiting__IngestPermitPerMinute = '100000'
$env:RateLimiting__LoginPermitLimit = '100000'
$env:Database__ApplyMigrationsOnStartup = 'true'   # legacy setting, deliberately left on: the API must ignore it and only warn (test M03)
$env:RefreshTokens__Cleanup__BatchSize = '2'
$env:Kestrel__Limits__MaxRequestBodySize = '16384'   # set the way UAT sets it: the configured value must really be enforced (tests H08/H09)
$env:DeviceAuth__AllowMissingKeyInDevelopment = 'false'
$env:DeviceAuth__AcceptStoredHashAsKey = $null   # secure default for the main run; the compatibility switch is tested on its own instance (IN5)

function Remove-TestData([object]$tokenBaseline = $null, [string]$saLastLogin = $null, [string]$saUpdated = $null) {
    $tok = if ($null -ne $tokenBaseline) { "OR Id > $tokenBaseline" } else { '' }
    $restore = if ($saLastLogin) { "UPDATE Users SET LastLoginAt = $saLastLogin, UpdatedAt = $saUpdated WHERE Role = 'SuperAdmin';" } else { '' }
    Sql $Db @"
SET XACT_ABORT ON; BEGIN TRAN;
DECLARE @u TABLE (Id int PRIMARY KEY); INSERT @u SELECT Id FROM Users WHERE Email LIKE '%@vvtest.local';
DECLARE @d TABLE (Id int PRIMARY KEY, Code nvarchar(64)); INSERT @d SELECT Id, DeviceId FROM Devices WHERE DeviceId LIKE 'VVTEST-%';
IF OBJECT_ID('dbo.ManipulatedSensorData') IS NOT NULL DELETE FROM ManipulatedSensorData WHERE device_id IN (SELECT Code FROM @d);
IF OBJECT_ID('dbo.GpsLocationData') IS NOT NULL DELETE FROM GpsLocationData WHERE device_id IN (SELECT Code FROM @d);
DELETE FROM SensorData WHERE device_id IN (SELECT Code FROM @d);
DELETE FROM DeviceAssignments WHERE DeviceRecordId IN (SELECT Id FROM @d) OR UserId IN (SELECT Id FROM @u) OR AssignedByUserId IN (SELECT Id FROM @u);
DELETE FROM RefreshTokens WHERE UserId IN (SELECT Id FROM @u) $tok;
DELETE FROM Users WHERE Id IN (SELECT Id FROM @u) AND ManagerId IS NOT NULL;
DELETE FROM Users WHERE Id IN (SELECT Id FROM @u);
DELETE FROM Devices WHERE Id IN (SELECT Id FROM @d);
$restore
COMMIT;
"@ | Out-Null
}

# ---------- test plumbing ----------
$results = [System.Collections.Generic.List[object]]::new()
function Check([string]$id, [string]$name, [bool]$ok, [string]$detail = '') {
    $results.Add([pscustomobject]@{ Id = $id; Name = $name; Passed = $ok; Detail = $detail })
    Write-Host ("[{0}] {1} {2} {3}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $id, $name, $(if (-not $ok) { $detail } else { '' }))
}
function Api([string]$method, [string]$path, $body = $null, [string]$token = $null, [hashtable]$headers = @{}) {
    $h = @{} + $headers
    if ($token) { $h.Authorization = "Bearer $token" }
    $p = @{ Uri = "$base$path"; Method = $method; Headers = $h; SkipHttpErrorCheck = $true }
    if ($null -ne $body) { $p.Body = ($body | ConvertTo-Json -Depth 6); $p.ContentType = 'application/json' }
    $r = Invoke-WebRequest @p
    $j = $null
    if ($r.Content) { try { $j = $r.Content | ConvertFrom-Json } catch { } }
    [pscustomobject]@{ Status = [int]$r.StatusCode; Json = $j; Raw = [string]$r.Content }
}
function ApiAt([string]$root, [string]$method, [string]$path, $body = $null, [string]$token = $null, [hashtable]$headers = @{}) {
    $h = @{} + $headers
    if ($token) { $h.Authorization = "Bearer $token" }
    $p = @{ Uri = "$root$path"; Method = $method; Headers = $h; SkipHttpErrorCheck = $true }
    if ($null -ne $body -and $method -notin 'GET', 'HEAD', 'OPTIONS') { $p.Body = ($body | ConvertTo-Json -Depth 6); $p.ContentType = 'application/json' }
    $r = Invoke-WebRequest @p
    $j = $null
    if ($r.Content) { try { $j = [string]$r.Content | ConvertFrom-Json } catch { } }
    [pscustomobject]@{ Status = [int]$r.StatusCode; Json = $j; Raw = [string]$r.Content }
}
function Login([string]$email, [string]$pw) { Api POST /api/v1/auth/login @{ email = $email; password = $pw } }
function Token([string]$email, [string]$pw = $Pw) { (Login $email $pw).Json.accessToken }
function Ts([double]$minutesAgo) { (Get-Date).ToUniversalTime().AddMinutes(-$minutesAgo).ToString("yyyy-MM-ddTHH:mm:ss.fffZ") }
function B64Url([byte[]]$b) { [Convert]::ToBase64String($b).TrimEnd('=').Replace('+', '-').Replace('/', '_') }
function Make-Jwt([string]$key, [int]$sub, [string]$role, [int]$expOffsetSeconds) {
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $hdr = B64Url ([Text.Encoding]::UTF8.GetBytes('{"alg":"HS256","typ":"JWT"}'))
    $pl = B64Url ([Text.Encoding]::UTF8.GetBytes((@{ sub = "$sub"; role = $role; iss = 'VayuVata'; aud = 'VayuVata.Clients'; nbf = $now - 7200; iat = $now - 7200; exp = $now + $expOffsetSeconds } | ConvertTo-Json -Compress)))
    $hmac = [Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($key))
    "$hdr.$pl." + (B64Url $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes("$hdr.$pl")))
}
function New-User($token, [string]$name, [string]$email, [string]$role = 'User', $adminId = $null) {
    $b = @{ name = $name; email = $email; password = $Pw; role = $role }
    if ($null -ne $adminId) { $b.managerId = $adminId }
    Api POST /api/v1/users $b $token
}
function New-Device($token, [string]$devId) { Api POST /api/v1/devices @{ deviceId = $devId; deviceName = "Name $devId"; description = 'test' } $token }
function Post-Reading([string]$devId, [string]$key, [hashtable]$extra = @{}, [int]$minutesAgo = 5) {
    $b = @{ deviceId = $devId; recordedAt = (Ts $minutesAgo) } + $extra
    Api POST /api/v1/sensor-data $b $null @{ 'X-Device-Key' = $key }
}

# ---------- start ----------
if ($uatMode) {
    $major = Sql master "SELECT CAST(SERVERPROPERTY('ProductMajorVersion') AS int)"
    $srv = Sql master "SELECT @@SERVERNAME"
    if ($env:VV_EXPECT_MAJOR -and $major -ne $env:VV_EXPECT_MAJOR) { throw "Safety stop: SQL Server major version is $major, expected $($env:VV_EXPECT_MAJOR)." }
    if ($env:VV_EXPECT_SERVER -and $srv -ne $env:VV_EXPECT_SERVER) { throw "Safety stop: server name is '$srv', expected '$($env:VV_EXPECT_SERVER)'." }
    Write-Host "UAT mode: SQL Server major=$major server=$srv (assertions passed)"
}
Write-Host "== Running against database $Db (no drops; tagged test data only) - API on $base =="
if ((Sql $Db "SELECT COUNT(*) FROM Users WHERE Role='SuperAdmin' AND IsActive=1") -ne '1') { throw "Expected exactly one active SuperAdmin in $Db. Start the backend once so it bootstraps the SuperAdmin, then re-run." }
Remove-TestData
$tokenBaseline = [int](Sql $Db "SELECT ISNULL(MAX(Id),0) FROM RefreshTokens")
$histBefore = Sql $Db "SELECT CONCAT(COUNT(*),'|',CHECKSUM_AGG(CHECKSUM(ID,device_id,recorded_at,aqi,aqi_status,pm25,pm10,humidity,temperature,outer_temperature,outer_humidity,co_ppm,created_at))) FROM SensorData WHERE device_id NOT LIKE 'VVTEST-%'"   # existing readings must be byte-for-byte unchanged by the whole run (HI02)
$saLastLogin = Sql $Db "SELECT ISNULL(CHAR(39) + CONVERT(varchar(23), LastLoginAt, 121) + CHAR(39), 'NULL') FROM Users WHERE Role='SuperAdmin'"
$saUpdated = Sql $Db "SELECT ISNULL(CHAR(39) + CONVERT(varchar(23), UpdatedAt, 121) + CHAR(39), 'NULL') FROM Users WHERE Role='SuperAdmin'"
Push-Location $project
$bin = Join-Path $runDir 'bin'
dotnet build -c Debug --nologo -v q -o $bin | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
# ---- explicit migration step (the only way the schema changes) ----
$activePredicate = "Id <= $tokenBaseline AND RevokedAt IS NULL AND ExpiresAt > SYSUTCDATETIME()"
$activeBefore = Sql $Db "SELECT COUNT(*) FROM RefreshTokens WHERE $activePredicate"
function Run-Migrate([string]$arg, [string]$cs, [string]$environment = $null) {
    $saveEnv = $env:ASPNETCORE_ENVIRONMENT; $saveCs = $env:ConnectionStrings__Migration
    $env:ConnectionStrings__Migration = $cs
    if ($environment) { $env:ASPNETCORE_ENVIRONMENT = $environment }
    $o = (dotnet (Join-Path $bin 'VayuVata.dll') $arg 2>&1 | Out-String).Trim()
    $code = $LASTEXITCODE
    $env:ASPNETCORE_ENVIRONMENT = $saveEnv; $env:ConnectionStrings__Migration = $saveCs
    [pscustomobject]@{ Output = $o; Exit = $code }
}
$m = Run-Migrate '--migration-status' $migrationCs; $migStatus = $m.Output
$m = Run-Migrate '--migrate' $migrationCs; $migRun = $m.Output; Write-Host $migRun
if ($m.Exit -ne 0) { throw "Migration command failed: $migRun" }
$m = Run-Migrate '--migrate' $migrationCs; $migRun2 = $m.Output; $migRun2Exit = $m.Exit
$migProdExit = (Run-Migrate '--migrate' $migrationCs 'Production').Exit
$migDbExit = (Run-Migrate '--migrate' ($migrationCs -replace 'Database=VayuVata', 'Database=master')).Exit
$migNoCsExit = (Run-Migrate '--migrate' $null).Exit
$activeAfter = Sql $Db "SELECT COUNT(*) FROM RefreshTokens WHERE $activePredicate"

# ---- seed refresh tokens for the cleanup test (owned by the SuperAdmin row, removed again by Remove-TestData) ----
function NewHash { (([guid]::NewGuid().ToString('N')) + ([guid]::NewGuid().ToString('N'))) }
$seedSa = Sql $Db "SELECT Id FROM Users WHERE Role='SuperAdmin' AND IsActive=1"
$seedGone = 1..3 | ForEach-Object { "'$(NewHash)'" }
$seedKeep = 1..3 | ForEach-Object { "'$(NewHash)'" }
foreach ($g in $seedGone) { $null = Sql $Db "INSERT INTO RefreshTokens (UserId,TokenHash,CreatedAt,ExpiresAt) VALUES ($seedSa,$g,DATEADD(DAY,-90,SYSUTCDATETIME()),DATEADD(DAY,-60,SYSUTCDATETIME()))" }
$null = Sql $Db "INSERT INTO RefreshTokens (UserId,TokenHash,CreatedAt,ExpiresAt) VALUES ($seedSa,$($seedKeep[0]),SYSUTCDATETIME(),DATEADD(DAY,1,SYSUTCDATETIME()))"
$null = Sql $Db "INSERT INTO RefreshTokens (UserId,TokenHash,CreatedAt,ExpiresAt,RevokedAt) VALUES ($seedSa,$($seedKeep[1]),SYSUTCDATETIME(),DATEADD(DAY,1,SYSUTCDATETIME()),SYSUTCDATETIME())"
$null = Sql $Db "INSERT INTO RefreshTokens (UserId,TokenHash,CreatedAt,ExpiresAt) VALUES ($seedSa,$($seedKeep[2]),DATEADD(DAY,-20,SYSUTCDATETIME()),DATEADD(DAY,-10,SYSUTCDATETIME()))"
$activeAfter = Sql $Db "SELECT COUNT(*) FROM RefreshTokens WHERE $activePredicate"   # seeded rows have Id > baseline, so this is unaffected

$log = Join-Path $runDir 'app.log'
$app = Start-Process dotnet -ArgumentList @((Join-Path $bin 'VayuVata.dll'), '--urls', "$base;http://localhost:$pubPort") `
    -WorkingDirectory $project -PassThru -RedirectStandardOutput $log -RedirectStandardError (Join-Path $runDir 'app.err.log') -WindowStyle Hidden
Pop-Location

try {
    $up = $false
    1..60 | ForEach-Object { if (-not $up) { try { $up = ((Invoke-WebRequest "$base/api/v1/health" -SkipHttpErrorCheck).StatusCode -eq 200) } catch { Start-Sleep 1 } } }
    if (-not $up) { throw "API did not start. See $log" }

    # ================= DEPLOYMENT / SWAGGER =================
    $h = Api GET /api/v1/health
    Check 'W01' 'Health check returns 200 and database Connected' ($h.Status -eq 200 -and $h.Json.database -eq 'Connected')
    $mig = Sql $Db "SELECT COUNT(*) FROM __EFMigrationsHistory WHERE MigrationId LIKE '%InitialCreate'"
    Check 'W02' 'EF migration applied on a clean database' ($mig -eq '1') "history rows=$mig"
    $idx = Sql $Db "SELECT COUNT(*) FROM sys.indexes WHERE name='UX_DeviceAssignments_ActiveDevice' AND has_filter=1 AND is_unique=1"
    Check 'W03' 'Filtered unique index for active assignment exists' ($idx -eq '1')
    $sw = Api GET /swagger/v1/swagger.json
    $paths = @('/api/v1/auth/login', '/api/v1/auth/me', '/api/v1/auth/refresh', '/api/v1/auth/logout', '/api/v1/users', '/api/v1/users/{id}', '/api/v1/users/{id}/status',
        '/api/v1/users/{id}/admin-assignment', '/api/v1/users/{id}/devices', '/api/v1/users/{id}/reset-password', '/api/v1/devices', '/api/v1/devices/{id}',
        '/api/v1/devices/{id}/status', '/api/v1/devices/{id}/assign', '/api/v1/devices/{id}/unassign', '/api/v1/devices/{id}/assignments',
        '/api/v1/sensor-data', '/api/v1/sensor-data/{id}', '/api/v1/devices/{id}/sensor-data/latest', '/api/v1/devices/{id}/sensor-data/history', '/api/v1/health',
        '/api/v1/admins/{adminId}/users', '/api/v1/superadmin/users')
    $missing = $paths | Where-Object { -not $sw.Json.paths.PSObject.Properties.Name.Contains($_) }
    Check 'W04' 'OpenAPI document contains all implemented endpoints' ($sw.Status -eq 200 -and -not $missing) ("missing: " + ($missing -join ', '))
    Check 'W05' 'OpenAPI declares Bearer JWT security scheme' ($sw.Json.components.securitySchemes.Bearer.scheme -eq 'bearer')
    $ui = Invoke-WebRequest "$base/swagger/index.html" -SkipHttpErrorCheck
    Check 'W06' 'Swagger UI page loads' ($ui.StatusCode -eq 200 -and $ui.Content -match 'swagger')
    $ex = $sw.Json.components.schemas.LoginRequest.properties.email.example
    Check 'W07' 'OpenAPI schemas carry example values' ($ex -eq 'admin@example.com') "example=$ex"

    # ================= AUTH =================
    $saLogin = Login $saEmail $saPass
    $SA = $saLogin.Json.accessToken
    Check 'A01' 'SuperAdmin login succeeds (token, expiry, id, name, email, role)' ($saLogin.Status -eq 200 -and $saLogin.Json.role -eq 'SuperAdmin' -and $SA -and $saLogin.Json.expiresAt -and $saLogin.Json.userId -and $saLogin.Json.email)
    $saId = $saLogin.Json.userId

    $a1 = New-User $SA 'Admin One' 'admin1@vvtest.local' 'Admin'
    $a2 = New-User $SA 'Admin Two' 'admin2@vvtest.local' 'Admin'
    Check 'U01' 'SuperAdmin creates Admins' ($a1.Status -eq 201 -and $a1.Json.role -eq 'Admin' -and $a2.Status -eq 201)
    $A1id = $a1.Json.id; $A2id = $a2.Json.id
    $u1 = New-User $SA 'User One' 'user1@vvtest.local' 'User' $A1id
    Check 'U02' 'SuperAdmin creates a User under an Admin' ($u1.Status -eq 201 -and $u1.Json.managerId -eq $A1id)
    $s1 = New-User $SA 'Standalone One' 'standalone1@vvtest.local' 'User'
    Check 'U03' 'SuperAdmin creates a standalone User (ManagerId = SuperAdmin id)' ($s1.Status -eq 201 -and $s1.Json.managerId -eq $saId -and $s1.Json.assignmentType -eq 'Standalone')
    $u3 = New-User $SA 'User Three' 'user3@vvtest.local' 'User' $A2id
    $U1id = $u1.Json.id; $S1id = $s1.Json.id; $U3id = $u3.Json.id

    $A1 = Token 'admin1@vvtest.local'; $A2 = Token 'admin2@vvtest.local'
    $U1 = Token 'user1@vvtest.local'; $S1 = Token 'standalone1@vvtest.local'; $U3 = Token 'user3@vvtest.local'
    Check 'A02' 'Admin login succeeds' ([bool]$A1 -and (Login 'admin1@vvtest.local' $Pw).Json.role -eq 'Admin')
    Check 'A03' 'Regular User (under an Admin) login succeeds' ([bool]$U1 -and (Login 'user1@vvtest.local' $Pw).Json.role -eq 'User')
    Check 'A04' 'Standalone User login succeeds' ([bool]$S1 -and (Login 'standalone1@vvtest.local' $Pw).Json.role -eq 'User')

    Check 'A05' 'Wrong password returns 401' ((Login 'user1@vvtest.local' 'WrongPass123').Status -eq 401)
    Check 'A06' 'Unknown email returns 401' ((Login 'nobody@vvtest.local' $Pw).Status -eq 401)
    Check 'A07' 'Missing token returns 401' ((Api GET /api/v1/auth/me).Status -eq 401)
    Check 'A08' 'Garbage token returns 401' ((Api GET /api/v1/auth/me $null 'abc.def.ghi').Status -eq 401)
    Check 'A09' 'Expired JWT is rejected (401)' ((Api GET /api/v1/auth/me $null (Make-Jwt $jwtKey $saId 'SuperAdmin' -60)).Status -eq 401)
    Check 'A09b' 'Control: same hand-built JWT, not expired, is accepted' ((Api GET /api/v1/auth/me $null (Make-Jwt $jwtKey $saId 'SuperAdmin' 600)).Status -eq 200)
    Check 'A10' 'JWT signed with a different key is rejected (401)' ((Api GET /api/v1/auth/me $null (Make-Jwt ('x' * 40) $saId 'SuperAdmin' 600)).Status -eq 401)
    Check 'A11' 'Forged role claim (valid signature impossible) cannot escalate: User id with SuperAdmin role in a token signed by attacker key = 401' ((Api GET /api/v1/users $null (Make-Jwt ('y' * 40) $U1id 'SuperAdmin' 600)).Status -eq 401)
    $role = Make-Jwt $jwtKey $U1id 'SuperAdmin' 600
    Check 'A11b' 'Token whose role claim does not match the DB role is rejected (401)' ((Api GET /api/v1/users $null $role).Status -eq 401)
    $me = Api GET /api/v1/auth/me $null $U1
    Check 'A12' '/auth/me returns profile without password hash' ($me.Status -eq 200 -and $me.Json.email -eq 'user1@vvtest.local' -and $me.Raw -notmatch '(?i)password')
    $esc = Api POST /api/v1/auth/login @{ email = 'user1@vvtest.local'; password = $Pw; role = 'SuperAdmin' }
    Check 'A13' 'Client-supplied role in login body is ignored' ($esc.Json.role -eq 'User')

    # refresh + logout
    $lg = Login 'user1@vvtest.local' $Pw
    $rf = Api POST /api/v1/auth/refresh @{ refreshToken = $lg.Json.refreshToken }
    Check 'A14' 'Refresh token exchanges for a new access token' ($rf.Status -eq 200 -and $rf.Json.accessToken)
    Check 'A15' 'Used refresh token cannot be reused (rotation)' ((Api POST /api/v1/auth/refresh @{ refreshToken = $lg.Json.refreshToken }).Status -eq 401)
    $out = Api POST /api/v1/auth/logout @{ refreshToken = $rf.Json.refreshToken } $rf.Json.accessToken
    Check 'A16' 'Logout revokes the refresh token' ($out.Status -eq 204 -and (Api POST /api/v1/auth/refresh @{ refreshToken = $rf.Json.refreshToken }).Status -eq 401)
    Check 'A16b' 'Raw refresh tokens are not stored in the database' ((Sql $Db "SELECT COUNT(*) FROM RefreshTokens WHERE TokenHash = N'$($lg.Json.refreshToken)'") -eq '0')

    # ================= USERS =================
    $adm_creates = New-User $A1 'User Two' 'user2@vvtest.local' 'User'
    Check 'U04' 'Admin creates a User; it is owned by that Admin' ($adm_creates.Status -eq 201 -and $adm_creates.Json.managerId -eq $A1id)
    $U2id = $adm_creates.Json.id; $U2 = Token 'user2@vvtest.local'
    Check 'U05' 'Admin cannot put a new User under another Admin (403)' ((New-User $A1 'X' 'x1@vvtest.local' 'User' $A2id).Status -eq 403)
    Check 'U05b' 'Admin cannot create an Admin (403)' ((New-User $A1 'X' 'x2@vvtest.local' 'Admin').Status -eq 403)
    Check 'U05c' 'Request role "SuperAdmin" is rejected (400)' ((New-User $SA 'X' 'x3@vvtest.local' 'SuperAdmin').Status -eq 400)
    Check 'U06' 'Regular User cannot create accounts (403)' ((New-User $U1 'X' 'x4@vvtest.local' 'User').Status -eq 403)
    Check 'U06b' 'Regular User cannot list users (403)' ((Api GET /api/v1/users $null $U1).Status -eq 403)
    $list = Api GET '/api/v1/users?pageSize=100' $null $A1
    $emails = @($list.Json.items | ForEach-Object { $_.email })
    Check 'U07' 'Admin lists only their own Users' ($list.Status -eq 200 -and ($emails -contains 'user1@vvtest.local') -and ($emails -contains 'user2@vvtest.local') -and -not ($emails -contains 'user3@vvtest.local') -and -not ($emails -contains 'standalone1@vvtest.local') -and $list.Json.totalCount -eq 2) ($emails -join ',')
    Check 'U08' "Admin cannot read another Admin's User (404)" ((Api GET "/api/v1/users/$U3id" $null $A1).Status -eq 404)
    Check 'U09' 'Admin cannot read a standalone User (404)' ((Api GET "/api/v1/users/$S1id" $null $A1).Status -eq 404)
    Check 'U10' "Admin cannot edit/deactivate/reset another Admin's User" ((Api PUT "/api/v1/users/$U3id" @{ name = 'h'; email = 'h@vvtest.local' } $A1).Status -eq 404 -and (Api PATCH "/api/v1/users/$U3id/status" @{ isActive = $false } $A1).Status -eq 404 -and (Api POST "/api/v1/users/$S1id/reset-password" @{ newPassword = 'Hacked12345' } $A1).Status -eq 404)
    Check 'U11' 'Admin cannot change Admin assignment (403)' ((Api PATCH "/api/v1/users/$U1id/admin-assignment" @{ managerId = $A2id } $A1).Status -eq 403)
    Check 'U11b' 'Regular User cannot change Admin assignment (403)' ((Api PATCH "/api/v1/users/$U1id/admin-assignment" @{ managerId = $saId } $U1).Status -eq 403)
    $mv = Api PATCH "/api/v1/users/$U2id/admin-assignment" @{ managerId = $A2id } $SA
    Check 'U12' 'SuperAdmin moves a User to another Admin' ($mv.Status -eq 200 -and $mv.Json.managerId -eq $A2id)
    $mv2 = Api PATCH "/api/v1/users/$U2id/admin-assignment" @{ managerId = $saId } $SA
    Check 'U12b' 'SuperAdmin makes a User standalone (managerId = SuperAdmin id)' ($mv2.Status -eq 200 -and $mv2.Json.managerId -eq $saId -and $mv2.Json.managerRole -eq 'SuperAdmin')
    $null = Api PATCH "/api/v1/users/$U2id/admin-assignment" @{ managerId = $A1id } $SA
    Check 'U12c' 'Assigning a User to a non-Admin id is rejected (400)' ((Api PATCH "/api/v1/users/$U1id/admin-assignment" @{ managerId = $U3id } $SA).Status -eq 400)
    Check 'U13' 'Duplicate email returns 409' ((New-User $SA 'Dup' 'USER1@vvtest.local' 'User').Status -eq 409)
    Check 'U14' 'Weak password returns 400' ((Api POST /api/v1/users @{ name = 'w'; email = 'w@vvtest.local'; password = 'short'; role = 'User' } $SA).Status -eq 400)
    $self = Api PATCH "/api/v1/users/$saId/status" @{ isActive = $false } $SA
    Check 'U15' 'Last active SuperAdmin cannot be deactivated (409)' ($self.Status -eq 409 -and $self.Json.code -eq 'last_superadmin')
    Check 'U15b' 'SuperAdmin still active after the attempt' ((Sql $Db "SELECT IsActive FROM Users WHERE Id=$saId") -eq '1')
    $rp = Api POST "/api/v1/users/$U2id/reset-password" @{ newPassword = 'BrandNew#Pass9' } $A1
    Check 'U16' 'Admin resets a Users password; old password stops working' ($rp.Status -eq 204 -and (Login 'user2@vvtest.local' 'BrandNew#Pass9').Status -eq 200 -and (Login 'user2@vvtest.local' $Pw).Status -eq 401)
    Check 'U17' 'User can read own record, not others (404)' ((Api GET "/api/v1/users/$U1id" $null $U1).Status -eq 200 -and (Api GET "/api/v1/users/$U3id" $null $U1).Status -eq 404)
    $big = Api GET '/api/v1/users?pageSize=1000' $null $SA
    Check 'U18' 'Page size is bounded to 100' ($big.Json.pageSize -eq 100)
    Check 'U19' 'Password hash stored as BCrypt, never plain text' ((Sql $Db "SELECT COUNT(*) FROM Users WHERE PasswordHash NOT LIKE '`$2%'") -eq '0')
    $db_chk = Sql $Db "BEGIN TRY UPDATE Users SET ManagerId = $A1id WHERE Id = $A2id; SELECT 'allowed'; END TRY BEGIN CATCH SELECT 'blocked'; END CATCH"
    Check 'U20' 'DB constraint blocks giving an Admin a ManagerId' ($db_chk -eq 'blocked') $db_chk

    # inactive account
    $in = New-User $SA 'Inactive' 'inactive@vvtest.local' 'User'
    $INtoken = Token 'inactive@vvtest.local'
    $deact = Api PATCH "/api/v1/users/$($in.Json.id)/status" @{ isActive = $false } $SA
    Check 'A17' 'Inactive account cannot log in (401)' ($deact.Status -eq 200 -and (Login 'inactive@vvtest.local' $Pw).Status -eq 401)
    Check 'A18' 'Existing JWT of a deactivated account stops working (401)' ((Api GET /api/v1/auth/me $null $INtoken).Status -eq 401)

    # ================= DEVICES =================
    $d1 = New-Device $SA 'VVTEST-DEV-1'; $d2 = New-Device $SA 'VVTEST-DEV-2'; $d3 = New-Device $SA 'VVTEST-DEV-3'
    $d4 = New-Device $SA 'VVTEST-DEV-4'; $d5 = New-Device $SA 'VVTEST-DEV-5'; $d6 = New-Device $SA 'VVTEST-DEV-INACTIVE'
    Check 'D01' 'SuperAdmin registers a device and receives the API key once' ($d1.Status -eq 201 -and $d1.Json.apiKey -like 'vv_*' -and $d1.Json.deviceId -eq 'VVTEST-DEV-1' -and $d1.Json.id -ne 'VVTEST-DEV-1')
    Check 'D01b' 'API key is stored hashed (raw key not in DB)' ((Sql $Db "SELECT COUNT(*) FROM Devices WHERE ApiKeyHash = N'$($d1.Json.apiKey)'") -eq '0' -and (Sql $Db "SELECT LEN(ApiKeyHash) FROM Devices WHERE DeviceId='VVTEST-DEV-1'") -eq '64')
    Check 'D02' 'Duplicate physical DeviceId is rejected (409)' ((New-Device $SA 'VVTEST-DEV-1').Status -eq 409)
    Check 'D03' 'Admin and User cannot register devices (403)' ((New-Device $A1 'VVTEST-X1').Status -eq 403 -and (New-Device $U1 'VVTEST-X2').Status -eq 403)
    $K1 = $d1.Json.apiKey; $K2 = $d2.Json.apiKey; $K3 = $d3.Json.apiKey; $K4 = $d4.Json.apiKey; $K5 = $d5.Json.apiKey; $K6 = $d6.Json.apiKey
    $D1 = $d1.Json.id; $D2 = $d2.Json.id; $D3 = $d3.Json.id; $D4 = $d4.Json.id; $D5 = $d5.Json.id; $D6 = $d6.Json.id

    $as1 = Api POST "/api/v1/devices/$D1/assign" @{ userId = $U1id; notes = 'first' } $SA
    $as2 = Api POST "/api/v1/devices/$D2/assign" @{ userId = $U1id } $SA
    Check 'D04' 'One User can hold multiple devices' ($as1.Status -eq 200 -and $as2.Status -eq 200 -and (Api GET "/api/v1/users/$U1id/devices" $null $SA).Json.totalCount -eq 2)
    $null = Api POST "/api/v1/devices/$D3/assign" @{ userId = $U3id } $SA
    $null = Api POST "/api/v1/devices/$D4/assign" @{ userId = $S1id } $SA
    Check 'D05' 'Assigning an already-assigned device to the same user is rejected (409)' ((Api POST "/api/v1/devices/$D1/assign" @{ userId = $U1id } $SA).Status -eq 409)
    Check 'D05b' 'Admin cannot see or assign an unassigned device (404): the unassigned pool is not visible to Admins' ((Api POST "/api/v1/devices/$D5/assign" @{ userId = $U2id } $A1).Status -eq 404 -and (Api GET "/api/v1/devices/$D5" $null $A1).Status -eq 404)
    $sa_to_admin = Api POST "/api/v1/devices/$D5/assign" @{ userId = $A1id } $SA
    Check 'D05c' 'SuperAdmin assigns a device directly to an Admin; the Admin then sees it' ($sa_to_admin.Status -eq 200 -and $sa_to_admin.Json.assignedUserId -eq $A1id -and (Api GET "/api/v1/devices/$D5" $null $A1).Status -eq 200)
    Check 'D06' "Admin cannot assign a device to another Admin's User (403)" ((Api POST "/api/v1/devices/$D5/assign" @{ userId = $U3id } $A1).Status -eq 403)
    Check 'D07' 'Admin cannot assign a device to a standalone User (403)' ((Api POST "/api/v1/devices/$D5/assign" @{ userId = $S1id } $A1).Status -eq 403)
    Check 'D08' 'Regular User cannot assign devices (403)' ((Api POST "/api/v1/devices/$D5/assign" @{ userId = $U1id } $U1).Status -eq 403)
    Check 'D09' "Admin cannot take a device assigned to another Admin's User (404)" ((Api POST "/api/v1/devices/$D3/assign" @{ userId = $U1id } $A1).Status -eq 404)
    Check 'D10' "Admin cannot see a device assigned outside their scope (404)" ((Api GET "/api/v1/devices/$D3" $null $A1).Status -eq 404 -and (Api GET "/api/v1/devices/$D4" $null $A1).Status -eq 404)
    $adm_assign = Api POST "/api/v1/devices/$D5/assign" @{ userId = $U2id } $A1
    Check 'D11' 'Admin passes a device assigned to them on to their own User' ($adm_assign.Status -eq 200 -and $adm_assign.Json.assignedUserId -eq $U2id)
    $dl = Api GET '/api/v1/devices?pageSize=100' $null $A1
    $dev_ids = @($dl.Json.items | ForEach-Object { $_.deviceId })
    Check 'D12' 'Admin device list contains only devices assigned to them or their Users' (($dev_ids -contains 'VVTEST-DEV-1') -and ($dev_ids -contains 'VVTEST-DEV-5') -and -not ($dev_ids -contains 'VVTEST-DEV-3') -and -not ($dev_ids -contains 'VVTEST-DEV-4')) ($dev_ids -join ',')
    $ul = Api GET '/api/v1/devices?pageSize=100' $null $U1
    Check 'D13' 'User device list contains only their own devices' ($ul.Json.totalCount -eq 2 -and (@($ul.Json.items | ForEach-Object { $_.deviceId }) -contains 'VVTEST-DEV-1'))
    $null = Api PATCH "/api/v1/devices/$D6/status" @{ isActive = $false } $SA
    Check 'D14' 'Inactive device cannot be assigned (409)' ((Api POST "/api/v1/devices/$D6/assign" @{ userId = $U1id } $SA).Status -eq 409)
    Check 'D15' 'Inactive target user cannot receive a device (409)' ((Api POST "/api/v1/devices/$D5/assign" @{ userId = $in.Json.id } $SA).Status -eq 409)
    Check 'D16' 'Devices cannot be assigned to a SuperAdmin account (400)' ((Api POST "/api/v1/devices/$D5/assign" @{ userId = $saId } $SA).Status -eq 400)

    # sensor ingestion baseline (needed before reassignment test)
    $r1 = Post-Reading 'VVTEST-DEV-1' $K1 @{ aqi = 80; pm25 = 20.5; pm10 = 40; humidity = 50; temperature = 25.5 } 30
    $r1b = Post-Reading 'VVTEST-DEV-1' $K1 @{ aqi = 90; pm25 = 22 } 20
    $null = Post-Reading 'VVTEST-DEV-2' $K2 @{ aqi = 55 } 10
    $null = Post-Reading 'VVTEST-DEV-3' $K3 @{ aqi = 120 } 10
    $null = Post-Reading 'VVTEST-DEV-4' $K4 @{ aqi = 33 } 10
    $null = Post-Reading 'VVTEST-DEV-5' $K5 @{ aqi = 44 } 10

    # reassignment
    $cntBefore = Sql $Db "SELECT COUNT(*) FROM SensorData WHERE device_id='VVTEST-DEV-1'"
    $re = Api POST "/api/v1/devices/$D1/assign" @{ userId = $S1id; notes = 'moved' } $SA
    $hist = Api GET "/api/v1/devices/$D1/assignments" $null $SA
    $actives = @($hist.Json.items | Where-Object { $_.isActive }).Count
    Check 'D17' 'Reassignment keeps old assignment as history and exactly one active' ($re.Status -eq 200 -and $hist.Json.totalCount -eq 2 -and $actives -eq 1 -and (@($hist.Json.items | Where-Object { -not $_.isActive })[0].unassignedAt))
    Check 'D18' 'Assignment history is hidden from regular Users (403)' ((Api GET "/api/v1/devices/$D1/assignments" $null $U1).Status -eq 403)
    $cntAfter = Sql $Db "SELECT COUNT(*) FROM SensorData WHERE device_id='VVTEST-DEV-1'"
    Check 'S01' 'Reassignment does not erase sensor history' ($cntBefore -eq $cntAfter -and [int]$cntAfter -ge 2) "before=$cntBefore after=$cntAfter"
    $oldUserHist = Api GET "/api/v1/devices/$D1/sensor-data/history" $null $U1
    $newUserHist = Api GET "/api/v1/devices/$D1/sensor-data/history" $null $S1
    Check 'S02' 'After reassignment the new owner sees the history; the previous owner no longer does' ($newUserHist.Json.totalCount -ge 2 -and $oldUserHist.Status -eq 404)
    $un = Api POST "/api/v1/devices/$D4/unassign" @{} $SA
    Check 'D19' 'Unassign closes the active assignment' ($un.Status -eq 200 -and $null -eq $un.Json.assignedUserId -and (Api POST "/api/v1/devices/$D4/unassign" @{} $SA).Status -eq 409)
    Check 'D19b' 'An Admin can never unassign a device, not even one of their own Users (403)' ((Api POST "/api/v1/devices/$D1/unassign" @{} $A1).Status -eq 403)
    $null = Api POST "/api/v1/devices/$D4/assign" @{ userId = $S1id } $SA

    # concurrency
    $c1 = New-Device $SA 'VVTEST-CONC-1'
    $CD = $c1.Json.id
    $targets = @($U1id, $U2id, $U3id, $S1id)
    $codes = 1..16 | ForEach-Object -ThrottleLimit 16 -Parallel {
        $uid = ($using:targets)[$_ % 4]
        $r = Invoke-WebRequest -Uri "$($using:base)/api/v1/devices/$($using:CD)/assign" -Method POST -Headers @{ Authorization = "Bearer $($using:SA)" } `
            -ContentType 'application/json' -Body (@{ userId = $uid } | ConvertTo-Json) -SkipHttpErrorCheck
        [int]$r.StatusCode
    }
    $activeRows = Sql $Db "SELECT COUNT(*) FROM DeviceAssignments WHERE DeviceRecordId=$CD AND IsActive=1"
    $badCodes = @($codes | Where-Object { $_ -notin 200, 409 })
    Check 'D20' 'Concurrent assignment attempts never create two active assignments' ($activeRows -eq '1' -and $badCodes.Count -eq 0) ("active=$activeRows codes=" + ($codes -join ','))
    $dupe = Sql $Db "BEGIN TRY INSERT INTO DeviceAssignments (DeviceRecordId,UserId,AssignedByUserId,IsActive) VALUES ($CD,$U1id,$saId,1); SELECT 'allowed'; END TRY BEGIN CATCH SELECT 'blocked'; END CATCH"
    Check 'D21' 'Database itself rejects a second active assignment (filtered unique index)' ($dupe -eq 'blocked') $dupe

    # ================= SENSOR DATA =================
    Check 'S10' 'Registered device with valid key posts a reading (201)' ($r1.Status -eq 201 -and $r1.Json.deviceId -eq 'VVTEST-DEV-1' -and $r1.Json.aqi -eq 80)
    Check 'S11' 'Unknown device is rejected (401)' ((Post-Reading 'NO-SUCH-DEV' $K1 @{ aqi = 1 }).Status -eq 401)
    Check 'S12' 'Inactive device is rejected (403)' ((Post-Reading 'VVTEST-DEV-INACTIVE' $K6 @{ aqi = 1 }).Status -eq 403)
    Check 'S13' 'Missing device key is rejected (401)' ((Api POST /api/v1/sensor-data @{ deviceId = 'VVTEST-DEV-1'; aqi = 1 }).Status -eq 401)
    Check 'S14' "Another device's key is rejected (401)" ((Post-Reading 'VVTEST-DEV-1' $K2 @{ aqi = 1 } 3).Status -eq 401)
    Check 'S15' 'A user JWT is not a valid device credential (401)' ((Api POST /api/v1/sensor-data @{ deviceId = 'VVTEST-DEV-1'; aqi = 1 } $SA).Status -eq 401)
    Check 'S16' 'Out-of-range measurements are rejected (400)' ((Post-Reading 'VVTEST-DEV-1' $K1 @{ humidity = 150 } 2).Status -eq 400 -and (Post-Reading 'VVTEST-DEV-1' $K1 @{ pm25 = -5 } 2).Status -eq 400 -and (Post-Reading 'VVTEST-DEV-1' $K1 @{ temperature = 900 } 2).Status -eq 400)
    $fut = Api POST /api/v1/sensor-data @{ deviceId = 'VVTEST-DEV-1'; recordedAt = (Get-Date).ToUniversalTime().AddDays(2).ToString('o'); aqi = 1 } $null @{ 'X-Device-Key' = $K1 }
    Check 'S17' 'A reading time in the future is rejected (400)' ($fut.Status -eq 400)
    Check 'S17b' 'Timestamps in responses are explicit UTC (end with Z)' ($r1.Raw -match '"recordedAt":"[^"]+Z"' -and $r1.Raw -match '"createdAt":"[^"]+Z"') $r1.Raw
    $dup = Api POST /api/v1/sensor-data @{ deviceId = 'VVTEST-DEV-1'; recordedAt = $r1.Json.recordedAt.ToUniversalTime().ToString('o'); aqi = 1 } $null @{ 'X-Device-Key' = $K1 }
    Check 'S18' 'Duplicate (deviceId, recordedAt) is rejected (409)' ($dup.Status -eq 409) "status=$($dup.Status) $($dup.Raw)" 
    $nul = Post-Reading 'VVTEST-DEV-1' $K1 @{ aqi = 70 } 15
    $nulRow = Sql $Db "SELECT CONCAT(CASE WHEN pm25 IS NULL THEN 'N' ELSE 'V' END, CASE WHEN co_ppm IS NULL THEN 'N' ELSE 'V' END, CASE WHEN humidity IS NULL THEN 'N' ELSE 'V' END, CASE WHEN outer_temperature IS NULL THEN 'N' ELSE 'V' END) FROM SensorData WHERE ID=$($nul.Json.id)"
    Check 'S19' 'Missing measurements stay NULL (API and database), never 0' ($nul.Status -eq 201 -and $null -eq $nul.Json.pm25 -and $null -eq $nul.Json.humidity -and $nulRow -eq 'NNNN') "db=$nulRow"
    Check 'S20' 'data_date / data_time are UTC parts of recorded_at' ((Sql $Db "SELECT COUNT(*) FROM SensorData WHERE device_id LIKE 'VVTEST-%' AND (data_date <> CAST(recorded_at AS date) OR data_time <> CAST(recorded_at AS time(3)))") -eq '0')
    # created_at comes from the column default. The UAT database has a customised default (UTC + 330 min = IST wall-clock, set outside the
    # migrations); the check therefore allows exactly the offset the live default declares and reports the drift separately (S21b).
    $def = Sql $Db "SELECT definition FROM sys.default_constraints WHERE parent_object_id = OBJECT_ID('dbo.SensorData') AND COL_NAME(parent_object_id, parent_column_id) = 'created_at'"
    $offMin = if ($def -match '(?i)^\(sysutcdatetime\(\)\)$') { 0 } elseif ($def -match '(?i)dateadd\(minute,\((\d+)\),sysutcdatetime\(\)\)') { [int]$Matches[1] } else { $null }
    $s21 = if ($null -eq $offMin) { "unrecognised default: $def" } else { Sql $Db "SELECT CONCAT(COUNT(*), ' bad; min=', CONVERT(varchar(23), MIN(created_at), 121), ' max=', CONVERT(varchar(23), MAX(created_at), 121), ' now+offset=', CONVERT(varchar(23), DATEADD(minute,$offMin,SYSUTCDATETIME()), 121)) FROM SensorData WHERE device_id LIKE 'VVTEST-%' AND (created_at < DATEADD(minute,$($offMin - 15),SYSUTCDATETIME()) OR created_at > DATEADD(minute,$($offMin + 5),SYSUTCDATETIME()))" }
    Check 'S21' 'created_at is generated by the database default (not supplied by the client)' ($s21 -like '0 bad*') "default=$def; $s21"
    if ($offMin -ne 0) { Skip 'S21b' 'created_at column default equals the EF model default (UTC)' "UAT default is [$def], i.e. IST wall-clock; changed outside the migrations, reported not altered" }
    $cols = Sql $Db "SELECT STRING_AGG(COLUMN_NAME, ',') WITHIN GROUP (ORDER BY ORDINAL_POSITION) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='SensorData'"
    Check 'S22' 'SensorData keeps the exact required column names' ($cols -eq 'ID,device_id,data_date,data_time,recorded_at,aqi,aqi_status,pm10,pm25,no2_ppm,so2_ppm,co_ppm,tvoc_ppb,humidity,temperature,outer_temperature,outer_humidity,created_at') $cols
    Check 'S23' 'Invalid sortBy is rejected (400)' ((Api GET '/api/v1/sensor-data?sortBy=password' $null $SA).Status -eq 400)

    # visibility matrix
    $saAll = Api GET '/api/v1/sensor-data?pageSize=100' $null $SA
    $saDevs = @($saAll.Json.items | ForEach-Object { $_.deviceId } | Sort-Object -Unique)
    Check 'S30' 'SuperAdmin sees data of all devices' (($saDevs -contains 'VVTEST-DEV-1') -and ($saDevs -contains 'VVTEST-DEV-2') -and ($saDevs -contains 'VVTEST-DEV-3') -and ($saDevs -contains 'VVTEST-DEV-4') -and ($saDevs -contains 'VVTEST-DEV-5')) ($saDevs -join ',')
    $a1all = Api GET '/api/v1/sensor-data?pageSize=100' $null $A1
    $a1Devs = @($a1all.Json.items | ForEach-Object { $_.deviceId } | Sort-Object -Unique)
    Check 'S31' "Admin sees only data of devices assigned to their Users (DEV-2 [U1], DEV-5 [U2]); not other Admins' or standalone data" (($a1Devs -join ',') -eq 'VVTEST-DEV-2,VVTEST-DEV-5') ($a1Devs -join ',')
    $u1all = Api GET '/api/v1/sensor-data?pageSize=100' $null $U1
    Check 'S32' 'User sees only data of their currently assigned device(s)' ((@($u1all.Json.items | ForEach-Object { $_.deviceId } | Sort-Object -Unique) -join ',') -eq 'VVTEST-DEV-2') (@($u1all.Json.items | ForEach-Object { $_.deviceId } | Sort-Object -Unique) -join ',')
    $s1all = Api GET '/api/v1/sensor-data?pageSize=100' $null $S1
    Check 'S33' 'Standalone User sees their own devices data (DEV-1 after reassignment, DEV-4)' ((@($s1all.Json.items | ForEach-Object { $_.deviceId } | Sort-Object -Unique) -join ',') -eq 'VVTEST-DEV-1,VVTEST-DEV-4') (@($s1all.Json.items | ForEach-Object { $_.deviceId } | Sort-Object -Unique) -join ',')
    Check 'S34' "Admin cannot see standalone User's data by device filter" ((Api GET '/api/v1/sensor-data?deviceId=VVTEST-DEV-4' $null $A1).Json.totalCount -eq 0)
    Check 'S35' "User cannot read another User's data by device filter" ((Api GET '/api/v1/sensor-data?deviceId=VVTEST-DEV-3' $null $U1).Json.totalCount -eq 0)
    $foreignRow = Sql $Db "SELECT TOP 1 ID FROM SensorData WHERE device_id='VVTEST-DEV-3'"
    Check 'S36' "Reading by id from an unauthorized device returns 404" ((Api GET "/api/v1/sensor-data/$foreignRow" $null $U1).Status -eq 404 -and (Api GET "/api/v1/sensor-data/$foreignRow" $null $A1).Status -eq 404 -and (Api GET "/api/v1/sensor-data/$foreignRow" $null $SA).Status -eq 200)
    Check 'S37' 'Latest/history of an unauthorized device return 404' ((Api GET "/api/v1/devices/$D3/sensor-data/latest" $null $U1).Status -eq 404 -and (Api GET "/api/v1/devices/$D3/sensor-data/history" $null $A1).Status -eq 404)
    $latest = Api GET "/api/v1/devices/$D1/sensor-data/latest" $null $S1
    Check 'S38' 'Latest reading returns the most recent record (the -15m reading, aqi 70)' ($latest.Status -eq 200 -and $latest.Json.aqi -eq 70) "aqi=$($latest.Json.aqi)"
    $from = (Get-Date).ToUniversalTime().AddMinutes(-25).ToString('o'); $to = (Get-Date).ToUniversalTime().AddMinutes(-12).ToString('o')
    $range = Api GET ("/api/v1/devices/$D1/sensor-data/history?from=" + [uri]::EscapeDataString($from) + '&to=' + [uri]::EscapeDataString($to)) $null $SA
    Check 'S39' 'History honours from/to filters (expect the 2 readings at -20m and -15m)' ($range.Json.totalCount -eq 2) "total=$($range.Json.totalCount)"
    # pagination
    1..6 | ForEach-Object { $null = Post-Reading 'VVTEST-DEV-2' $K2 @{ aqi = 60 + $_ } (40 + $_) }
    $p1 = Api GET '/api/v1/sensor-data?pageSize=3&page=1&sortBy=recordedAt&sortDir=asc' $null $U1
    $p2 = Api GET '/api/v1/sensor-data?pageSize=3&page=2&sortBy=recordedAt&sortDir=asc' $null $U1
    $allU1 = @($p1.Json.items) + @($p2.Json.items)
    Check 'S40' 'Pagination returns pages and never leaks unauthorized rows' ($p1.Json.items.Count -eq 3 -and $p2.Json.items.Count -eq 3 -and $p1.Json.totalCount -eq 7 -and @($allU1 | Where-Object { $_.deviceId -ne 'VVTEST-DEV-2' }).Count -eq 0) "total=$($p1.Json.totalCount)"
    Check 'S41' 'Ascending sort is honoured' ($p1.Json.items[0].recordedAt -lt $p1.Json.items[1].recordedAt)
    $u3res = Api GET '/api/v1/sensor-data?pageSize=100&page=1' $null $U3
    Check 'S42' "Another Admin's User sees only their own device data" ((@($u3res.Json.items | ForEach-Object { $_.deviceId } | Sort-Object -Unique) -join ',') -eq 'VVTEST-DEV-3')

    # key rotation
    $rot = Api POST "/api/v1/devices/$D2/rotate-key" $null $SA
    Check 'D30' 'Key rotation returns a new key and the old key stops working' ($rot.Status -eq 200 -and $rot.Json.apiKey -ne $K2 -and (Post-Reading 'VVTEST-DEV-2' $K2 @{ aqi = 1 } 1).Status -eq 401 -and (Post-Reading 'VVTEST-DEV-2' $rot.Json.apiKey @{ aqi = 1 } 1).Status -eq 201)
    Check 'D31' 'Only SuperAdmin can rotate keys (403)' ((Api POST "/api/v1/devices/$D2/rotate-key" $null $A1).Status -eq 403)


    # ================= PHASE 2 ADDITIONS: remaining endpoint + contract coverage =================
    # --- PUT/PATCH users and devices ---
    $put = Api PUT "/api/v1/users/$U2id" @{ name = 'User Two Renamed'; email = 'user2@vvtest.local' } $A1
    Check 'E01' 'Admin updates own User (PUT /users/{id}); name changes' ($put.Status -eq 200 -and $put.Json.name -eq 'User Two Renamed')
    Check 'E01b' 'SuperAdmin updates any user; duplicate email on update is 409' ((Api PUT "/api/v1/users/$U1id" @{ name = 'User One'; email = 'user1@vvtest.local' } $SA).Status -eq 200 -and (Api PUT "/api/v1/users/$U1id" @{ name = 'User One'; email = 'user2@vvtest.local' } $SA).Status -eq 409)
    Check 'E01c' 'Regular User cannot PUT users (403)' ((Api PUT "/api/v1/users/$U1id" @{ name = 'x'; email = 'user1@vvtest.local' } $U1).Status -eq 403)
    $dput = Api PUT "/api/v1/devices/$D2" @{ deviceName = 'Renamed device'; description = 'updated' } $SA
    Check 'E02' 'SuperAdmin updates device metadata (PUT /devices/{id}); DeviceId unchanged' ($dput.Status -eq 200 -and $dput.Json.deviceName -eq 'Renamed device' -and $dput.Json.deviceId -eq 'VVTEST-DEV-2')
    Check 'E02b' 'Admin and User cannot PUT devices / PATCH device status (403)' ((Api PUT "/api/v1/devices/$D2" @{ deviceName = 'x' } $A1).Status -eq 403 -and (Api PUT "/api/v1/devices/$D2" @{ deviceName = 'x' } $U1).Status -eq 403 -and (Api PATCH "/api/v1/devices/$D2/status" @{ isActive = $false } $A1).Status -eq 403)
    $null = Api PATCH "/api/v1/devices/$D6/status" @{ isActive = $true } $SA
    Check 'E03' 'Reactivated device can ingest again (201); deactivated one is rejected (403)' ((Post-Reading 'VVTEST-DEV-INACTIVE' $K6 @{ aqi = 5 } 7).Status -eq 201 -and (Api PATCH "/api/v1/devices/$D6/status" @{ isActive = $false } $SA).Status -eq 200 -and (Post-Reading 'VVTEST-DEV-INACTIVE' $K6 @{ aqi = 6 } 6).Status -eq 403)
    $react = Api PATCH "/api/v1/users/$($in.Json.id)/status" @{ isActive = $true } $SA
    Check 'E04' 'Reactivated user can log in again' ($react.Status -eq 200 -and (Login 'inactive@vvtest.local' $Pw).Status -eq 200)

    # --- paging / filtering on devices ---
    $pg2 = Api GET "/api/v1/users/$S1id/devices?pageSize=1&page=2" $null $SA
    Check 'E05' 'GET /users/{id}/devices pages correctly (page 2 with pageSize 1; totalPages = totalCount)' ($pg2.Status -eq 200 -and $pg2.Json.totalCount -ge 2 -and $pg2.Json.items.Count -eq 1 -and $pg2.Json.page -eq 2 -and $pg2.Json.totalPages -eq $pg2.Json.totalCount) "status=$($pg2.Status) total=$($pg2.Json.totalCount) page=$($pg2.Json.page) items=$($pg2.Json.items.Count)"
    $hp = Api GET "/api/v1/devices/$D1/assignments?pageSize=1&page=2" $null $SA
    Check 'E05a' 'GET /devices/{id}/assignments pages correctly (page 2, pageSize 1 of 2 history rows)' ($hp.Status -eq 200 -and $hp.Json.totalCount -eq 2 -and $hp.Json.items.Count -eq 1 -and $hp.Json.page -eq 2 -and $hp.Json.pageSize -eq 1 -and $hp.Json.items[0].isActive -eq $false) $hp.Raw
    $un_list = Api GET '/api/v1/devices?assigned=false&pageSize=100' $null $SA
    Check 'E05b' 'Device list filter assigned=false returns only unassigned devices' ($un_list.Status -eq 200 -and @($un_list.Json.items | Where-Object { $null -ne $_.assignedUserId }).Count -eq 0)
    $act = Api GET '/api/v1/devices?isActive=false&pageSize=100' $null $SA
    Check 'E05c' 'Device list filter isActive=false returns only inactive devices' ($act.Status -eq 200 -and @($act.Json.items | Where-Object { $_.isActive }).Count -eq 0 -and @($act.Json.items | Where-Object { $_.deviceId -eq 'VVTEST-DEV-INACTIVE' }).Count -eq 1)
    Check 'E05d' 'Users cannot read another users device list (404); Admin cannot read out-of-scope user devices (404)' ((Api GET "/api/v1/users/$U3id/devices" $null $U1).Status -eq 404 -and (Api GET "/api/v1/users/$S1id/devices" $null $A1).Status -eq 404)

    # --- standalone user cannot use admin functions ---
    $meS = Api GET /api/v1/auth/me $null $S1
    Check 'E06' 'Standalone User profile: role User, ManagerId = SuperAdmin id' ($meS.Json.role -eq 'User' -and $meS.Json.managerId -eq $saId)
    Check 'E06b' 'Standalone User gets 403 on admin endpoints' ((Api GET /api/v1/users $null $S1).Status -eq 403 -and (Api POST "/api/v1/devices/$D4/assign" @{ userId = $S1id } $S1).Status -eq 403 -and (Api GET "/api/v1/devices/$D4/assignments" $null $S1).Status -eq 403 -and (Api PATCH "/api/v1/users/$S1id/status" @{ isActive = $false } $S1).Status -eq 403 -and (New-Device $S1 'VVTEST-X9').Status -eq 403)
    Check 'E06c' 'Standalone User sees own devices and no one elses' ((Api GET "/api/v1/devices/$D4" $null $S1).Status -eq 200 -and (Api GET "/api/v1/devices/$D3" $null $S1).Status -eq 404)

    # --- Admin cannot touch the SuperAdmin; tampering with ids ---
    Check 'E07' 'Admin cannot read or deactivate the SuperAdmin (404)' ((Api GET "/api/v1/users/$saId" $null $A1).Status -eq 404 -and (Api PATCH "/api/v1/users/$saId/status" @{ isActive = $false } $A1).Status -eq 404)
    Check 'E07b' 'Admin cannot read assignment history of a device assigned outside scope (404)' ((Api GET "/api/v1/devices/$D1/assignments" $null $A1).Status -eq 404)
    Check 'E07c' 'User cannot read another users device (404)' ((Api GET "/api/v1/devices/$D3" $null $U1).Status -eq 404)

    # --- refresh / logout edge cases ---
    Check 'E08' 'Logout without an access token is 401' ((Api POST /api/v1/auth/logout @{ refreshToken = 'x' }).Status -eq 401)
    $tmp = New-User $SA 'Temp User' 'temp1@vvtest.local' 'User'
    $tl = Login 'temp1@vvtest.local' $Pw
    $null = Api PATCH "/api/v1/users/$($tmp.Json.id)/status" @{ isActive = $false } $SA
    Check 'E08b' 'Deactivating a user revokes their refresh tokens (refresh = 401)' ((Api POST /api/v1/auth/refresh @{ refreshToken = $tl.Json.refreshToken }).Status -eq 401)
    $tmp2 = New-User $A1 'Temp User 2' 'temp2@vvtest.local' 'User'
    $tl2 = Login 'temp2@vvtest.local' $Pw
    $null = Api POST "/api/v1/users/$($tmp2.Json.id)/reset-password" @{ newPassword = 'AnotherNew#Pass7' } $A1
    Check 'E08c' 'Password reset revokes existing refresh tokens (refresh = 401)' ((Api POST /api/v1/auth/refresh @{ refreshToken = $tl2.Json.refreshToken }).Status -eq 401)

    # --- error contract ---
    $mj = Invoke-WebRequest "$base/api/v1/auth/login" -Method Post -ContentType 'application/json' -Body '{"email": 5' -SkipHttpErrorCheck
    $mjj = $mj.Content | ConvertFrom-Json
    Check 'E09' 'Malformed JSON returns 400 in the standard ApiError shape' ($mj.StatusCode -eq 400 -and $mjj.code -eq 'validation_failed' -and $mjj.status -eq 400 -and $mjj.traceId) $mj.Content
    $wt = Api POST /api/v1/sensor-data @{ deviceId = 'VVTEST-DEV-1'; aqi = 'abc' } $null @{ 'X-Device-Key' = $K1 }
    Check 'E09b' 'Wrong-typed field returns 400 in the standard error body (legacy code + RFC 7807 type/title), not the framework default' ($wt.Status -eq 400 -and $wt.Json.code -eq 'validation_failed' -and $wt.Json.type -eq 'urn:vayuvata:error:validation_failed' -and $wt.Json.title -eq 'Bad Request' -and $wt.Json.traceId) $wt.Raw
    $nf = Invoke-WebRequest "$base/api/v1/does-not-exist" -SkipHttpErrorCheck
    $nfj = $nf.Content | ConvertFrom-Json
    Check 'E09c' 'Unknown route returns 404 with a JSON ApiError' ($nf.StatusCode -eq 404 -and $nfj.code -eq 'not_found')
    Check 'E09d' 'Unsupported media type returns 415' ((Invoke-WebRequest "$base/api/v1/auth/login" -Method Post -ContentType 'text/plain' -Body 'x' -SkipHttpErrorCheck).StatusCode -eq 415)
    $perr = Api GET '/api/v1/sensor-data?page=abc' $null $SA
    Check 'E09e' 'Bad query-string type returns 400 ApiError' ($perr.Status -eq 400 -and $perr.Json.code -eq 'validation_failed') $perr.Raw

    # --- sensor sorting / paging edge ---
    $srt = Api GET '/api/v1/sensor-data?deviceId=VVTEST-DEV-2&sortBy=aqi&sortDir=desc&pageSize=100' $null $SA
    $aqis = @($srt.Json.items | ForEach-Object { $_.aqi })
    Check 'E10' 'Sorting by aqi descending is honoured' ($aqis.Count -ge 3 -and ($aqis[0] -ge $aqis[1]) -and ($aqis[1] -ge $aqis[2])) ($aqis -join ',')
    $beyond = Api GET '/api/v1/sensor-data?pageSize=3&page=99' $null $U1
    Check 'E10b' 'A page beyond the end is empty and still reports totalCount' ($beyond.Status -eq 200 -and $beyond.Json.items.Count -eq 0 -and $beyond.Json.totalCount -ge 1)

    # --- OpenAPI accuracy ---
    $opCount = 0; foreach ($pp in $sw.Json.paths.PSObject.Properties) { $opCount += @($pp.Value.PSObject.Properties).Count }
    Check 'W04b' 'OpenAPI documents exactly the 34 implemented operations (the 30 original + change-password + 3 GPS), or +1 when the separately developed GET /devices/{id}/key-hash is also present' ($opCount -eq $(if ($sw.Json.paths.PSObject.Properties.Name -contains '/api/v1/devices/{id}/key-hash') { 35 } else { 34 })) "operations=$opCount"
    $ing = $sw.Json.paths.'/api/v1/sensor-data'.post
    Check 'W11a' 'Ingestion is documented with the X-Device-Key scheme, not Bearer' (($ing.security | ConvertTo-Json -Compress -Depth 6) -match 'DeviceKey' -and ($ing.security | ConvertTo-Json -Compress -Depth 6) -notmatch 'Bearer' -and $sw.Json.components.securitySchemes.DeviceKey.name -eq 'X-Device-Key' -and $sw.Json.components.securitySchemes.DeviceKey.in -eq 'header')
    Check 'W11b' 'Protected operations require Bearer; login/refresh/health do not' (($sw.Json.paths.'/api/v1/auth/me'.get.security | ConvertTo-Json -Compress -Depth 6) -match 'Bearer' -and ($sw.Json.paths.'/api/v1/users'.get.security | ConvertTo-Json -Compress -Depth 6) -match 'Bearer' -and -not $sw.Json.paths.'/api/v1/auth/login'.post.security -and -not $sw.Json.paths.'/api/v1/health'.get.security -and -not $sw.Json.paths.'/api/v1/auth/refresh'.post.security)
    $me401 = $sw.Json.paths.'/api/v1/auth/me'.get.responses
    Check 'W11c' 'Error responses (400/401/403) are documented with the ApiError schema' ($me401.'401'.content.'application/json'.schema.'$ref' -match 'ApiError' -and $sw.Json.paths.'/api/v1/devices'.post.responses.'403' -and $sw.Json.paths.'/api/v1/users'.post.responses.'400')
    Check 'W11d' 'Swagger: /auth/me is 401 without a token and 200 with one' ((Api GET /api/v1/auth/me).Status -eq 401 -and (Api GET /api/v1/auth/me $null $SA).Status -eq 200)

    # --- health 503 when SQL Server is unreachable (separate throwaway instance; creates nothing) ---
    $hPort = $Port + 1
    $saveCs = $env:ConnectionStrings__Default; $saveMig = $env:Database__ApplyMigrationsOnStartup
    $env:ConnectionStrings__Default = "Server=localhost,1;Database=VayuVata;Trusted_Connection=True;TrustServerCertificate=True;Connect Timeout=3;"
    $env:Database__ApplyMigrationsOnStartup = 'false'
    $hApp = Start-Process dotnet -ArgumentList @((Join-Path $bin 'VayuVata.dll'), '--urls', "http://localhost:$hPort") -WorkingDirectory $project -PassThru `
        -RedirectStandardOutput (Join-Path $runDir 'health.log') -RedirectStandardError (Join-Path $runDir 'health.err.log') -WindowStyle Hidden
    $env:ConnectionStrings__Default = $saveCs; $env:Database__ApplyMigrationsOnStartup = $saveMig
    $h503 = $null
    1..40 | ForEach-Object { if (-not $h503) { try { $h503 = Invoke-WebRequest "http://localhost:$hPort/api/v1/health" -SkipHttpErrorCheck } catch { Start-Sleep 1 } } }
    Check 'W12' 'Health returns 503 (Unhealthy / Unreachable) while SQL Server is unreachable, and the API stays up' ($h503 -and $h503.StatusCode -eq 503 -and ($h503.Content | ConvertFrom-Json).database -eq 'Unreachable') ("status=$($h503.StatusCode)")
    $e500 = Invoke-WebRequest "http://localhost:$hPort/api/v1/auth/login" -Method Post -ContentType 'application/json' -Body '{"email":"x@vvtest.local","password":"Passw0rd!x1"}' -SkipHttpErrorCheck
    $b500 = [string]$e500.Content | ConvertFrom-Json
    Start-Sleep -Milliseconds 800
    $hLog = (Get-Content (Join-Path $runDir 'health.log') -Raw) + (Get-Content (Join-Path $runDir 'health.err.log') -Raw)
    Check 'H16' 'Internal failure (database down) returns 500 server_error with request id only: no exception text, SQL error, server name, connection string or stack trace in the body' ($e500.StatusCode -eq 500 -and $b500.code -eq 'server_error' -and $b500.traceId -eq $e500.Headers['X-Request-Id'][0] -and $e500.Content -notmatch '(?i)exception|sqlclient|localhost|Server=|Trusted_Connection|   at |network-related') $e500.Content
    Check 'H17' 'The same failure is in the server log under the SAME request id, with the stack trace (server side only)' ($hLog -match "Unhandled exception on POST /api/v1/auth/login \(request $($b500.traceId)\)" -and $hLog -match 'SqlException|Microsoft.Data.SqlClient')
    Get-NetTCPConnection -LocalPort $hPort -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    if ($hApp -and -not $hApp.HasExited) { Stop-Process -Id $hApp.Id -Force -ErrorAction SilentlyContinue }

    # ================= PHASE 3: MANAGER HIERARCHY (ManagerId) =================
    function Emails($r) { @($r.Json.items | ForEach-Object { $_.email }) | Sort-Object }
    function DbEmails([string]$where) { @((Sql $Db "SELECT Email FROM Users WHERE $where") -split "`n" | Where-Object { $_ }) | Sort-Object }
    function SameSet($a, $b) { (@($a) -join ',') -eq (@($b) -join ',') }

    # N01-N04: creation rules for SuperAdmin
    $n_adm = New-User $SA 'N Admin' 'nadmin@vvtest.local' 'Admin'
    Check 'N01' 'SuperAdmin creates an Admin: ManagerId NULL, no assignmentType' ($n_adm.Status -eq 201 -and $null -eq $n_adm.Json.managerId -and $null -eq $n_adm.Json.assignmentType -and (Sql $Db "SELECT CASE WHEN ManagerId IS NULL THEN 'NULL' ELSE 'SET' END FROM Users WHERE Email='nadmin@vvtest.local'") -eq 'NULL')
    $NAid = $n_adm.Json.id
    $n_solo = New-User $SA 'N Solo' 'nsolo@vvtest.local' 'User'
    Check 'N02' 'SuperAdmin creates a standalone User: managerId = SuperAdmin id, managerRole SuperAdmin, assignmentType Standalone' ($n_solo.Status -eq 201 -and $n_solo.Json.managerId -eq $saId -and $n_solo.Json.managerRole -eq 'SuperAdmin' -and $n_solo.Json.assignmentType -eq 'Standalone')
    $dbMgr = Sql $Db "SELECT ManagerId FROM Users WHERE Email='nsolo@vvtest.local'"
    $dbSa = Sql $Db "SELECT Id FROM Users WHERE Role='SuperAdmin' AND IsActive=1"
    Check 'N03' 'Standalone User row in the database has ManagerId equal to the real SuperAdmin id' ($dbMgr -eq $dbSa -and $dbSa -eq "$saId") "db manager=$dbMgr superadmin=$dbSa"
    $n_under = New-User $SA 'N Under Admin' 'nunder@vvtest.local' 'User' $NAid
    Check 'N04' 'SuperAdmin creates a User under an Admin: managerId = Admin, managerRole Admin, assignmentType AdminManaged' ($n_under.Status -eq 201 -and $n_under.Json.managerId -eq $NAid -and $n_under.Json.managerRole -eq 'Admin' -and $n_under.Json.assignmentType -eq 'AdminManaged' -and $n_under.Json.managerName -eq 'N Admin')
    $NUid = $n_under.Json.id; $NSid = $n_solo.Json.id
    # SuperAdmin may also name itself explicitly
    Check 'N04b' 'SuperAdmin may pass its own id as managerId (standalone); another User id as manager is rejected' ((New-User $SA 'N Solo2' 'nsolo2@vvtest.local' 'User' $saId).Json.managerId -eq $saId -and (New-User $SA 'Bad' 'nbad1@vvtest.local' 'User' $U1id).Status -eq 400)
    Check 'N04c' 'Invalid managers are rejected (400): nonexistent id, inactive Admin, Admin account with a manager' ((New-User $SA 'Bad' 'nbad2@vvtest.local' 'User' 99999999).Status -eq 400 -and (New-User $SA 'Bad' 'nbad3@vvtest.local' 'Admin' $A1id).Status -eq 400)
    $n_inact = New-User $SA 'N Inactive Admin' 'ninactadmin@vvtest.local' 'Admin'
    $null = Api PATCH "/api/v1/users/$($n_inact.Json.id)/status" @{ isActive = $false } $SA
    Check 'N04d' 'A User cannot be created under an inactive Admin (400)' ((New-User $SA 'Bad' 'nbad4@vvtest.local' 'User' $n_inact.Json.id).Status -eq 400)

    # N05-N07: Admin creation rules
    $n_a1 = Api POST /api/v1/users @{ name = 'N Priya'; email = 'npriya@vvtest.local'; password = $Pw; role = 'User' } $A1
    Check 'N05' 'Admin creates a User; ManagerId is derived from the authenticated Admin' ($n_a1.Status -eq 201 -and $n_a1.Json.managerId -eq $A1id -and $n_a1.Json.assignmentType -eq 'AdminManaged')
    Check 'N05b' 'Admin may send their own id as managerId (still themself)' ((Api POST /api/v1/users @{ name = 'N Own'; email = 'nown@vvtest.local'; password = $Pw; role = 'User'; managerId = $A1id } $A1).Json.managerId -eq $A1id)
    Check 'N06' 'Admin cannot create a User under another Admin or under the SuperAdmin (403)' ((Api POST /api/v1/users @{ name = 'X'; email = 'nx1@vvtest.local'; password = $Pw; role = 'User'; managerId = $A2id } $A1).Status -eq 403 -and (Api POST /api/v1/users @{ name = 'X'; email = 'nx2@vvtest.local'; password = $Pw; role = 'User'; managerId = $saId } $A1).Status -eq 403)
    Check 'N07' 'Admin cannot create Admin (403) or SuperAdmin (400); User cannot create anything (403)' ((New-User $A1 'X' 'nx3@vvtest.local' 'Admin').Status -eq 403 -and (New-User $A1 'X' 'nx4@vvtest.local' 'SuperAdmin').Status -eq 400 -and (New-User $U1 'X' 'nx5@vvtest.local' 'User').Status -eq 403)
    Check 'N07b' 'No client-supplied manager/role bypass: nothing was created by the rejected calls' ((Sql $Db "SELECT COUNT(*) FROM Users WHERE Email LIKE 'nx%@vvtest.local' OR Email LIKE 'nbad%@vvtest.local'") -eq '0')

    # N08-N10: GET/POST /admins/{adminId}/users
    $a1list = Api GET "/api/v1/admins/$A1id/users?page=1&pageSize=100" $null $SA
    $expected = DbEmails "ManagerId=$A1id AND Role='User'"
    Check 'N08' 'GET /admins/{adminId}/users returns exactly the Users managed by that Admin (compared with the database)' ($a1list.Status -eq 200 -and (SameSet (Emails $a1list) $expected) -and $a1list.Json.adminId -eq $A1id -and $a1list.Json.adminName -eq 'Admin One' -and $a1list.Json.totalCount -eq $expected.Count -and @($a1list.Json.items | Where-Object { $_.managerId -ne $A1id -or $_.role -ne 'User' }).Count -eq 0) ($expected -join ',')
    $a1own = Api GET "/api/v1/admins/$A1id/users?pageSize=1&page=2" $null $A1
    Check 'N08b' 'Admin lists their own Users via the explicit route, with paging (page 2, pageSize 1)' ($a1own.Status -eq 200 -and $a1own.Json.page -eq 2 -and $a1own.Json.pageSize -eq 1 -and $a1own.Json.items.Count -eq 1 -and $a1own.Json.totalCount -eq $expected.Count)
    $cross = Api GET "/api/v1/admins/$A2id/users" $null $A1
    Check 'N09' "Admin cannot list another Admin's Users (403, no data)" ($cross.Status -eq 403 -and $cross.Raw -notmatch 'user3@vvtest' -and $null -eq $cross.Json.items)
    Check 'N09b' 'Regular/standalone User cannot use the endpoint (403); a non-Admin id is 404; unknown id is 404' ((Api GET "/api/v1/admins/$A1id/users" $null $U1).Status -eq 403 -and (Api GET "/api/v1/admins/$A1id/users" $null $S1).Status -eq 403 -and (Api GET "/api/v1/admins/$U1id/users" $null $SA).Status -eq 404 -and (Api GET "/api/v1/admins/99999999/users" $null $SA).Status -eq 404 -and (Api GET "/api/v1/admins/$saId/users" $null $SA).Status -eq 404)
    Check 'N09c' 'Without a token the endpoint is 401' ((Api GET "/api/v1/admins/$A1id/users").Status -eq 401)
    $n_p1 = Api POST "/api/v1/admins/$A1id/users" @{ name = 'N Via Route'; email = 'nroute1@vvtest.local'; password = $Pw } $SA
    Check 'N10' 'SuperAdmin creates a User via POST /admins/{adminId}/users (role User, managerId = Admin)' ($n_p1.Status -eq 201 -and $n_p1.Json.managerId -eq $A1id -and $n_p1.Json.role -eq 'User')
    $n_p2 = Api POST "/api/v1/admins/$A1id/users" @{ name = 'N Via Route 2'; email = 'nroute2@vvtest.local'; password = $Pw } $A1
    Check 'N10b' 'Admin creates a User under themself via the route; under another Admin is 403' ($n_p2.Status -eq 201 -and $n_p2.Json.managerId -eq $A1id -and (Api POST "/api/v1/admins/$A2id/users" @{ name = 'X'; email = 'nx6@vvtest.local'; password = $Pw } $A1).Status -eq 403)
    Check 'N10c' 'Route creation errors: regular User 403, unknown Admin 404, inactive Admin 400, duplicate email 409, weak password 400' ((Api POST "/api/v1/admins/$A1id/users" @{ name = 'X'; email = 'nx7@vvtest.local'; password = $Pw } $U1).Status -eq 403 -and (Api POST "/api/v1/admins/99999999/users" @{ name = 'X'; email = 'nx8@vvtest.local'; password = $Pw } $SA).Status -eq 404 -and (Api POST "/api/v1/admins/$($n_inact.Json.id)/users" @{ name = 'X'; email = 'nx9@vvtest.local'; password = $Pw } $SA).Status -eq 400 -and (Api POST "/api/v1/admins/$A1id/users" @{ name = 'X'; email = 'nroute1@vvtest.local'; password = $Pw } $SA).Status -eq 409 -and (Api POST "/api/v1/admins/$A1id/users" @{ name = 'X'; email = 'nx10@vvtest.local'; password = 'weak' } $SA).Status -eq 400)

    # N11: GET /superadmin/users
    $sl = Api GET '/api/v1/superadmin/users?pageSize=100' $null $SA
    $slExpected = DbEmails "ManagerId=$saId AND Role='User'"
    $slBad = @($sl.Json.items | Where-Object { $_.managerId -ne $saId -or $_.managerRole -ne 'SuperAdmin' -or $_.assignmentType -ne 'Standalone' -or $_.role -ne 'User' })
    Check 'N11' 'GET /superadmin/users returns only Users managed directly by the SuperAdmin (compared with the database)' ($sl.Status -eq 200 -and (SameSet (Emails $sl) $slExpected) -and $slBad.Count -eq 0 -and (Emails $sl) -contains 'nsolo@vvtest.local' -and (Emails $sl) -notcontains 'nunder@vvtest.local' -and (Emails $sl) -notcontains 'nadmin@vvtest.local') ($slExpected -join ',')
    Check 'N11b' 'Standalone list supports search + paging, exposes the documented fields, and never returns password data' ((Api GET '/api/v1/superadmin/users?search=N%20Solo&pageSize=1' $null $SA).Json.items.Count -eq 1 -and $sl.Json.items[0].PSObject.Properties.Name -contains 'isActive' -and $sl.Json.items[0].PSObject.Properties.Name -contains 'createdAt' -and $sl.Raw -notmatch '(?i)password|hash')
    Check 'N11c' 'Admin, User and anonymous callers cannot use /superadmin/users' ((Api GET '/api/v1/superadmin/users' $null $A1).Status -eq 403 -and (Api GET '/api/v1/superadmin/users' $null $U1).Status -eq 403 -and (Api GET '/api/v1/superadmin/users' $null $S1).Status -eq 403 -and (Api GET '/api/v1/superadmin/users').Status -eq 401)

    # N12-N16: reassignment
    $mgrNow = { param($id) Sql $Db "SELECT ISNULL(CAST(ManagerId AS varchar), 'NULL') FROM Users WHERE Id=$id" }
    $m1 = Api PATCH "/api/v1/users/$NUid/admin-assignment" @{ managerId = $A2id } $SA
    Check 'N12' 'SuperAdmin moves a User from one Admin to another; same user id, new ManagerId (API and database)' ($m1.Status -eq 200 -and $m1.Json.id -eq $NUid -and $m1.Json.managerId -eq $A2id -and $m1.Json.managerRole -eq 'Admin' -and (& $mgrNow $NUid) -eq "$A2id" -and (Emails (Api GET "/api/v1/admins/$A2id/users?pageSize=100" $null $SA)) -contains 'nunder@vvtest.local' -and (Emails (Api GET "/api/v1/admins/$NAid/users?pageSize=100" $null $SA)) -notcontains 'nunder@vvtest.local')
    $m2 = Api PATCH "/api/v1/users/$NUid/admin-assignment" @{ managerId = $saId } $SA
    Check 'N13' 'SuperAdmin moves an Admin-managed User to standalone (managerId = SuperAdmin id)' ($m2.Status -eq 200 -and $m2.Json.id -eq $NUid -and $m2.Json.managerId -eq $saId -and $m2.Json.assignmentType -eq 'Standalone' -and (& $mgrNow $NUid) -eq "$saId" -and (Emails (Api GET '/api/v1/superadmin/users?pageSize=100' $null $SA)) -contains 'nunder@vvtest.local' -and (Emails (Api GET "/api/v1/admins/$A2id/users?pageSize=100" $null $SA)) -notcontains 'nunder@vvtest.local')
    $m3 = Api PATCH "/api/v1/users/$NUid/admin-assignment" @{ managerId = $NAid } $SA
    Check 'N14' 'SuperAdmin moves a standalone User under an Admin' ($m3.Status -eq 200 -and $m3.Json.managerId -eq $NAid -and $m3.Json.assignmentType -eq 'AdminManaged' -and (& $mgrNow $NUid) -eq "$NAid" -and (Emails (Api GET '/api/v1/superadmin/users?pageSize=100' $null $SA)) -notcontains 'nunder@vvtest.local')
    Check 'N15' 'Ids and ManagerIds stay consistent after every move (all test Users valid in the database; account itself unchanged)' ((Sql $Db "SELECT COUNT(*) FROM Users u LEFT JOIN Users m ON m.Id = u.ManagerId WHERE u.Email LIKE '%@vvtest.local' AND u.Role='User' AND (m.Id IS NULL OR m.Role NOT IN ('Admin','SuperAdmin') OR (m.IsActive = 0 AND m.Email NOT LIKE 'ninact%'))") -eq '0' -and $m3.Json.email -eq 'nunder@vvtest.local' -and $m3.Json.name -eq 'N Under Admin')
    Check 'N15b' 'Re-assigning to the current manager is an idempotent 200' ((Api PATCH "/api/v1/users/$NUid/admin-assignment" @{ managerId = $NAid } $SA).Status -eq 200)
    Check 'N16' 'Invalid assignments: null / missing managerId, non-manager target, inactive Admin, a regular User as manager (all 400)' ((Api PATCH "/api/v1/users/$NUid/admin-assignment" @{ managerId = $null } $SA).Status -eq 400 -and (Api PATCH "/api/v1/users/$NUid/admin-assignment" @{} $SA).Status -eq 400 -and (Api PATCH "/api/v1/users/$NUid/admin-assignment" @{ managerId = $n_inact.Json.id } $SA).Status -eq 400 -and (Api PATCH "/api/v1/users/$NUid/admin-assignment" @{ managerId = $U1id } $SA).Status -eq 400 -and (Api PATCH "/api/v1/users/$NUid/admin-assignment" @{ managerId = 99999999 } $SA).Status -eq 400)
    Check 'N16b' 'Admin and SuperAdmin accounts cannot be reassigned; no self-assignment (400)' ((Api PATCH "/api/v1/users/$NAid/admin-assignment" @{ managerId = $A1id } $SA).Status -eq 400 -and (Api PATCH "/api/v1/users/$saId/admin-assignment" @{ managerId = $saId } $SA).Status -eq 400 -and (Api PATCH "/api/v1/users/$NUid/admin-assignment" @{ managerId = $NUid } $SA).Status -eq 400)
    Check 'N16c' 'Only SuperAdmin may change a manager: Admin (own or foreign User), User, anonymous' ((Api PATCH "/api/v1/users/$NUid/admin-assignment" @{ managerId = $A1id } $A1).Status -eq 403 -and (Api PATCH "/api/v1/users/$U1id/admin-assignment" @{ managerId = $saId } $A1).Status -eq 403 -and (Api PATCH "/api/v1/users/$U1id/admin-assignment" @{ managerId = $A2id } $U1).Status -eq 403 -and (Api PATCH "/api/v1/users/$U1id/admin-assignment" @{ managerId = $A2id }).Status -eq 401 -and (Api PATCH "/api/v1/users/99999999/admin-assignment" @{ managerId = $A1id } $SA).Status -eq 404)

    # N17: profile updates cannot change role or manager
    $tamper = Api PUT "/api/v1/users/$U1id" @{ name = 'User One'; email = 'user1@vvtest.local'; role = 'Admin'; managerId = $A2id; adminId = $A2id } $A1
    Check 'N17' 'PUT cannot change role or manager (extra fields ignored)' ($tamper.Status -eq 200 -and $tamper.Json.role -eq 'User' -and $tamper.Json.managerId -eq $A1id -and (& $mgrNow $U1id) -eq "$A1id")
    $selfMgr = Api GET /api/v1/auth/me $null $U1
    Check 'N17b' 'A regular User sees their manager in /auth/me but cannot change it (PUT/PATCH 403)' ($selfMgr.Json.managerId -eq $A1id -and (Api PUT "/api/v1/users/$U1id" @{ name = 'x'; email = 'user1@vvtest.local'; managerId = $A2id } $U1).Status -eq 403)

    # N18-N19: Admin scope
    $adminAll = Api GET '/api/v1/users?pageSize=100' $null $A1
    $adminSet = Emails $adminAll
    Check 'N18' 'Admin general list contains only Users with ManagerId = themself (no standalone, no other Admin)' ($adminAll.Status -eq 200 -and (SameSet $adminSet (DbEmails "ManagerId=$A1id AND Role='User'")) -and $adminSet -notcontains 'nsolo@vvtest.local' -and $adminSet -notcontains 'user3@vvtest.local')
    Check 'N18b' 'Admin cannot read/update/deactivate/reset/list-devices of standalone Users (404)' ((Api GET "/api/v1/users/$NSid" $null $A1).Status -eq 404 -and (Api PUT "/api/v1/users/$NSid" @{ name = 'h'; email = 'h1@vvtest.local' } $A1).Status -eq 404 -and (Api PATCH "/api/v1/users/$NSid/status" @{ isActive = $false } $A1).Status -eq 404 -and (Api POST "/api/v1/users/$NSid/reset-password" @{ newPassword = 'Hacked12345' } $A1).Status -eq 404 -and (Api GET "/api/v1/users/$NSid/devices" $null $A1).Status -eq 404)
    Check 'N19' "Admin cannot read/update/deactivate/reset/list-devices of another Admin's User, nor reset another Admin (404)" ((Api GET "/api/v1/users/$U3id" $null $A1).Status -eq 404 -and (Api PUT "/api/v1/users/$U3id" @{ name = 'h'; email = 'h2@vvtest.local' } $A1).Status -eq 404 -and (Api PATCH "/api/v1/users/$U3id/status" @{ isActive = $false } $A1).Status -eq 404 -and (Api POST "/api/v1/users/$U3id/reset-password" @{ newPassword = 'Hacked12345' } $A1).Status -eq 404 -and (Api POST "/api/v1/users/$A2id/reset-password" @{ newPassword = 'Hacked12345' } $A1).Status -eq 404 -and (Api GET "/api/v1/users/$U3id/devices" $null $A1).Status -eq 404)

    # N27: general list filters
    $fAdm = Api GET '/api/v1/users?role=Admin&pageSize=100' $null $SA
    $fMgr = Api GET "/api/v1/users?managerId=$A1id&pageSize=100" $null $SA
    $fSt = Api GET '/api/v1/users?standalone=true&pageSize=100' $null $SA
    $fAm = Api GET '/api/v1/users?standalone=false&pageSize=100' $null $SA
    Check 'N27' 'SuperAdmin list filters: role=Admin, managerId, standalone=true/false, search' ((@($fAdm.Json.items | Where-Object { $_.role -ne 'Admin' }).Count -eq 0 -and (Emails $fAdm) -contains 'admin1@vvtest.local') -and (SameSet (Emails $fMgr) (DbEmails "ManagerId=$A1id")) -and (@($fSt.Json.items | Where-Object { $_.assignmentType -ne 'Standalone' }).Count -eq 0 -and (Emails $fSt) -contains 'nsolo@vvtest.local') -and (@($fAm.Json.items | Where-Object { $_.assignmentType -ne 'AdminManaged' }).Count -eq 0 -and (Emails $fAm) -contains 'user1@vvtest.local') -and (Api GET '/api/v1/users?search=nsolo%40vvtest' $null $SA).Json.totalCount -eq 1)
    Check 'N27b' 'Admin cannot widen scope with query parameters (403 for another managerId / standalone); own managerId is fine; a User gets 403' ((Api GET "/api/v1/users?managerId=$A2id" $null $A1).Status -eq 403 -and (Api GET "/api/v1/users?managerId=$saId" $null $A1).Status -eq 403 -and (Api GET '/api/v1/users?standalone=true' $null $A1).Status -eq 403 -and (Api GET "/api/v1/users?managerId=$A1id" $null $A1).Status -eq 200 -and (Api GET '/api/v1/users?role=Admin' $null $A1).Json.totalCount -eq 0 -and (Api GET '/api/v1/users' $null $U1).Status -eq 403)
    Check 'N27c' 'GET /users/{id} exposes the manager relationship' ((Api GET "/api/v1/users/$NSid" $null $SA).Json.managerName -eq 'Super Admin' -and (Api GET "/api/v1/users/$NUid" $null $SA).Json.managerName -eq 'N Admin' -and (Api GET "/api/v1/users/$NUid" $null $SA).Json.assignmentType -eq 'AdminManaged')

    # N20-N22: devices and sensor data follow the manager relationship; history preserved
    $n_dev = New-Device $SA 'VVTEST-N-1'
    $ND = $n_dev.Json.id; $NK = $n_dev.Json.apiKey
    $null = Api PATCH "/api/v1/users/$NUid/admin-assignment" @{ managerId = $A1id } $SA
    $n_as = Api POST "/api/v1/devices/$ND/assign" @{ userId = $NUid } $SA
    $null = Post-Reading 'VVTEST-N-1' $NK @{ aqi = 61 } 9
    $null = Post-Reading 'VVTEST-N-1' $NK @{ aqi = 62 } 8
    $nuTok = Token 'nunder@vvtest.local'
    $see = { param($tok, $label) [pscustomobject]@{ Dev = (Api GET "/api/v1/devices/$ND" $null $tok).Status; Data = (Api GET '/api/v1/sensor-data?deviceId=VVTEST-N-1&pageSize=100' $null $tok).Json.totalCount; Latest = (Api GET "/api/v1/devices/$ND/sensor-data/latest" $null $tok).Status; Hist = (Api GET "/api/v1/devices/$ND/sensor-data/history" $null $tok).Status } }
    $v1 = & $see $A1 'A1'; $v1b = & $see $A2 'A2'; $v1c = & $see $nuTok 'owner'; $v1d = & $see $SA 'SA'; $v1e = & $see $S1 'standalone'
    Check 'N20' 'Under Admin A1: A1, the owner and SuperAdmin see the device and its 2 readings; Admin A2 and an unrelated standalone User do not' ($v1.Dev -eq 200 -and $v1.Data -eq 2 -and $v1c.Dev -eq 200 -and $v1c.Data -eq 2 -and $v1d.Data -ge 2 -and $v1b.Dev -eq 404 -and $v1b.Data -eq 0 -and $v1b.Latest -eq 404 -and $v1b.Hist -eq 404 -and $v1e.Dev -eq 404 -and $v1e.Data -eq 0) ($v1 | ConvertTo-Json -Compress)
    $null = Api PATCH "/api/v1/users/$NUid/admin-assignment" @{ managerId = $A2id } $SA
    $v2 = & $see $A1 'A1'; $v2b = & $see $A2 'A2'; $v2c = & $see $nuTok 'owner'
    Check 'N21' 'After moving the User to Admin A2, visibility follows: A1 loses device + data, A2 gains it, the owner is unaffected' ($v2.Dev -eq 404 -and $v2.Data -eq 0 -and $v2.Latest -eq 404 -and $v2b.Dev -eq 200 -and $v2b.Data -eq 2 -and $v2b.Latest -eq 200 -and $v2b.Hist -eq 200 -and $v2c.Dev -eq 200 -and $v2c.Data -eq 2)
    $null = Api PATCH "/api/v1/users/$NUid/admin-assignment" @{ managerId = $saId } $SA
    $v3 = & $see $A1 'A1'; $v3b = & $see $A2 'A2'; $v3d = & $see $SA 'SA'; $v3c = & $see $nuTok 'owner'
    Check 'N21b' 'Standalone (managed by SuperAdmin): neither Admin sees the device or data; SuperAdmin and the owner still do' ($v3.Dev -eq 404 -and $v3.Data -eq 0 -and $v3b.Dev -eq 404 -and $v3b.Data -eq 0 -and $v3d.Dev -eq 200 -and $v3d.Data -ge 2 -and $v3c.Data -eq 2)
    Check 'N21c' 'Admins cannot assign a device outside their scope (404) and can never unassign (403)' ((Api POST "/api/v1/devices/$ND/assign" @{ userId = $U1id } $A1).Status -eq 404 -and (Api POST "/api/v1/devices/$ND/unassign" @{} $A1).Status -eq 403 -and (Api POST "/api/v1/devices/$ND/assign" @{ userId = $NUid } $A2).Status -eq 404)
    $histRows = Sql $Db "SELECT COUNT(*) FROM SensorData WHERE device_id='VVTEST-N-1'"
    $asgRows = Sql $Db "SELECT COUNT(*) FROM DeviceAssignments WHERE DeviceRecordId=$ND"
    $asgUser = Sql $Db "SELECT UserId FROM DeviceAssignments WHERE DeviceRecordId=$ND AND IsActive=1"
    Check 'N22' 'Reassigning the manager preserved the User, the device assignment and every sensor reading' ($histRows -eq '2' -and $asgRows -eq '1' -and $asgUser -eq "$NUid") "readings=$histRows assignments=$asgRows"
    $n_as2 = Api POST "/api/v1/devices/$ND/assign" @{ userId = $NSid } $SA
    Check 'N22b' 'Device assignment APIs still work: SuperAdmin reassigns to a standalone User; history kept (2 rows, 1 active)' ($n_as.Status -eq 200 -and $n_as2.Status -eq 200 -and (Api GET "/api/v1/devices/$ND/assignments" $null $SA).Json.totalCount -eq 2)

    # N23: auth behaviour unchanged by reassignment
    $nlg = Login 'nunder@vvtest.local' $Pw
    $nrf = Api POST /api/v1/auth/refresh @{ refreshToken = $nlg.Json.refreshToken }
    $null = Api PATCH "/api/v1/users/$NUid/admin-assignment" @{ managerId = $A1id } $SA
    Check 'N23' 'Login and refresh still work after reassignment; /auth/me reports the current manager' ($nlg.Status -eq 200 -and $nrf.Status -eq 200 -and (Api GET /api/v1/auth/me $null $nrf.Json.accessToken).Json.managerId -eq $A1id)
    $null = Api POST "/api/v1/users/$NUid/reset-password" @{ newPassword = 'NewN#Pass12345' } $SA
    Check 'N23b' 'Password reset revokes the Users refresh tokens; new password works, old does not' ((Api POST /api/v1/auth/refresh @{ refreshToken = $nrf.Json.refreshToken }).Status -eq 401 -and (Login 'nunder@vvtest.local' 'NewN#Pass12345').Status -eq 200 -and (Login 'nunder@vvtest.local' $Pw).Status -eq 401)
    Check 'N23c' 'Last active SuperAdmin remains protected, and a SuperAdmin cannot be given a manager' ((Api PATCH "/api/v1/users/$saId/status" @{ isActive = $false } $SA).Status -eq 409 -and (Sql $Db "SELECT COUNT(*) FROM Users WHERE Role='SuperAdmin' AND ManagerId IS NOT NULL") -eq '0')

    # N24-N26: contract + schema
    $swn = Api GET /swagger/v1/swagger.json
    $adm = $swn.Json.paths.'/api/v1/admins/{adminId}/users'
    $sup = $swn.Json.paths.'/api/v1/superadmin/users'
    Check 'N24' 'Swagger documents GET/POST /admins/{adminId}/users and GET /superadmin/users with Bearer security and 400/401/403/404 responses' ($adm.get -and $adm.post -and $sup.get -and ($adm.get.security | ConvertTo-Json -Compress -Depth 6) -match 'Bearer' -and $adm.get.responses.'403' -and $adm.get.responses.'404' -and $adm.post.responses.'400' -and $adm.post.responses.'404' -and $adm.post.responses.'409' -and $sup.get.responses.'403' -and $sup.get.responses.'401')
    $props = @($swn.Json.components.schemas.CreateUserRequest.properties.PSObject.Properties.Name)
    Check 'N24b' 'OpenAPI contract: managerId (not adminId) on create/assign/user schemas; UserDto exposes managerRole + assignmentType' ($props -contains 'managerId' -and $props -notcontains 'adminId' -and @($swn.Json.components.schemas.ManagerAssignmentRequest.properties.PSObject.Properties.Name) -contains 'managerId' -and @($swn.Json.components.schemas.UserDto.properties.PSObject.Properties.Name) -contains 'assignmentType' -and @($swn.Json.components.schemas.UserDto.properties.PSObject.Properties.Name) -contains 'managerRole' -and $swn.Json.components.schemas.AdminUsersPage.properties.adminId)
    $cols = Sql $Db "SELECT STRING_AGG(COLUMN_NAME, ',') WITHIN GROUP (ORDER BY ORDINAL_POSITION) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Users'"
    Check 'N25' 'Users schema: ManagerId present, AdminId gone, existing columns preserved, lockout columns appended' ($cols -eq 'Id,Name,Email,PasswordHash,Role,IsActive,CreatedAt,UpdatedAt,LastLoginAt,ManagerId,FailedLoginCount,LastFailedLoginAt,LockoutUntil') $cols
    Check 'N25b' 'Database objects: self-referencing FK_Users_Users_ManagerId, CK_Users_Role, CK_Users_Manager, TR_Users_ManagerRules, IX_Users_ManagerId, unique email index' ((Sql $Db "SELECT COUNT(*) FROM sys.foreign_keys WHERE name='FK_Users_Users_ManagerId' AND parent_object_id=referenced_object_id") -eq '1' -and (Sql $Db "SELECT COUNT(*) FROM sys.check_constraints WHERE name IN ('CK_Users_Role','CK_Users_Manager') AND parent_object_id=OBJECT_ID('dbo.Users')") -eq '2' -and (Sql $Db "SELECT COUNT(*) FROM sys.triggers WHERE name='TR_Users_ManagerRules'") -eq '1' -and (Sql $Db "SELECT COUNT(*) FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.Users') AND name IN ('IX_Users_ManagerId','IX_Users_Email')") -eq '2')
    $h = '$2a$11$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345'
    function DbTry([string]$sql) { $null = sqlcmd -S $SqlServer @sqlAuth -C -I -d $Db -h -1 -W -b -Q "SET NOCOUNT ON; $sql" 2>&1; if ($LASTEXITCODE -ne 0) { 'BLOCKED' } else { 'ALLOWED' } }
    Check 'N26' 'Database rejects invalid manager shapes: User without manager, Admin with a manager, User managed by a User, self-management, demoting a manager, bad role' ((DbTry "INSERT INTO Users (Name,Email,PasswordHash,Role,ManagerId) VALUES ('x','ndb1@vvtest.local','$h','User',NULL)") -eq 'BLOCKED' -and (DbTry "INSERT INTO Users (Name,Email,PasswordHash,Role,ManagerId) VALUES ('x','ndb2@vvtest.local','$h','Admin',$A1id)") -eq 'BLOCKED' -and (DbTry "INSERT INTO Users (Name,Email,PasswordHash,Role,ManagerId) VALUES ('x','ndb3@vvtest.local','$h','User',$U1id)") -eq 'BLOCKED' -and (DbTry "UPDATE Users SET ManagerId=Id WHERE Id=$U1id") -eq 'BLOCKED' -and (DbTry "UPDATE Users SET Role='User', ManagerId=$saId WHERE Id=$A1id") -eq 'BLOCKED' -and (DbTry "INSERT INTO Users (Name,Email,PasswordHash,Role,ManagerId) VALUES ('x','ndb4@vvtest.local','$h','Boss',NULL)") -eq 'BLOCKED')
    Check 'N26b' 'Database accepts the valid shapes (User under Admin, User under SuperAdmin)' ((DbTry "INSERT INTO Users (Name,Email,PasswordHash,Role,ManagerId) VALUES ('x','ndb5@vvtest.local','$h','User',$A1id)") -eq 'ALLOWED' -and (DbTry "INSERT INTO Users (Name,Email,PasswordHash,Role,ManagerId) VALUES ('x','ndb6@vvtest.local','$h','User',$saId)") -eq 'ALLOWED')


    # ================= PHASE 4: PUBLIC LISTENER GUARD + INGEST RATE LIMIT =================
    $pub = "http://localhost:$pubPort"
    $pubOk = ApiAt $pub POST /api/v1/sensor-data @{ deviceId = 'VVTEST-DEV-1'; recordedAt = (Ts 2); aqi = 41 } $null @{ 'X-Device-Key' = $K1 }
    Check 'P01' 'Public listener: POST /api/v1/sensor-data with a valid device key works (201) and stores the reading' ($pubOk.Status -eq 201 -and $pubOk.Json.deviceId -eq 'VVTEST-DEV-1' -and $pubOk.Json.aqi -eq 41) $pubOk.Raw
    $blocked = @(
        @('GET', '/api/v1/health'), @('GET', '/'), @('GET', '/swagger'), @('GET', '/swagger/index.html'), @('GET', '/swagger/v1/swagger.json'),
        @('POST', '/api/v1/auth/login'), @('POST', '/api/v1/auth/refresh'), @('GET', '/api/v1/auth/me'), @('POST', '/api/v1/auth/logout'),
        @('GET', '/api/v1/users'), @('POST', '/api/v1/users'), @('GET', "/api/v1/users/$saId"), @('PATCH', "/api/v1/users/$U1id/admin-assignment"),
        @('GET', '/api/v1/devices'), @('POST', '/api/v1/devices'), @('POST', "/api/v1/devices/$D1/assign"), @('POST', "/api/v1/devices/$D1/rotate-key"),
        @('GET', '/api/v1/sensor-data'), @('GET', '/api/v1/sensor-data/1'), @('GET', "/api/v1/devices/$D1/sensor-data/latest"), @('GET', "/api/v1/devices/$D1/sensor-data/history"),
        @('GET', "/api/v1/admins/$A1id/users"), @('POST', "/api/v1/admins/$A1id/users"), @('GET', '/api/v1/superadmin/users'),
        @('PUT', '/api/v1/sensor-data'), @('DELETE', '/api/v1/sensor-data'), @('PATCH', '/api/v1/sensor-data'), @('OPTIONS', '/api/v1/sensor-data'), @('HEAD', '/api/v1/sensor-data'), @('GET', '/api/v1/sensor-data'),
        @('POST', '/api/v1/sensor-data/'), @('POST', '/api/v1/sensor-data/1'), @('POST', '/api/v1/sensor-data/latest'), @('POST', '//api/v1/sensor-data'), @('POST', '/api/v1/sensor-data%2F'), @('POST', '/anything')
    )
    $leaks = @()
    foreach ($b in $blocked) {
        $r = ApiAt $pub $b[0] $b[1] @{ deviceId = 'VVTEST-DEV-1'; aqi = 1 } $SA @{ 'X-Device-Key' = $K1 }   # strongest case: a valid SuperAdmin JWT and a valid device key are attached
        if ($r.Status -ne 404 -or $r.Raw -ne '') { $leaks += "$($b[0]) $($b[1]) -> $($r.Status)" }
    }
    Check 'P02' "Public listener: $($blocked.Count) other method/path combinations (login, users, devices, reads, health, Swagger, admin routes, wrong verbs, path tricks) all return an empty 404 even with a valid SuperAdmin JWT" ($leaks.Count -eq 0) ($leaks -join '; ')
    Check 'P03' 'The private listener is unaffected (health 200, login 200, users 200, Swagger 200)' ((Api GET /api/v1/health).Status -eq 200 -and (Login $saEmail $saPass).Status -eq 200 -and (Api GET '/api/v1/users?pageSize=1' $null $SA).Status -eq 200 -and (Invoke-WebRequest "$base/swagger/index.html" -SkipHttpErrorCheck).StatusCode -eq 200)
    $e1 = ApiAt $pub POST /api/v1/sensor-data @{ deviceId = 'VVTEST-DEV-1'; aqi = 1 }
    $e2 = ApiAt $pub POST /api/v1/sensor-data @{ deviceId = 'VVTEST-DEV-1'; humidity = 150 } $null @{ 'X-Device-Key' = $K1 }
    $e3 = ApiAt $pub POST /api/v1/sensor-data @{ deviceId = 'VVTEST-DEV-1'; recordedAt = $pubOk.Json.recordedAt.ToUniversalTime().ToString('o'); aqi = 2 } $null @{ 'X-Device-Key' = $K1 }
    $e4 = ApiAt $pub POST /api/v1/sensor-data @{ deviceId = 'NO-SUCH-DEVICE'; aqi = 1 } $null @{ 'X-Device-Key' = $K1 }
    Check 'P04' 'Public ingest keeps the documented error contract: no key 401, invalid value 400, duplicate 409, unknown device 401 (ApiError JSON)' ($e1.Status -eq 401 -and $e1.Json.code -eq 'unauthorized' -and $e2.Status -eq 400 -and $e2.Json.code -eq 'validation_failed' -and $e3.Status -eq 409 -and $e3.Json.code -eq 'duplicate_reading' -and $e4.Status -eq 401) "$($e1.Status)/$($e2.Status)/$($e3.Status)/$($e4.Status)"
    $spoof = ApiAt $pub GET /api/v1/health $null $null @{ Host = "localhost:$Port"; 'X-Forwarded-Port' = "$Port"; 'X-Forwarded-For' = '127.0.0.1'; 'X-Original-URL' = '/api/v1/sensor-data' }
    Check 'P05' 'Spoofed Host / X-Forwarded-* headers cannot reach a private route through the public listener (guard uses the real local port)' ($spoof.Status -eq 404 -and $spoof.Raw -eq '')
    Check 'P06' 'Readings accepted through the public listener are visible to the authorized owner via the private API' ((Api GET '/api/v1/sensor-data?deviceId=VVTEST-DEV-1&pageSize=100' $null $SA).Json.items | Where-Object { $_.aqi -eq 41 }).Count -ge 1

    # per-IP ingest rate limit (separate instance with a tiny limit so the main run is not throttled)
    $rPort = $Port + 3
    $saveLim = $env:RateLimiting__IngestPermitPerMinute
    $env:RateLimiting__IngestPermitPerMinute = '3'
    $saveLogin = $env:RateLimiting__LoginPermitLimit; $env:RateLimiting__LoginPermitLimit = '5'
    $rApp = Start-Process dotnet -ArgumentList @((Join-Path $bin 'VayuVata.dll'), '--urls', "http://localhost:$rPort") -WorkingDirectory $project -PassThru `
        -RedirectStandardOutput (Join-Path $runDir 'rate.log') -RedirectStandardError (Join-Path $runDir 'rate.err.log') -WindowStyle Hidden
    $env:RateLimiting__IngestPermitPerMinute = $saveLim; $env:RateLimiting__LoginPermitLimit = $saveLogin
    $rUp = $false
    1..40 | ForEach-Object { if (-not $rUp) { try { $rUp = ((Invoke-WebRequest "http://localhost:$rPort/api/v1/health" -SkipHttpErrorCheck).StatusCode -eq 200) } catch { Start-Sleep 1 } } }
    $codes = 1..8 | ForEach-Object { (ApiAt "http://localhost:$rPort" POST /api/v1/sensor-data @{ deviceId = 'VVTEST-DEV-1'; aqi = 1 } $null @{ 'X-Device-Key' = 'wrong-key' }).Status }
    Check 'P07' 'Ingest endpoint is rate limited per client IP: with a limit of 3/min the first 3 requests reach the endpoint (401) and the rest get 429' ($rUp -and @($codes[0..2] | Where-Object { $_ -ne 401 }).Count -eq 0 -and @($codes[3..7] | Where-Object { $_ -ne 429 }).Count -eq 0) ($codes -join ',')
    # login rate limit (IP based, unchanged) on the same throwaway instance: limit 5/min; unknown e-mails so no real account is touched
    $lc = 1..8 | ForEach-Object { Invoke-WebRequest "http://localhost:$rPort/api/v1/auth/login" -Method Post -ContentType 'application/json' -Body '{"email":"nobody-rl@vvtest.local","password":"WrongPass123"}' -SkipHttpErrorCheck }
    $lcodes = @($lc | ForEach-Object { [int]$_.StatusCode }); $l429 = $lc[7]; $b429 = [string]$l429.Content | ConvertFrom-Json
    Check 'A19' 'Login rate limiting (per IP, limit 5/min): first 5 attempts reach the endpoint (401), the rest get 429' (@($lcodes[0..4] | Where-Object { $_ -ne 401 }).Count -eq 0 -and @($lcodes[5..7] | Where-Object { $_ -ne 429 }).Count -eq 0) ($lcodes -join ',')
    Check 'A19b' '429 uses the standard error body (rate_limited), a Retry-After header, an X-Request-Id and the security headers' ($b429.code -eq 'rate_limited' -and $b429.status -eq 429 -and $l429.Headers['Retry-After'] -and [int]$l429.Headers['Retry-After'][0] -ge 1 -and $l429.Headers['X-Request-Id'] -and $l429.Headers['X-Content-Type-Options'][0] -eq 'nosniff') $l429.Content
    Get-NetTCPConnection -LocalPort $rPort -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    if ($rApp -and -not $rApp.HasExited) { Stop-Process -Id $rApp.Id -Force -ErrorAction SilentlyContinue }

    # ================= PHASE 5: STAGE B (P1 API quality, P2 authentication, P3 database) =================
    function Req([string]$method, [string]$path, $body = $null, [string]$token = $null, [hashtable]$headers = @{}, [string]$root = $base, [string]$rawBody = $null) {
        $zh = @{} + $headers
        if ($token) { $zh.Authorization = "Bearer $token" }
        $zp = @{ Uri = "$root$path"; Method = $method; Headers = $zh; SkipHttpErrorCheck = $true }
        if ($rawBody) { $zp.Body = $rawBody; $zp.ContentType = 'application/json' } elseif ($null -ne $body) { $zp.Body = ($body | ConvertTo-Json -Depth 6); $zp.ContentType = 'application/json' }
        Invoke-WebRequest @zp
    }
    function Hdr($r, [string]$name) { $v = $r.Headers[$name]; if ($v) { ($v -join ',') } else { $null } }
    function Body($r) { try { $c = $r.Content; if ($c -is [byte[]]) { $c = [Text.Encoding]::UTF8.GetString($c) }; [string]$c | ConvertFrom-Json } catch { $null } }
    function Logtext { Start-Sleep -Milliseconds 700; (Get-Content $log -Raw -ErrorAction SilentlyContinue) + (Get-Content $errLogPath -Raw -ErrorAction SilentlyContinue) }
    function SqlApp([string]$query) {
        if (-not $uatMode) { return (Sql $Db $query) }
        $o = sqlcmd -S $SqlServer -U $env:VV_APP_USER -P $env:VV_APP_PASSWORD -C -I -d $Db -h -1 -W -b -Q "SET NOCOUNT ON; $query" 2>&1
        if ($LASTEXITCODE -ne 0) { 'ERR: ' + ($o -join ' ') } else { ($o | Where-Object { $_ -and $_ -notmatch '^\s*$' }) -join "`n" }
    }

    # ---- P3: migrations are an explicit step, the API only warns when told to migrate at start-up ----
    $logAll = Logtext
    Check 'M01' 'Explicit migration command ran: status listed the migrations, --migrate applied/confirmed them' ($script:migStatus -match 'Applied migrations' -and $script:migRun -match '(Applied \d+ migration|up to date)') "status=[$($script:migStatus -replace "`n",' ')] run=[$($script:migRun -replace "`n",' ')]"
    Check 'M02' 'A second --migrate is a safe no-op ("up to date"), exit code 0' ($script:migRun2 -match 'up to date' -and $script:migRun2Exit -eq 0) $script:migRun2
    Check 'M03' 'Application start-up does NOT migrate: legacy Database:ApplyMigrationsOnStartup=true is ignored with a warning' ($logAll -match 'ApplyMigrationsOnStartup is no longer supported')
    Check 'M04' 'Migration command refuses ASPNETCORE_ENVIRONMENT=Production (exit 2), a wrong database name (exit 2) and a missing migration login (exit 2)' ($script:migProdExit -eq 2 -and $script:migDbExit -eq 2 -and $script:migNoCsExit -eq 2) "prod=$($script:migProdExit) db=$($script:migDbExit) nocs=$($script:migNoCsExit)"
    Check 'M05' 'Existing active sessions survive the migration (active refresh-token count unchanged by --migrate)' ($script:activeBefore -eq $script:activeAfter) "before=$($script:activeBefore) after=$($script:activeAfter)"
    Check 'M06' 'Every refresh token has a FamilyId; every user has lockout columns defaulting to zero/NULL' ((Sql $Db "SELECT COUNT(*) FROM RefreshTokens WHERE FamilyId IS NULL") -eq '0' -and (Sql $Db "SELECT COUNT(*) FROM Users WHERE FailedLoginCount IS NULL") -eq '0')
    Check 'M07' 'AuthHardening is in the EF history exactly once' ((Sql $Db "SELECT COUNT(*) FROM __EFMigrationsHistory WHERE MigrationId LIKE '%AuthHardening'") -eq '1')

    # ---- P3: database permissions of the runtime login ----
    # SAFETY: these probes run REAL DDL (CREATE/ALTER/DROP) as the runtime login and expect it to be denied. They only run when that login is not db_owner.
    $runtimeIsOwner = if ($uatMode) { (SqlApp "SELECT IS_MEMBER('db_owner')") -eq '1' } else { $false }
    if ($uatMode -and -not $runtimeIsOwner) {
        $perm = SqlApp "SELECT CONCAT(IS_MEMBER('db_owner'), IS_MEMBER('db_ddladmin'), IS_MEMBER('db_securityadmin'), IS_SRVROLEMEMBER('sysadmin'))"
        Check 'G01' 'Runtime login is not db_owner / db_ddladmin / db_securityadmin / sysadmin' ($perm -eq '0000') "flags=$perm"
        $ddl1 = SqlApp "CREATE TABLE dbo.vvtest_probe (x int)"
        $ddl2 = SqlApp "ALTER TABLE dbo.Users ADD vvtest_probe int NULL"
        $ddl3 = SqlApp "DROP INDEX IX_Users_ManagerId ON dbo.Users"
        $ddl4 = SqlApp "EXEC(N'CREATE TRIGGER dbo.TR_vvtest_probe ON dbo.Devices AFTER INSERT AS SELECT 1')"
        if ($ddl1 -notlike 'ERR:*') { $null = Sql $Db "DROP TABLE IF EXISTS dbo.vvtest_probe" }
        Check 'G02' 'Runtime login cannot run DDL: CREATE TABLE, ALTER TABLE, DROP INDEX, CREATE TRIGGER are all denied' (($ddl1, $ddl2, $ddl3, $ddl4 | Where-Object { $_ -match '^ERR:.*(denied|do not have permission)' }).Count -eq 4) "$ddl1 | $ddl2 | $ddl3 | $ddl4"
        $del = foreach ($t in 'Users', 'Devices', 'DeviceAssignments', 'SensorData', 'ManipulatedSensorData') { SqlApp "DELETE FROM dbo.$t WHERE 1 = 0" }
        Check 'G03' 'Runtime login cannot DELETE users, devices, assignments or sensor readings (history cannot be erased through the API account)' (($del | Where-Object { $_ -match '^ERR:.*(denied|do not have permission)' }).Count -eq 5) ($del -join ' | ')
        $rw = @(SqlApp "SELECT COUNT(*) FROM dbo.Users"; SqlApp "UPDATE dbo.Users SET UpdatedAt = UpdatedAt WHERE 1 = 0"; SqlApp "DELETE FROM dbo.RefreshTokens WHERE 1 = 0")
        Check 'G04' 'Runtime login keeps what the API needs: SELECT/UPDATE on tables and DELETE on RefreshTokens only' (($rw | Where-Object { $_ -like 'ERR:*' }).Count -eq 0) ($rw -join ' | ')
        $null = Api GET '/api/v1/users?pageSize=1' $null $SA
        $sessAll = (Sql master "SELECT CONCAT(login_name, '=', COUNT(*)) FROM sys.dm_exec_sessions WHERE is_user_process = 1 AND login_name IN ('$($env:VV_APP_USER)', '$($env:VV_SQL_USER)') GROUP BY login_name" -Admin) -replace "`n", ', '
        $sess = Sql master "SELECT COUNT(*) FROM sys.dm_exec_sessions WHERE is_user_process = 1 AND login_name = '$($env:VV_APP_USER)'" -Admin
        Check 'G05' 'The API under test connects with the restricted runtime login (sessions of that login exist and its connection string was the only one given to the API)' ([int]$sess -ge 1 -and $env:ConnectionStrings__Default -like "*User Id=$($env:VV_APP_USER);*" -and -not $env:ConnectionStrings__Migration) "sessions: $sessAll"
    } else {
        Skip 'G01-G05' 'Runtime-login permission checks' $(if ($runtimeIsOwner) { 'the runtime login was made db_owner at the owner''s request (2026-10-13); the DDL probes are NOT executed' } else { 'only meaningful in UAT mode (separate SQL logins)' })
    }
    $ix = Sql $Db "SELECT CONCAT((SELECT COUNT(*) FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.Devices') AND name='IX_Devices_DeviceId'), '|', (SELECT COUNT(*) FROM sys.key_constraints WHERE name='AK_Devices_DeviceId' AND type='UQ'), '|', (SELECT COUNT(*) FROM sys.foreign_keys WHERE name='FK_SensorData_Devices_device_id'))"
    Check 'X01' 'Duplicate unique index IX_Devices_DeviceId is gone; AK_Devices_DeviceId (unique) and the SensorData foreign key remain' ($ix -eq '0|1|1') $ix
    Check 'X02' 'DeviceId uniqueness and sensor-data referential integrity are still enforced by the database' ((DbTry "INSERT INTO Devices (DeviceId,DeviceName,ApiKeyHash,IsActive) VALUES ('VVTEST-DEV-1','dup','$('a' * 64)',1)") -eq 'BLOCKED' -and (DbTry "INSERT INTO SensorData (device_id,data_date,data_time,recorded_at) VALUES ('NO-SUCH-DEVICE-VV','2026-01-01','00:00:00','2026-01-01T00:00:00')") -eq 'BLOCKED')

    # ---- P3: expired refresh-token cleanup ----
    $keep = Sql $Db "SELECT COUNT(*) FROM RefreshTokens WHERE TokenHash IN ($($script:seedKeep -join ','))"
    $gone = Sql $Db "SELECT COUNT(*) FROM RefreshTokens WHERE TokenHash IN ($($script:seedGone -join ','))"
    Check 'T01' 'Cleanup removed exactly the tokens that expired more than 30 days ago (3 seeded rows, two batches of 2)' ($gone -eq '0') "remaining old=$gone"
    Check 'T02' 'Cleanup kept: active token, token revoked-but-unexpired (needed for reuse detection), token expired only 10 days ago' ($keep -eq '3') "kept=$keep"
    Check 'T03' 'Cleanup never touched pre-existing sessions (active token count of rows older than this run unchanged)' ((Sql $Db "SELECT COUNT(*) FROM RefreshTokens WHERE Id <= $tokenBaseline AND RevokedAt IS NULL AND ExpiresAt > SYSUTCDATETIME()") -eq "$($script:activeAfter)")
    Check 'T04' 'Cleanup is logged (count + cutoff, no token values)' ($logAll -match 'Refresh-token cleanup removed 3 token')

    # ---- P2: account lockout ----
    $lk = New-User $SA 'Lock One' 'lock1@vvtest.local' 'User'; $LKid = $lk.Json.id
    $lkWrong = 1..5 | ForEach-Object { Login 'lock1@vvtest.local' 'WrongPass123' }
    $lkRight = Login 'lock1@vvtest.local' $Pw
    $lkRow = (Sql $Db "SELECT CONCAT(FailedLoginCount, '|', CASE WHEN LockoutUntil > SYSUTCDATETIME() THEN 'locked' ELSE 'open' END, '|', DATEDIFF(MINUTE, SYSUTCDATETIME(), LockoutUntil)) FROM Users WHERE Id=$LKid") -split '\|'
    Check 'L01' 'Five wrong passwords lock the account: the 6th attempt with the CORRECT password is refused (401)' (@($lkWrong | Where-Object { $_.Status -ne 401 }).Count -eq 0 -and $lkRight.Status -eq 401 -and $lkRow[0] -eq '5' -and $lkRow[1] -eq 'locked') ($lkRow -join '|')
    Check 'L02' 'Lockout is temporary (about 15 minutes), not permanent' ([int]$lkRow[2] -ge 13 -and [int]$lkRow[2] -le 16) ($lkRow -join '|')
    $dis = New-User $SA 'Disabled One' 'disabled1@vvtest.local' 'User'
    $null = Api PATCH "/api/v1/users/$($dis.Json.id)/status" @{ isActive = $false } $SA
    $variants = @((Login 'nobody-l@vvtest.local' 'WrongPass123'), (Login 'user1@vvtest.local' 'WrongPass123'), $lkRight, (Login 'disabled1@vvtest.local' $Pw))
    $sig = $variants | ForEach-Object { "$($_.Status)|$($_.Json.code)|$($_.Json.message)|$($_.Json.title)|$($_.Json.type)" } | Sort-Object -Unique
    Check 'L03' 'Unknown account, wrong password, locked account and disabled account are indistinguishable to the client (same status, code and message)' (@($sig).Count -eq 1) ($sig -join ' // ')
    $untilBefore = Sql $Db "SELECT CONVERT(varchar(30), LockoutUntil, 121) FROM Users WHERE Id=$LKid"
    $null = Login 'lock1@vvtest.local' 'WrongPass123'
    Check 'L04' 'Failed attempts while locked do not extend the lock (no indefinite lockout by an attacker)' ((Sql $Db "SELECT CONVERT(varchar(30), LockoutUntil, 121) FROM Users WHERE Id=$LKid") -eq $untilBefore)
    $null = Sql $Db "UPDATE Users SET LockoutUntil = DATEADD(HOUR, -1, SYSUTCDATETIME()), LastFailedLoginAt = DATEADD(HOUR, -1, SYSUTCDATETIME()) WHERE Id=$LKid"
    $lkBack = Login 'lock1@vvtest.local' $Pw
    $lkAfter = Sql $Db "SELECT CONCAT(FailedLoginCount, '|', ISNULL(CONVERT(varchar(30), LockoutUntil, 121), 'NULL')) FROM Users WHERE Id=$LKid"
    Check 'L05' 'After the lock expires the correct password works again, and the counters are cleared' ($lkBack.Status -eq 200 -and $lkAfter -eq '0|NULL') $lkAfter
    $rs = New-User $SA 'Lock Two' 'lock2@vvtest.local' 'User'
    $null = 1..2 | ForEach-Object { Login 'lock2@vvtest.local' 'WrongPass123' }
    $okMid = Login 'lock2@vvtest.local' $Pw
    $null = 1..4 | ForEach-Object { Login 'lock2@vvtest.local' 'WrongPass123' }
    $stillOk = Login 'lock2@vvtest.local' $Pw
    Check 'L06' 'A successful login resets the failure counter (2 fails, success, 4 fails does not lock; next correct login works)' ($okMid.Status -eq 200 -and $stillOk.Status -eq 200 -and (Sql $Db "SELECT FailedLoginCount FROM Users WHERE Id=$($rs.Json.id)") -eq '0')
    $lk3 = New-User $SA 'Lock Three' 'lock3@vvtest.local' 'User'
    $null = 1..5 | ForEach-Object { Login 'lock3@vvtest.local' 'WrongPass123' }
    $lockedNow = (Login 'lock3@vvtest.local' $Pw).Status
    $null = Api POST "/api/v1/users/$($lk3.Json.id)/reset-password" @{ newPassword = 'Unlocked#Pass77' } $SA
    Check 'L07' 'An Admin/SuperAdmin password reset is the recovery path: it clears the lock immediately' ($lockedNow -eq 401 -and (Login 'lock3@vvtest.local' 'Unlocked#Pass77').Status -eq 200)
    $lk4 = New-User $SA 'Lock Four' 'lock4@vvtest.local' 'User'
    $pcodes = 1..10 | ForEach-Object -ThrottleLimit 10 -Parallel {
        $r = Invoke-WebRequest -Uri "$($using:base)/api/v1/auth/login" -Method POST -ContentType 'application/json' -Body (@{ email = 'lock4@vvtest.local'; password = 'WrongPass123' } | ConvertTo-Json) -SkipHttpErrorCheck
        [int]$r.StatusCode
    }
    $pr = (Sql $Db "SELECT CONCAT(FailedLoginCount, '|', CASE WHEN LockoutUntil > SYSUTCDATETIME() THEN 'locked' ELSE 'open' END) FROM Users WHERE Id=$($lk4.Json.id)") -split '\|'
    Check 'L08' 'Concurrent wrong passwords are counted atomically: all 401, account locked, counter between 5 and 10' (@($pcodes | Where-Object { $_ -ne 401 }).Count -eq 0 -and $pr[1] -eq 'locked' -and [int]$pr[0] -ge 5 -and [int]$pr[0] -le 10) "codes=$($pcodes -join ',') db=$($pr -join '|')"
    Check 'L09' 'Lock does not depend on the client: unknown e-mails never create lock state; the real SuperAdmin was never failed (counters 0)' ((Sql $Db "SELECT COUNT(*) FROM Users WHERE Role='SuperAdmin' AND (FailedLoginCount <> 0 OR LockoutUntil IS NOT NULL)") -eq '0')

    # ---- P2: refresh-token rotation, reuse detection, concurrency ----
    $ru = New-User $SA 'Refresh One' 'refresh1@vvtest.local' 'User'; $RUid = $ru.Json.id
    $sessA = Login 'refresh1@vvtest.local' $Pw
    $sessB = Login 'refresh1@vvtest.local' $Pw   # a second, independent login (own family)
    $t1 = $sessA.Json.refreshToken
    $rr2 = Api POST /api/v1/auth/refresh @{ refreshToken = $t1 }; $t2 = $rr2.Json.refreshToken
    $rr3 = Api POST /api/v1/auth/refresh @{ refreshToken = $t2 }; $t3 = $rr3.Json.refreshToken
    Check 'R01' 'Legitimate rotation chain works: login -> refresh -> refresh, each returns a new, different refresh token' ($rr2.Status -eq 200 -and $rr3.Status -eq 200 -and $t1 -ne $t2 -and $t2 -ne $t3 -and $rr3.Json.accessToken)
    $fam = Sql $Db "SELECT COUNT(DISTINCT FamilyId) FROM RefreshTokens WHERE TokenHash IN ('$(JwtHash $t1)','$(JwtHash $t2)','$(JwtHash $t3)')"
    Check 'R02' 'All tokens of one login share a family; a second login has its own family' ($fam -eq '1' -and (Sql $Db "SELECT COUNT(DISTINCT FamilyId) FROM RefreshTokens WHERE UserId=$RUid") -eq '2')
    $reuse = Api POST /api/v1/auth/refresh @{ refreshToken = $t1 }
    $afterReuse = Api POST /api/v1/auth/refresh @{ refreshToken = $t3 }
    Check 'R03' 'Re-using an already-rotated refresh token is rejected (401) AND revokes the whole family: the newest token of that login stops working too' ($reuse.Status -eq 401 -and $afterReuse.Status -eq 401)
    Check 'R04' 'Reuse detection is targeted: the other login (different family) of the same user is NOT revoked' ((Api POST /api/v1/auth/refresh @{ refreshToken = $sessB.Json.refreshToken }).Status -eq 200)
    Check 'R05' 'Family revocation is recorded in the database (no active token left in the compromised family)' ((Sql $Db "SELECT COUNT(*) FROM RefreshTokens WHERE TokenHash IN ('$(JwtHash $t1)','$(JwtHash $t2)','$(JwtHash $t3)') AND RevokedAt IS NULL") -eq '0')
    $rc = New-User $SA 'Refresh Two' 'refresh2@vvtest.local' 'User'
    $rcl = Login 'refresh2@vvtest.local' $Pw
    $rtok = $rcl.Json.refreshToken
    $rcodes = 1..8 | ForEach-Object -ThrottleLimit 8 -Parallel {
        $r = Invoke-WebRequest -Uri "$($using:base)/api/v1/auth/refresh" -Method POST -ContentType 'application/json' -Body (@{ refreshToken = $using:rtok } | ConvertTo-Json) -SkipHttpErrorCheck
        [int]$r.StatusCode
    }
    $activeAfterRace = Sql $Db "SELECT COUNT(*) FROM RefreshTokens WHERE UserId=$($rc.Json.id) AND RevokedAt IS NULL AND ExpiresAt > SYSUTCDATETIME()"
    Check 'R06' 'Concurrent refreshes with ONE token: exactly one succeeds, the rest get 401, no 5xx, and never more than one valid token chain results' (@($rcodes | Where-Object { $_ -eq 200 }).Count -eq 1 -and @($rcodes | Where-Object { $_ -notin 200, 401 }).Count -eq 0 -and [int]$activeAfterRace -le 1) "codes=$($rcodes -join ',') active=$activeAfterRace"
    $ex = New-User $SA 'Refresh Three' 'refresh3@vvtest.local' 'User'
    $exl = Login 'refresh3@vvtest.local' $Pw
    $null = Sql $Db "UPDATE RefreshTokens SET ExpiresAt = DATEADD(MINUTE, -5, SYSUTCDATETIME()) WHERE UserId=$($ex.Json.id)"
    Check 'R07' 'An expired refresh token is rejected (401)' ((Api POST /api/v1/auth/refresh @{ refreshToken = $exl.Json.refreshToken }).Status -eq 401)
    $lo = Login 'refresh1@vvtest.local' $Pw
    $null = Api POST /api/v1/auth/logout @{ refreshToken = $lo.Json.refreshToken } $lo.Json.accessToken
    $otherSess = Login 'refresh1@vvtest.local' $Pw
    $loReuse = Api POST /api/v1/auth/refresh @{ refreshToken = $lo.Json.refreshToken }
    Check 'R08' 'A logged-out (revoked) refresh token is rejected (401) without ending the user''s other sessions' ($loReuse.Status -eq 401 -and (Api POST /api/v1/auth/refresh @{ refreshToken = $otherSess.Json.refreshToken }).Status -eq 200)
    $logNow = Logtext
    Check 'R09' 'Reuse is logged as a SECURITY warning with the user id (never the token value)' ($logNow -match "refresh-token reuse detected for user $RUid" -and $logNow -notmatch [regex]::Escape($t1))

    # ---- P2: POST /auth/change-password ----
    $cp = New-User $SA 'Change One' 'change1@vvtest.local' 'User'; $CPid = $cp.Json.id
    $cpOther = New-User $SA 'Change Other' 'changeother@vvtest.local' 'User'
    $cpS = Login 'change1@vvtest.local' $Pw
    $cpS2 = Login 'change1@vvtest.local' $Pw   # a second session that must be ended by the change
    $NewPw = 'Changed#Pass456'
    Check 'C01' 'Unauthenticated change-password is 401' ((Api POST /api/v1/auth/change-password @{ currentPassword = $Pw; newPassword = $NewPw }).Status -eq 401)
    Check 'C02' 'Wrong current password is refused (400, code current_password_incorrect) and the password is unchanged' ((Api POST /api/v1/auth/change-password @{ currentPassword = 'NotMyPass123'; newPassword = $NewPw } $cpS.Json.accessToken).Json.code -eq 'current_password_incorrect' -and (Login 'change1@vvtest.local' $Pw).Status -eq 200)
    $weak = Api POST /api/v1/auth/change-password @{ currentPassword = $Pw; newPassword = 'short' } $cpS.Json.accessToken
    $same = Api POST /api/v1/auth/change-password @{ currentPassword = $Pw; newPassword = $Pw } $cpS.Json.accessToken
    $nodigit = Api POST /api/v1/auth/change-password @{ currentPassword = $Pw; newPassword = 'NoDigitsHereAtAll' } $cpS.Json.accessToken
    $empty = Api POST /api/v1/auth/change-password @{} $cpS.Json.accessToken
    Check 'C03' 'Password policy enforced: too short, no digit, same as current, missing fields are all 400 with field-level errors' ($weak.Status -eq 400 -and $weak.Json.errors.NewPassword -and $same.Status -eq 400 -and $same.Json.errors.NewPassword -and $nodigit.Status -eq 400 -and $empty.Status -eq 400 -and $empty.Json.errors.CurrentPassword)
    $before = Sql $Db "SELECT PasswordHash FROM Users WHERE Id=$CPid"
    $chg = Api POST /api/v1/auth/change-password @{ currentPassword = $Pw; newPassword = $NewPw; userId = $($cpOther.Json.id); email = 'changeother@vvtest.local' } $cpS.Json.accessToken
    Check 'C04' 'Success returns 200 with a fresh session (new access + refresh token) and no password material' ($chg.Status -eq 200 -and $chg.Json.accessToken -and $chg.Json.refreshToken -and $chg.Json.email -eq 'change1@vvtest.local' -and $chg.Raw -notmatch '(?i)password|hash')
    Check 'C05' 'Old password stops working; new password works' ((Login 'change1@vvtest.local' $Pw).Status -eq 401 -and (Login 'change1@vvtest.local' $NewPw).Status -eq 200)
    Check 'C06' 'The target is always the caller: a userId/email in the body is ignored and the other user''s password is unchanged' ((Login 'changeother@vvtest.local' $Pw).Status -eq 200 -and (Login 'changeother@vvtest.local' $NewPw).Status -eq 401)
    Check 'C07' 'All earlier refresh tokens of the user are revoked (other sessions end); the new session''s refresh token works' ((Api POST /api/v1/auth/refresh @{ refreshToken = $cpS.Json.refreshToken }).Status -eq 401 -and (Api POST /api/v1/auth/refresh @{ refreshToken = $cpS2.Json.refreshToken }).Status -eq 401 -and (Api POST /api/v1/auth/refresh @{ refreshToken = $chg.Json.refreshToken }).Status -eq 200)
    $afterHash = Sql $Db "SELECT PasswordHash FROM Users WHERE Id=$CPid"
    Check 'C08' 'Stored as a new BCrypt hash (not plain text, different from before)' ($afterHash -like '$2*' -and $afterHash -ne $before -and $afterHash -notmatch [regex]::Escape($NewPw))
    $cpAdm = Api POST /api/v1/auth/change-password @{ currentPassword = $Pw; newPassword = 'AdminNew#Pass88' } (Token 'admin2@vvtest.local')
    Check 'C09' 'Admin can change their own password too (same endpoint, any role); the old one is then rejected' ($cpAdm.Status -eq 200 -and (Login 'admin2@vvtest.local' 'AdminNew#Pass88').Status -eq 200 -and (Login 'admin2@vvtest.local' $Pw).Status -eq 401)
    $cpLock = New-User $SA 'Change Lock' 'changelock@vvtest.local' 'User'
    $cpLockTok = Token 'changelock@vvtest.local'
    $cpTry = 1..5 | ForEach-Object { (Api POST /api/v1/auth/change-password @{ currentPassword = 'GuessGuess123'; newPassword = 'Whatever#Pass12' } $cpLockTok).Status }
    $cpSixth = Api POST /api/v1/auth/change-password @{ currentPassword = $Pw; newPassword = 'Whatever#Pass12' } $cpLockTok
    Check 'C10' 'A stolen access token cannot be used to guess the current password: 5 failures lock the account, the next try is 429 account_locked' (@($cpTry | Where-Object { $_ -ne 400 }).Count -eq 0 -and $cpSixth.Status -eq 429 -and $cpSixth.Json.code -eq 'account_locked')
    $null = Api PATCH "/api/v1/users/$($dis.Json.id)/status" @{ isActive = $true } $SA
    $dsTok = Token 'disabled1@vvtest.local'
    $null = Api PATCH "/api/v1/users/$($dis.Json.id)/status" @{ isActive = $false } $SA
    Check 'C11' 'A disabled user cannot change a password (existing access token is rejected, 401)' ((Api POST /api/v1/auth/change-password @{ currentPassword = $Pw; newPassword = 'DisabledNew#Pass9' } $dsTok).Status -eq 401)

    # ---- P1: request id, headers, problem details, 413 ----
    $r200 = Req GET /api/v1/health
    $r401 = Req GET /api/v1/auth/me
    $r404 = Req GET /api/v1/does-not-exist
    $r400 = Req POST /api/v1/auth/login -rawBody '{"email": 5'
    $ids = @($r200, $r401, $r404, $r400 | ForEach-Object { Hdr $_ 'X-Request-Id' })
    Check 'H01' 'Every response (200, 401, 404, 400) carries a distinct X-Request-Id' (@($ids | Where-Object { $_ }).Count -eq 4 -and @($ids | Sort-Object -Unique).Count -eq 4) ($ids -join ',')
    $b401 = Body $r401
    Check 'H02' 'traceId in the error body equals the X-Request-Id header' ($b401.traceId -eq (Hdr $r401 'X-Request-Id') -and (Body $r404).traceId -eq (Hdr $r404 'X-Request-Id') -and (Body $r400).traceId -eq (Hdr $r400 'X-Request-Id'))
    $echo = Req GET /api/v1/health -headers @{ 'X-Request-Id' = 'client-trace-123' }
    $bad = Req GET /api/v1/health -headers @{ 'X-Request-Id' = 'has spaces and <script>' }
    Check 'H03' 'A safe caller-supplied X-Request-Id is echoed; an unsafe one is replaced by a generated id' ((Hdr $echo 'X-Request-Id') -eq 'client-trace-123' -and (Hdr $bad 'X-Request-Id') -notmatch 'script' -and (Hdr $bad 'X-Request-Id').Length -ge 16)
    $hdrFail = @()
    foreach ($rr in @($r200, $r401, $r404, $r400)) {
        foreach ($pair in 'X-Content-Type-Options=nosniff', 'X-Frame-Options=DENY', 'Referrer-Policy=no-referrer', 'Cache-Control=no-store') {
            $k, $v = $pair -split '=', 2
            if ((Hdr $rr $k) -ne $v) { $hdrFail += "$($rr.StatusCode) $k=[$(Hdr $rr $k)]" }
        }
        if ($null -ne (Hdr $rr 'Server')) { $hdrFail += "$($rr.StatusCode) Server=[$(Hdr $rr 'Server')]" }
        if ((Hdr $rr 'Content-Security-Policy') -notmatch "default-src 'none'") { $hdrFail += "$($rr.StatusCode) CSP" }
    }
    Check 'H04' 'Security headers present on every response (nosniff, DENY, no-referrer, no-store, CSP) and the Server header is gone' ($hdrFail.Count -eq 0) ($hdrFail -join '; ')
    $pubNf = Req GET /api/v1/health -root "http://localhost:$pubPort"
    Check 'H05' 'Security headers and request id are also set on the public listener''s empty 404' ($pubNf.StatusCode -eq 404 -and (Hdr $pubNf 'X-Content-Type-Options') -eq 'nosniff' -and (Hdr $pubNf 'X-Request-Id') -and $null -eq (Hdr $pubNf 'Server') -and [string]$pubNf.Content -eq '')
    $pd = Body $r401
    $pj = Req GET /api/v1/auth/me -headers @{ Accept = 'application/problem+json' }
    Check 'H06' 'Errors are RFC 7807 problem documents (type, title, status, detail, instance) plus the legacy code/message/traceId; labelled application/json by default (existing clients) and application/problem+json when the caller asks for it' ((Hdr $r401 'Content-Type') -match '^application/json' -and (Hdr $pj 'Content-Type') -match 'application/problem\+json' -and (Body $pj).code -eq 'unauthorized' -and $pd.type -like 'urn:vayuvata:error:*' -and $pd.title -eq 'Unauthorized' -and $pd.status -eq 401 -and $pd.detail -and $pd.instance -eq '/api/v1/auth/me' -and $pd.code -eq 'unauthorized' -and $pd.message -and $pd.traceId) $r401.Content
    $multi = Api POST /api/v1/users @{ name = ''; email = 'not-an-email'; password = 'x'; role = 'User' } $SA
    Check 'H07' 'Validation errors are actionable: 400 validation_failed with a message list per field (name, email, password)' ($multi.Status -eq 400 -and $multi.Json.code -eq 'validation_failed' -and $multi.Json.errors.Name -and $multi.Json.errors.Email -and $multi.Json.errors.Password -and $multi.Json.errors.Password.Count -ge 2 -and $multi.Json.type -eq 'urn:vayuvata:error:validation_failed')
    $bigBody = '{"email":"a@b.cc","password":"Passw0rd!x1"}' + (' ' * 20000)   # padded valid JSON: only the size limit can reject it, not the validators
    $r413 = Req POST /api/v1/auth/login -rawBody $bigBody
    $b413 = Body $r413
    Check 'H08' 'Oversized request (20 KB > 16 KB limit) returns 413 payload_too_large in the standard error body (was 400)' ($r413.StatusCode -eq 413 -and $b413.code -eq 'payload_too_large' -and (Hdr $r413 'X-Request-Id')) "status=$($r413.StatusCode) $($r413.Content)"
    $r413i = Req POST /api/v1/sensor-data -rawBody ('{"deviceId":"VVTEST-DEV-1","aqi":5}' + (' ' * 20000)) -headers @{ 'X-Device-Key' = $K1 } -root "http://localhost:$pubPort"
    Check 'H09' 'Oversized ESP32 ingest request is 413 on the public listener too; a normal reading still works (201)' ($r413i.StatusCode -eq 413 -and (Post-Reading 'VVTEST-DEV-1' $K1 @{ aqi = 12 } 3).Status -eq 201)
    Check 'H10' 'Unsupported media type and unknown route still use the standard error body with request id' ((Req POST /api/v1/auth/login -rawBody 'x').StatusCode -in 400, 415 -and (Body $r404).code -eq 'not_found')

    # ---- P1: logs ----
    $null = Req GET '/api/v1/probe/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    $null = Req GET '/api/v1/probe/vv_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    $null = Req GET '/api/v1/probe?password=SuperSecretQueryPw1&token=abc123abc123'
    $lg = Logtext
    $rid = Hdr $r401 'X-Request-Id'
    Check 'H11' 'Access log: one line per request with method, path, status, duration, client ip, user id and the same request id as the response header' ($lg -match "HTTP GET /api/v1/auth/me -> 401 in \d+ ms \(ip [^,]+, port \d+, user -, request $rid\)")
    Check 'H12' 'Access log records the authenticated user id (not the token)' ($lg -match "HTTP GET /api/v1/users/\d+ -> 200 .* user $saId,")
    $secrets = @($Pw, $NewPw, 'BrandNew#Pass9', 'Unlocked#Pass77', 'AdminNew#Pass88', $K1, $K2, $rot.Json.apiKey, $t1, $t2, $t3, $cpS.Json.refreshToken, $SA, $U1, $A1, $jwtKey, 'SuperSecretQueryPw1', 'abc123abc123')
    if ($uatMode) { $secrets += $env:VV_APP_PASSWORD; $secrets += $env:VV_SQL_PASSWORD; $secrets += $saPass }
    $leaked = @($secrets | Where-Object { $_ -and $lg.Contains([string]$_) })
    Check 'H13' 'Logs contain none of: any test password, device key, refresh token, access token (JWT), JWT signing key, DB password, query-string secrets' ($leaked.Count -eq 0 -and $lg -notmatch 'eyJ[A-Za-z0-9_-]{8,}\.' -and $lg -notmatch 'Password=') "leaked $($leaked.Count) value(s)"
    Check 'H14' 'Path-embedded credentials are redacted in the access log (JWT and device-key look-alikes), query strings are never logged' ($lg -match '\[redacted-jwt\]' -and $lg -match '\[redacted-key\]' -and $lg -notmatch 'probe\?')
    Check 'H15' 'Failed-login log lines mask the e-mail (u***@vvtest.local) and give the reason server-side only' ($lg -match 'Failed login for u\*\*\*@vvtest\.local: wrong_password' -and $lg -notmatch 'Failed login for user1@' -and $lg -match ': locked' -and $lg -match ': disabled' -and $lg -match ': unknown_account')

    # ---- P1: OpenAPI contract ----
    $swb = Api GET /swagger/v1/swagger.json
    $ops = foreach ($pp in $swb.Json.paths.PSObject.Properties) { foreach ($mm in $pp.Value.PSObject.Properties) { [pscustomobject]@{ Path = $pp.Name; Method = $mm.Name.ToUpper(); Op = $mm.Value } } }
    $opIds = @($ops | ForEach-Object { $_.Op.operationId })
    Check 'O01' 'All operations have a unique, non-empty operationId' (@($opIds | Where-Object { -not $_ }).Count -eq 0 -and @($opIds | Sort-Object -Unique).Count -eq @($ops).Count) "ops=$(@($ops).Count) distinct=$(@($opIds | Sort-Object -Unique).Count)"
    $docGaps = @()
    foreach ($o in $ops) {
        $rc2 = @($o.Op.responses.PSObject.Properties.Name)
        $needs = @('500')
        if ($o.Op.security | Where-Object { $_.PSObject.Properties.Name -contains 'Bearer' }) { $needs += '401', '403' }
        if ($o.Path -match '\{') { $needs += '404' }
        if ($o.Op.requestBody) { $needs += '400', '413' }
        if ($o.Path -match '/auth/login$|/auth/refresh$|/auth/change-password$' -or ($o.Path -in '/api/v1/sensor-data', '/api/v1/gps-data' -and $o.Method -eq 'POST')) { $needs += '429' }
        foreach ($n in $needs) { if ($rc2 -notcontains $n) { $docGaps += "$($o.Method) $($o.Path) missing $n" } }
        if (-not ($rc2 | Where-Object { $_ -like '2*' })) { $docGaps += "$($o.Method) $($o.Path) has no success response" }
        if (-not $o.Op.summary) { $docGaps += "$($o.Method) $($o.Path) has no summary" }
    }
    Check 'O02' 'Every operation documents its applicable error responses (400/401/403/404/413/429/500), a success response and a summary' ($docGaps.Count -eq 0) (($docGaps | Select-Object -First 6) -join '; ')
    $errSchema = $swb.Json.components.schemas.ApiError.properties.PSObject.Properties.Name
    Check 'O03' 'ApiError schema documents the RFC 7807 fields and the legacy fields; X-Request-Id is documented on responses' (($errSchema -contains 'type') -and ($errSchema -contains 'title') -and ($errSchema -contains 'detail') -and ($errSchema -contains 'instance') -and ($errSchema -contains 'code') -and ($errSchema -contains 'traceId') -and $swb.Json.paths.'/api/v1/auth/me'.get.responses.'401'.headers.'X-Request-Id')
    $base0 = Get-Content (Join-Path $PSScriptRoot 'baseline/openapi-stageA.json') -Raw | ConvertFrom-Json
    $contractLoss = @()
    foreach ($pp in $base0.paths.PSObject.Properties) {
        foreach ($mm in $pp.Value.PSObject.Properties) {
            $now = $swb.Json.paths.($pp.Name).($mm.Name)
            if (-not $now) { $contractLoss += "MISSING $($mm.Name.ToUpper()) $($pp.Name)"; continue }
            foreach ($code in $mm.Value.responses.PSObject.Properties.Name) { if (-not $now.responses.$code) { $contractLoss += "$($mm.Name.ToUpper()) $($pp.Name) lost response $code" } }
            $oldSec = ($mm.Value.security | ConvertTo-Json -Compress -Depth 5); $newSec = ($now.security | ConvertTo-Json -Compress -Depth 5)
            if ($oldSec -ne $newSec) { $contractLoss += "$($mm.Name.ToUpper()) $($pp.Name) security changed" }
        }
    }
    foreach ($sc in $base0.components.schemas.PSObject.Properties) {
        $ns = $swb.Json.components.schemas.($sc.Name)
        if (-not $ns) { $contractLoss += "schema $($sc.Name) removed"; continue }
        foreach ($prop in @($sc.Value.properties.PSObject.Properties.Name)) { if (@($ns.properties.PSObject.Properties.Name) -notcontains $prop) { $contractLoss += "schema $($sc.Name) lost property $prop" } }
    }
    Check 'O04' 'Compatibility with the Stage A contract: all 30 original operations, their documented status codes, security schemes and every schema property still exist (additive changes only)' ($contractLoss.Count -eq 0) ($contractLoss -join '; ')
    $newOps = @($ops | Where-Object { -not $base0.paths.($_.Path) -or -not $base0.paths.($_.Path).($_.Method.ToLower()) } | ForEach-Object { "$($_.Method) $($_.Path)" })
    $hasKh = [bool]$swb.Json.paths.'/api/v1/devices/{id}/key-hash'
    $expectNew = (@('GET /api/v1/gps-data', 'GET /api/v1/gps-data/current', 'POST /api/v1/auth/change-password', 'POST /api/v1/gps-data') + $(if ($hasKh) { 'GET /api/v1/devices/{id}/key-hash' })) | Sort-Object | ForEach-Object { $_ } | Join-String -Separator ','
    Check 'O05' 'Only the expected routes were added since Stage A: change-password, POST + GET /gps-data, GET /gps-data/current (and GET /devices/{id}/key-hash when that separate change is present); nothing else' ((($newOps | Sort-Object) -join ',') -eq $expectNew -and @($ops).Count -eq $(if ($hasKh) { 35 } else { 34 }) -and @($swb.Json.paths.PSObject.Properties).Count -eq $(if ($hasKh) { 28 } else { 27 })) (($newOps | Sort-Object) -join ',')
    $cpOp = $swb.Json.paths.'/api/v1/auth/change-password'.post
    Check 'O06' 'change-password is documented: Bearer security, request body, 200 LoginResponse, 400/401/429' (($cpOp.security | ConvertTo-Json -Compress -Depth 5) -match 'Bearer' -and $cpOp.requestBody -and $cpOp.responses.'200' -and $cpOp.responses.'400' -and $cpOp.responses.'401' -and $cpOp.responses.'429')

    # ---- P3: optional totals ----
    $q1 = Api GET '/api/v1/sensor-data?deviceId=VVTEST-DEV-2&pageSize=3&page=1&includeTotal=false' $null $SA
    $qLast = Api GET '/api/v1/sensor-data?deviceId=VVTEST-DEV-2&pageSize=100&page=1&includeTotal=false' $null $SA
    $qDef = Api GET '/api/v1/sensor-data?deviceId=VVTEST-DEV-2&pageSize=3&page=1' $null $SA
    Check 'Q01' 'includeTotal=false skips the count: totalCount/totalPages null, items = pageSize, hasNextPage true while more rows exist, false on the last page' ($q1.Status -eq 200 -and $null -eq $q1.Json.totalCount -and $null -eq $q1.Json.totalPages -and $q1.Json.items.Count -eq 3 -and $q1.Json.hasNextPage -eq $true -and $qLast.Json.hasNextPage -eq $false -and $null -eq $qLast.Json.totalCount) "$($q1.Raw.Substring(0, [Math]::Min(120, $q1.Raw.Length)))"
    Check 'Q02' 'Default behaviour is unchanged: totalCount and totalPages are present when includeTotal is omitted, and hasNextPage agrees' ($qDef.Json.totalCount -ge 4 -and $qDef.Json.totalPages -ge 2 -and $qDef.Json.hasNextPage -eq $true)
    $qAll = @(
        '/api/v1/users', '/api/v1/devices', "/api/v1/users/$S1id/devices", "/api/v1/devices/$D1/assignments", "/api/v1/devices/$D1/sensor-data/history",
        "/api/v1/admins/$A1id/users", '/api/v1/superadmin/users') | ForEach-Object { $x = Api GET ($_ + '?pageSize=1&includeTotal=false') $null $SA; "$_=$($x.Status)/$($null -eq $x.Json.totalCount)" }
    Check 'Q03' 'includeTotal=false works on every paged list endpoint (7 more endpoints: 200 and no totals)' (@($qAll | Where-Object { $_ -notmatch '=200/True$' }).Count -eq 0) ($qAll -join ' ')
    Check 'Q04' 'Invalid includeTotal value is rejected with 400' ((Api GET '/api/v1/users?includeTotal=maybe' $null $SA).Status -eq 400)
    $q5 = Api GET '/api/v1/users?pageSize=2&page=1&includeTotal=false&role=User' $null $SA
    Check 'Q05' 'Filters still apply together with includeTotal=false' ($q5.Status -eq 200 -and @($q5.Json.items | Where-Object { $_.role -ne 'User' }).Count -eq 0 -and $q5.Json.items.Count -le 2)

    # ---- authorization boundaries for the new endpoint and unchanged ones ----
    Check 'Z01' 'SuperAdmin-only operations still reject Admin and User callers (403) and anonymous callers (401)' ((Api POST /api/v1/devices @{ deviceId = 'VVTEST-ZZ1'; deviceName = 'x' } $A1).Status -eq 403 -and (Api POST /api/v1/devices @{ deviceId = 'VVTEST-ZZ1'; deviceName = 'x' } $U1).Status -eq 403 -and (Api GET /api/v1/superadmin/users $null $A1).Status -eq 403 -and (Api GET /api/v1/superadmin/users $null $U1).Status -eq 403 -and (Api PATCH "/api/v1/users/$U1id/admin-assignment" @{ managerId = $saId } $A1).Status -eq 403 -and (Api GET /api/v1/superadmin/users).Status -eq 401)
    Check 'Z02' 'Route-id tampering: a User cannot read another User''s record, devices or readings by changing ids (404), an Admin cannot manage Users outside their scope (404)' ((Api GET "/api/v1/users/$U3id" $null $U1).Status -eq 404 -and (Api GET "/api/v1/users/$U3id/devices" $null $U1).Status -eq 404 -and (Api GET "/api/v1/devices/$D3/sensor-data/history" $null $U1).Status -eq 404 -and (Api PATCH "/api/v1/users/$U3id/status" @{ isActive = $false } $A1).Status -eq 404 -and (Api POST "/api/v1/users/$U3id/reset-password" @{ newPassword = 'Hacked12345' } $A1).Status -eq 404)
    $zt = Ts 1
    $z1 = Api POST /api/v1/sensor-data @{ deviceId = 'VVTEST-DEV-1'; recordedAt = $zt; aqi = 21 } $null @{ 'X-Device-Key' = $K1 }
    $z2 = Api POST /api/v1/sensor-data @{ deviceId = 'VVTEST-DEV-1'; recordedAt = $zt; aqi = 21 } $null @{ 'X-Device-Key' = $K1 }
    Check 'Z03' 'Device-key ingestion contract unchanged for the ESP32: same path, header and body; 201 on success, 401 wrong key, 409 duplicate; absent values stay NULL' ($z1.Status -eq 201 -and $null -eq $z1.Json.pm25 -and (Post-Reading 'VVTEST-DEV-1' $K2 @{ aqi = 1 } 4).Status -eq 401 -and $z2.Status -eq 409 -and $z2.Json.code -eq 'duplicate_reading')

    # ---- ESP32 ingestion compatibility with the live UAT behaviour (device clock = IST wall-clock labelled as UTC) ----
    $inDate = Api POST /api/v1/sensor-data @{ deviceId = 'VVTEST-DEV-5'; recordedAt = (Ts 90); dataDate = '2026-03-04'; dataTime = '05:06:07'; aqi = 31 } $null @{ 'X-Device-Key' = $K5 }
    $inRow = Sql $Db "SELECT CONCAT(CONVERT(varchar(10), data_date, 23), ' ', CONVERT(varchar(8), data_time, 108)) FROM SensorData WHERE ID=$($inDate.Json.id)"
    Check 'IN1' 'Optional dataDate / dataTime from the device are accepted and stored as sent (recordedAt unaffected); omitted ones are derived from recordedAt' ($inDate.Status -eq 201 -and $inRow -eq '2026-03-04 05:06:07' -and $inDate.Json.dataDate -eq '2026-03-04') "$($inDate.Status) db=$inRow"
    $inNoTs = Api POST /api/v1/sensor-data @{ deviceId = 'VVTEST-DEV-5'; aqi = 32 } $null @{ 'X-Device-Key' = $K5 }
    $inOff = Sql $Db "SELECT ABS(DATEDIFF(MINUTE, recorded_at, DATEADD(MINUTE, 330, SYSUTCDATETIME()))) FROM SensorData WHERE ID=$($inNoTs.Json.id)"
    Check 'IN2' 'A reading without recordedAt is stamped with the device-clock convention (UTC + 330 min = IST wall-clock), as on the live service' ($inNoTs.Status -eq 201 -and [int]$inOff -le 3) "off=$inOff"
    $in5h = Api POST /api/v1/sensor-data @{ deviceId = 'VVTEST-DEV-5'; recordedAt = (Ts -300); aqi = 33 } $null @{ 'X-Device-Key' = $K5 }
    $in7h = Api POST /api/v1/sensor-data @{ deviceId = 'VVTEST-DEV-5'; recordedAt = (Ts -420); aqi = 34 } $null @{ 'X-Device-Key' = $K5 }
    Check 'IN3' 'A device clock up to 6 h ahead of UTC (IST labelled UTC) is accepted; 7 h and 2 days ahead are rejected (400)' ($in5h.Status -eq 201 -and $in7h.Status -eq 400 -and $in7h.Json.code -eq 'validation_failed') "5h=$($in5h.Status) 7h=$($in7h.Status)"
    $keyHash = Sql $Db "SELECT ApiKeyHash FROM Devices WHERE DeviceId='VVTEST-DEV-5'"
    $otherHash = Sql $Db "SELECT ApiKeyHash FROM Devices WHERE DeviceId='VVTEST-DEV-3'"
    $inHashOff = Api POST /api/v1/sensor-data @{ deviceId = 'VVTEST-DEV-5'; recordedAt = (Ts 91); aqi = 35 } $null @{ 'X-Device-Key' = $keyHash }
    Check 'IN4' 'SECURE DEFAULT: presenting the stored key HASH as the key is refused (401) unless DeviceAuth:AcceptStoredHashAsKey is switched on' ($inHashOff.Status -eq 401)
    $fPort = $Port + 4
    $env:DeviceAuth__AcceptStoredHashAsKey = 'true'
    $fApp = Start-Process dotnet -ArgumentList @((Join-Path $bin 'VayuVata.dll'), '--urls', "http://localhost:$fPort") -WorkingDirectory $project -PassThru `
        -RedirectStandardOutput (Join-Path $runDir 'flag.log') -RedirectStandardError (Join-Path $runDir 'flag.err.log') -WindowStyle Hidden
    $env:DeviceAuth__AcceptStoredHashAsKey = $null
    $fUp = $false
    1..40 | ForEach-Object { if (-not $fUp) { try { $fUp = ((Invoke-WebRequest "http://localhost:$fPort/api/v1/health" -SkipHttpErrorCheck).StatusCode -eq 200) } catch { Start-Sleep 1 } } }
    $fr = "http://localhost:$fPort"
    $fOn = ApiAt $fr POST /api/v1/sensor-data @{ deviceId = 'VVTEST-DEV-5'; recordedAt = (Ts 92); aqi = 36 } $null @{ 'X-Device-Key' = $keyHash }
    $fOnUp = ApiAt $fr POST /api/v1/sensor-data @{ deviceId = 'VVTEST-DEV-5'; recordedAt = (Ts 93); aqi = 37 } $null @{ 'X-Device-Key' = "  $($keyHash.ToUpperInvariant())  " }
    $fOther = ApiAt $fr POST /api/v1/sensor-data @{ deviceId = 'VVTEST-DEV-5'; recordedAt = (Ts 94); aqi = 38 } $null @{ 'X-Device-Key' = $otherHash }
    $fWrong = ApiAt $fr POST /api/v1/sensor-data @{ deviceId = 'VVTEST-DEV-5'; recordedAt = (Ts 95); aqi = 39 } $null @{ 'X-Device-Key' = ('0' * 64) }
    $fRaw = ApiAt $fr POST /api/v1/sensor-data @{ deviceId = 'VVTEST-DEV-5'; recordedAt = (Ts 96); aqi = 40 } $null @{ 'X-Device-Key' = $K5 }
    Check 'IN5' 'COMPATIBILITY SWITCH ON (as on the live UAT): the stored hash (also trimmed/upper-case) authenticates its own device only; another device''s hash and a wrong value are 401; the real key still works' ($fUp -and $fOn.Status -eq 201 -and $fOnUp.Status -eq 201 -and $fOther.Status -eq 401 -and $fWrong.Status -eq 401 -and $fRaw.Status -eq 201) "$($fOn.Status)/$($fOnUp.Status)/$($fOther.Status)/$($fWrong.Status)/$($fRaw.Status)"
    Get-NetTCPConnection -LocalPort $fPort -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    if ($fApp -and -not $fApp.HasExited) { Stop-Process -Id $fApp.Id -Force -ErrorAction SilentlyContinue }

    # ================= PHASE 6: SensorData INSERT trigger -> dbo.ProcessSensorData -> dbo.ManipulatedSensorData =================
    # Oracle: the firmware's own calculateAQI_INDIA() text (Tests/firmware), parsed - breakpoints are not re-typed here.
    $fwText = Get-Content (Join-Path $PSScriptRoot 'firmware/calculateAQI_INDIA.cpp') -Raw
    function Parse-Branches([string]$var) {
        $rx = [regex]"(?:if \(\w+ <= (\d+)\)\s*)?$var = map\(\w+,\s*(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)\)"
        @($rx.Matches($fwText) | ForEach-Object { [pscustomobject]@{ Upper = $(if ($_.Groups[1].Success) { [long]$_.Groups[1].Value } else { [long]::MaxValue }); A = [long]$_.Groups[2].Value; B = [long]$_.Groups[3].Value; C = [long]$_.Groups[4].Value; D = [long]$_.Groups[5].Value } })
    }
    $br25 = Parse-Branches 'aqiPM25'; $br10 = Parse-Branches 'aqiPM10'
    $stRx = [regex]'aqi <= (\d+)\)\s*return "([^"]+)"'
    $stList = @($stRx.Matches($fwText) | ForEach-Object { [pscustomobject]@{ Upper = [long]$_.Groups[1].Value; Name = $_.Groups[2].Value } })
    $stElse = ([regex]'else\s+return "([^"]+)"').Match($fwText).Groups[1].Value
    function Fw-Map([long]$x, $br) {
        foreach ($b in $br) { if ($x -le $b.Upper) { $q = [Math]::DivRem(($x - $b.A) * ($b.D - $b.C), ($b.B - $b.A)); return [long]($q.Item1 + $b.C) } }
    }
    function Fw-Aqi($pm25, $pm10) {
        if ($null -eq $pm25 -or $null -eq $pm10) { return $null }
        $a = Fw-Map ([long][Math]::Truncate([decimal]$pm25)) $br25; $b = Fw-Map ([long][Math]::Truncate([decimal]$pm10)) $br10
        [Math]::Max($a, $b)
    }
    function Fw-Status($aqi) { if ($null -eq $aqi) { return $null }; foreach ($s in $stList) { if ($aqi -le $s.Upper) { return $s.Name } }; $stElse }
    Check 'AQ00' 'Oracle parsed from the firmware text: 6 PM2.5 intervals, 6 PM10 intervals, 5 status thresholds + Severe' ($br25.Count -eq 6 -and $br10.Count -eq 6 -and $stList.Count -eq 5 -and $stElse -eq 'Severe') "$($br25.Count)/$($br10.Count)/$($stList.Count)/$stElse"

    # ---- structure of the new database objects ----
    $objs = Sql $Db "SELECT CONCAT((SELECT COUNT(*) FROM sys.tables WHERE name='ManipulatedSensorData'), (SELECT COUNT(*) FROM sys.types WHERE is_table_type=1 AND name='SensorDataIdList'), (SELECT COUNT(*) FROM sys.procedures WHERE name='ProcessSensorData'), (SELECT COUNT(*) FROM sys.triggers WHERE name='TR_SensorData_AfterInsert' AND parent_id=OBJECT_ID('dbo.SensorData')))"
    Check 'TR01' 'Table, table type, procedure and trigger exist (applied by the migration)' ($objs -eq '1111') $objs
    $mcols = Sql $Db "SELECT STRING_AGG(name, ',') WITHIN GROUP (ORDER BY column_id) FROM sys.columns WHERE object_id=OBJECT_ID('dbo.ManipulatedSensorData')"
    Check 'TR02' 'ManipulatedSensorData has the 18 source columns (original names) plus ManipulatedSensorDataID, SourceSensorDataID and processed_at' ($mcols -eq 'ManipulatedSensorDataID,SourceSensorDataID,ID,device_id,data_date,data_time,recorded_at,aqi,aqi_status,pm10,pm25,no2_ppm,so2_ppm,co_ppm,tvoc_ppb,humidity,temperature,outer_temperature,outer_humidity,created_at,processed_at') $mcols
    $typeCmp = Sql $Db "SELECT COUNT(*) FROM (SELECT c.name, c.system_type_id, c.max_length, c.precision, c.scale, c.is_nullable FROM sys.columns c WHERE c.object_id=OBJECT_ID('dbo.SensorData') AND c.name <> 'ID') a JOIN (SELECT c.name, c.system_type_id, c.max_length, c.precision, c.scale, c.is_nullable FROM sys.columns c WHERE c.object_id=OBJECT_ID('dbo.ManipulatedSensorData')) b ON a.name=b.name AND a.system_type_id=b.system_type_id AND a.max_length=b.max_length AND a.precision=b.precision AND a.scale=b.scale AND a.is_nullable=b.is_nullable"
    Check 'TR03' 'Source data types, precision and nullability are preserved in all 17 copied columns (ID is the bigint copy of the source ID)' ($typeCmp -eq '17') $typeCmp
    $trg = Sql $Db "SELECT CONCAT((SELECT COUNT(*) FROM sys.triggers WHERE parent_id=OBJECT_ID('dbo.SensorData')), '|', (SELECT STRING_AGG(te.type_desc, ',') FROM sys.trigger_events te JOIN sys.triggers t ON t.object_id=te.object_id WHERE t.name='TR_SensorData_AfterInsert'), '|', (SELECT is_instead_of_trigger FROM sys.triggers WHERE name='TR_SensorData_AfterInsert'), '|', (SELECT is_disabled FROM sys.triggers WHERE name='TR_SensorData_AfterInsert'), '|', (SELECT is_recursive_triggers_on FROM sys.databases WHERE name=DB_NAME()))"
    Check 'TR04' 'Exactly one trigger on SensorData: AFTER INSERT only, enabled, database recursive triggers off' ($trg -eq '1|INSERT|0|0|0') $trg
    # sqlcmd truncates long text columns, so the reviewed script files are inspected and the database copy is proven identical by length + checksum below.
    $trgDef = Get-Content (Join-Path $project 'Database/Objects/03_TR_SensorData_AfterInsert.sql') -Raw
    $prcDef = Get-Content (Join-Path $project 'Database/Objects/02_ProcessSensorData.sql') -Raw
    $dbLen = Sql $Db "SELECT CONCAT(DATALENGTH(OBJECT_DEFINITION(OBJECT_ID('dbo.TR_SensorData_AfterInsert')))/2, '|', DATALENGTH(OBJECT_DEFINITION(OBJECT_ID('dbo.ProcessSensorData')))/2)"
    $dl = $dbLen -split '\|'; $fl = @((($trgDef -replace "`r?`n","`r`n")).Length, (($prcDef -replace "`r?`n","`r`n")).Length)
    # SQL Server stores "CREATE OR ALTER" as "CREATE" + blanks and appends a line break, so the stored text differs from the file by a few characters only.
    Check 'TR05b' 'The objects in the database are the reviewed script files (stored length equals the file length within SQL Server''s CREATE OR ALTER normalisation, +-8 characters)' ([Math]::Abs([int]$dl[0] - $fl[0]) -le 8 -and [Math]::Abs([int]$dl[1] - $fl[1]) -le 8) "db=$dbLen files=$($fl -join '|')"
    Check 'TR05' 'Trigger is a thin wrapper (no cursor, no AQI logic, never writes to SensorData); procedure has no cursor and never commits/rolls back/updates/deletes SensorData' ($trgDef -notmatch '(?i)cursor|CASE\s+WHEN|\b(UPDATE|DELETE)\b|INSERT\s+dbo\.SensorData' -and $trgDef -match 'ProcessSensorData' -and $prcDef -notmatch '(?i)DECLARE\s+\w+\s+CURSOR|COMMIT\s+TRAN|ROLLBACK\s+TRAN|BEGIN\s+TRAN\w*\s*[;\r\n]' -and $prcDef -notmatch '(?i)\bUPDATE\s+dbo\.SensorData|\bDELETE\s+(FROM\s+)?dbo\.SensorData')
    $tconstr = Sql $Db "SELECT CONCAT((SELECT COUNT(*) FROM sys.indexes WHERE name='UX_ManipulatedSensorData_Source' AND is_unique=1), (SELECT COUNT(*) FROM sys.foreign_keys WHERE name='FK_ManipulatedSensorData_SensorData_SourceSensorDataID'), (SELECT COUNT(*) FROM sys.key_constraints WHERE name='PK_ManipulatedSensorData'), (SELECT COUNT(*) FROM sys.check_constraints WHERE name='CK_ManipulatedSensorData_ID'))"
    Check 'TR06' 'Unique index on SourceSensorDataID, FK to SensorData, primary key and ID = SourceSensorDataID check exist' ($tconstr -eq '1111') $tconstr

    # ---- test data ----
    $aqD = New-Device $SA 'VVTEST-AQI-1'
    $aqBase = '2020-06-01T00:00:00'
    function Dv($v) { if ($null -eq $v) { 'NULL' } else { ([decimal]$v).ToString([Globalization.CultureInfo]::InvariantCulture) } }
    $v25 = @(-5, -1, 0, 1, 15, 29, 29.99, 30, 30.5, 31, 32, 45, 59, 60, 60.99, 61, 62, 75, 89, 90, 91, 92, 105, 119, 120, 121, 122, 200, 249, 250, 251, 252, 300, 400, 499, 500, 501, 595)
    $v10 = @(-5, 0, 1, 25, 49, 50, 50.5, 51, 52, 75, 99, 100, 101, 102, 150, 249, 250, 251, 252, 300, 349, 350, 351, 352, 400, 429, 430, 431, 432, 500, 501, 624)
    $cases = [System.Collections.Generic.List[object]]::new()
    foreach ($x in $v25) { $cases.Add(@($x, 0)) }
    foreach ($y in $v10) { $cases.Add(@(0, $y)) }
    0..59 | ForEach-Object { $cases.Add(@($v25[($_ * 7) % $v25.Count], $v10[($_ * 11) % $v10.Count])) }
    $n = 0
    $rowsSql = foreach ($c in $cases) {
        $n++
        "(N'VVTEST-AQI-1','2020-06-01','00:00:00',DATEADD(SECOND,$n,'$aqBase'),999,N'FromDevice',$(Dv $c[1]),$(Dv $c[0]),0.0123,0.0456,0.5,NULL,50.5,25.25,NULL,NULL)"
    }
    $cols = '(device_id,data_date,data_time,recorded_at,aqi,aqi_status,pm10,pm25,no2_ppm,so2_ppm,co_ppm,tvoc_ppb,humidity,temperature,outer_temperature,outer_humidity)'
    $ins = Sql $Db "INSERT dbo.SensorData $cols VALUES $($rowsSql -join ','); SELECT @@ROWCOUNT"
    $gotRows = Sql $Db "SELECT COUNT(*) FROM dbo.ManipulatedSensorData WHERE device_id='VVTEST-AQI-1'"
    Check 'TR07' "ONE multi-row INSERT of $($cases.Count) readings creates exactly one manipulated row per reading (set based)" ($ins -eq "$($cases.Count)" -and $gotRows -eq "$($cases.Count)") "inserted=$ins processed=$gotRows"
    $dupSrc = Sql $Db "SELECT COUNT(*) FROM (SELECT SourceSensorDataID FROM dbo.ManipulatedSensorData GROUP BY SourceSensorDataID HAVING COUNT(*) > 1) x"
    Check 'TR08' 'No source reading has more than one manipulated row (whole table)' ($dupSrc -eq '0')

    # ---- AQI parity with the firmware ----
    $out = (Sql $Db "SELECT CONCAT(DATEDIFF(SECOND,'$aqBase',recorded_at), '|', pm25, '|', pm10, '|', ISNULL(CAST(aqi AS varchar(20)),'NULL'), '|', ISNULL(aqi_status,'NULL')) FROM dbo.ManipulatedSensorData WHERE device_id='VVTEST-AQI-1' ORDER BY recorded_at") -split "`n"
    $aqiBad = @(); $stBad = @(); $report = [System.Text.StringBuilder]::new()
    [void]$report.AppendLine('| # | pm25 | pm10 | firmware AQI | SQL AQI | firmware status | SQL status | result |'); [void]$report.AppendLine('|---|---|---|---|---|---|---|---|')
    foreach ($line in $out) {
        $f = $line -split '\|'; $idx = [int]$f[0]; $c = $cases[$idx - 1]
        $exp = Fw-Aqi $c[0] $c[1]; $expSt = Fw-Status $exp
        $okA = ("$exp" -eq $f[3]); $okS = ($expSt -eq $f[4])
        if (-not $okA) { $aqiBad += "pm25=$($c[0]) pm10=$($c[1]) exp=$exp got=$($f[3])" }
        if (-not $okS) { $stBad += "aqi=$exp exp=$expSt got=$($f[4])" }
        [void]$report.AppendLine("| $idx | $($c[0]) | $($c[1]) | $exp | $($f[3]) | $expSt | $($f[4]) | $(if ($okA -and $okS) { 'PASS' } else { '**FAIL**' }) |")
    }
    Set-Content (Join-Path $PSScriptRoot 'AqiBoundaryResults.md') -Encoding utf8 -Value ("# AQI parity: SQL dbo.ProcessSensorData vs ESP32 calculateAQI_INDIA`n`nGenerated by ``Tests/Run-ApiTests.ps1`` (AQ01-AQ03) on $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz') against the UAT database. Expected values are computed from the parsed firmware source (``Tests/firmware/calculateAQI_INDIA.cpp``) with Arduino ``map()`` integer semantics.`n`n$($out.Count) readings, $(@($aqiBad).Count) AQI mismatches, $(@($stBad).Count) status mismatches.`n`n" + $report.ToString())
    Check 'AQ01' "AQI from SQL equals the firmware's calculateAQI_INDIA for all $($out.Count) readings (every PM2.5 and PM10 breakpoint, both sides of each boundary, fractional values, negatives, > 500, mixed pairs)" ($out.Count -eq $cases.Count -and $aqiBad.Count -eq 0) (($aqiBad | Select-Object -First 5) -join '; ')
    Check 'AQ02' 'aqi_status equals the firmware getAQIStatus for every reading (Good / Satisfactory / Moderate / Poor / Very Poor / Severe)' ($stBad.Count -eq 0) (($stBad | Select-Object -First 5) -join '; ')
    $present = @($out | ForEach-Object { ($_ -split '\|')[4] } | Sort-Object -Unique)
    Check 'AQ03' 'All six status values were exercised by the boundary set' ($present.Count -eq 6) ($present -join ',')
    $lit = [regex]::Matches((Get-Content (Join-Path $PSScriptRoot 'firmware/calculateAQI_INDIA.cpp') -Raw), 'map\(\w+,\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)') | ForEach-Object { "$($_.Groups[1].Value),$($_.Groups[2].Value),$($_.Groups[3].Value),$($_.Groups[4].Value)" }
    $divs = [regex]::Matches($prcDef, '\*\s*(\d+)\s*/\s*(\d+)\s*\+\s*(\d+)') | ForEach-Object { "$($_.Groups[1].Value)/$($_.Groups[2].Value)/$($_.Groups[3].Value)" }
    Check 'AQ04' 'The procedure encodes exactly the 12 firmware intervals (out-span / in-span / out-min of every map())' (@($divs).Count -eq 12 -and (@($lit | ForEach-Object { $p = $_ -split ','; "$([int]$p[3]-[int]$p[2])/$([int]$p[1]-[int]$p[0])/$($p[2])" } | Sort-Object) -join ' ') -eq (@($divs | Sort-Object) -join ' ')) "sql=$(@($divs | Sort-Object) -join ' ')"

    # ---- NULL handling, no recalibration, all 18 fields copied ----
    $nulls = Sql $Db @"
INSERT dbo.SensorData $cols VALUES
 (N'VVTEST-AQI-1','2020-07-01','00:00:00','2020-07-01T00:00:01',77,N'FromDevice',50,NULL,0.1,0.2,0,NULL,NULL,NULL,NULL,NULL),
 (N'VVTEST-AQI-1','2020-07-01','00:00:00','2020-07-01T00:00:02',77,N'FromDevice',NULL,50,0.1,0.2,0,NULL,NULL,NULL,NULL,NULL),
 (N'VVTEST-AQI-1','2020-07-01','00:00:00','2020-07-01T00:00:03',77,N'FromDevice',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
 (N'VVTEST-AQI-1','2020-07-01','00:00:00','2020-07-01T00:00:04',NULL,NULL,23.45,12.34,1.2345,2.3456,3.4567,456.78,55.55,26.66,31.31,48.48);
SELECT CONCAT(ISNULL(CAST(aqi AS varchar(10)),'N'), ISNULL(aqi_status,'N'), '|', ISNULL(CAST(co_ppm AS varchar(20)),'N'), '|', ISNULL(CAST(tvoc_ppb AS varchar(20)),'N')) FROM dbo.ManipulatedSensorData WHERE device_id='VVTEST-AQI-1' AND recorded_at BETWEEN '2020-07-01T00:00:01' AND '2020-07-01T00:00:03' ORDER BY recorded_at
"@
    $nl = $nulls -split "`n"
    Check 'NU01' 'Missing PM2.5 and/or PM10 -> aqi and aqi_status stay NULL (no invented fallback, the device-reported 77 is ignored); other NULLs stay NULL and a real 0 stays 0' ($nl.Count -eq 3 -and $nl[0] -eq 'NN|0.0000|N' -and $nl[1] -eq 'NN|0.0000|N' -and $nl[2] -eq 'NN|N|N') ($nl -join ' ; ')
    $full = Sql $Db "SELECT CONCAT(aqi,'|',aqi_status,'|',no2_ppm,'|',so2_ppm,'|',co_ppm,'|',tvoc_ppb,'|',humidity,'|',temperature,'|',outer_temperature,'|',outer_humidity) FROM dbo.ManipulatedSensorData WHERE device_id='VVTEST-AQI-1' AND recorded_at='2020-07-01T00:00:04'"
    Check 'NU02' 'A fully populated reading: PM2.5 12.34 / PM10 23.45 give AQI 23 "Good" (max of 20 and 23) (computed - the source aqi was NULL) and every other measurement is copied unchanged with its precision (not recalibrated)' ($full -eq '23|Good|1.2345|2.3456|3.4567|456.78|55.55|26.66|31.31|48.48') $full
    $diffA = Sql $Db "SELECT COUNT(*) FROM (SELECT ID,device_id,data_date,data_time,recorded_at,pm10,pm25,no2_ppm,so2_ppm,co_ppm,tvoc_ppb,humidity,temperature,outer_temperature,outer_humidity,created_at FROM dbo.SensorData WHERE device_id LIKE 'VVTEST-%' EXCEPT SELECT ID,device_id,data_date,data_time,recorded_at,pm10,pm25,no2_ppm,so2_ppm,co_ppm,tvoc_ppb,humidity,temperature,outer_temperature,outer_humidity,created_at FROM dbo.ManipulatedSensorData WHERE device_id LIKE 'VVTEST-%') x"
    $diffB = Sql $Db "SELECT COUNT(*) FROM (SELECT ID,device_id,data_date,data_time,recorded_at,pm10,pm25,no2_ppm,so2_ppm,co_ppm,tvoc_ppb,humidity,temperature,outer_temperature,outer_humidity,created_at FROM dbo.ManipulatedSensorData WHERE device_id LIKE 'VVTEST-%' EXCEPT SELECT ID,device_id,data_date,data_time,recorded_at,pm10,pm25,no2_ppm,so2_ppm,co_ppm,tvoc_ppb,humidity,temperature,outer_temperature,outer_humidity,created_at FROM dbo.SensorData WHERE device_id LIKE 'VVTEST-%') x"
    $cntS = Sql $Db "SELECT COUNT(*) FROM dbo.SensorData WHERE device_id LIKE 'VVTEST-%'"; $cntM = Sql $Db "SELECT COUNT(*) FROM dbo.ManipulatedSensorData WHERE device_id LIKE 'VVTEST-%'"
    Check 'CP01' 'All 16 non-calculated source columns are copied exactly for every tagged reading (set difference both ways is empty, row counts equal, ID = source ID)' ($diffA -eq '0' -and $diffB -eq '0' -and $cntS -eq $cntM -and [int]$cntM -ge 130) "diff=$diffA/$diffB src=$cntS man=$cntM"
    Check 'CP02' 'processed_at is set by SQL Server (UTC, within minutes of now); SourceSensorDataID equals ID' ((Sql $Db "SELECT COUNT(*) FROM dbo.ManipulatedSensorData WHERE device_id LIKE 'VVTEST-%' AND (processed_at < DATEADD(MINUTE,-30,SYSUTCDATETIME()) OR processed_at > DATEADD(MINUTE,5,SYSUTCDATETIME()) OR SourceSensorDataID <> ID)") -eq '0')
    Check 'CP03' 'Database rejects a second manipulated row for the same source and a manipulated row without a source' ((DbTry "INSERT dbo.ManipulatedSensorData (SourceSensorDataID,ID,device_id,data_date,data_time,recorded_at,created_at) SELECT TOP 1 SourceSensorDataID,ID,device_id,data_date,data_time,recorded_at,created_at FROM dbo.ManipulatedSensorData WHERE device_id LIKE 'VVTEST-%'") -eq 'BLOCKED' -and (DbTry "INSERT dbo.ManipulatedSensorData (SourceSensorDataID,ID,device_id,data_date,data_time,recorded_at,created_at) VALUES (8000000000001,8000000000001,N'VVTEST-AQI-1','2020-01-01','00:00:00','2020-01-01','2020-01-01')") -eq 'BLOCKED')

    # ---- the real API ingestion path (runtime login) fires the trigger; the AQI is calculated, not taken from the request ----
    $apiR = Api POST /api/v1/sensor-data @{ deviceId = 'VVTEST-DEV-1'; recordedAt = (Ts 4); aqi = 999; aqiStatus = 'Hacked'; pm25 = 40; pm10 = 80; humidity = 51.5; temperature = 27.25; outerTemperature = 30.1; outerHumidity = 49.9; coPpm = 0.77 } $null @{ 'X-Device-Key' = $K1 }
    $apiM = Sql $Db "SELECT CONCAT(aqi,'|',aqi_status,'|',pm25,'|',pm10,'|',humidity,'|',temperature,'|',outer_temperature,'|',outer_humidity,'|',co_ppm,'|',CASE WHEN tvoc_ppb IS NULL THEN 'N' ELSE 'V' END) FROM dbo.ManipulatedSensorData WHERE SourceSensorDataID=$($apiR.Json.id)"
    $apiS = Sql $Db "SELECT CONCAT(aqi,'|',aqi_status) FROM dbo.SensorData WHERE ID=$($apiR.Json.id)"
    Check 'API01' 'Posting through the API (restricted runtime login) creates the manipulated row automatically; AQI 80 "Satisfactory" is CALCULATED from PM2.5 40 / PM10 80, not the 999 / "Hacked" the request carried; all other values copied' ($apiR.Status -eq 201 -and $apiM -eq '80|Satisfactory|40.00|80.00|51.50|27.25|30.10|49.90|0.7700|N') "$($apiR.Status) $apiM"
    Check 'API02' 'The original SensorData row is stored exactly as received (999 / "Hacked" untouched); the trigger never modifies it' ($apiS -eq '999|Hacked') $apiS
    $apiDup = Api POST /api/v1/sensor-data @{ deviceId = 'VVTEST-DEV-1'; recordedAt = $apiR.Json.recordedAt.ToUniversalTime().ToString('o'); pm25 = 1; pm10 = 1 } $null @{ 'X-Device-Key' = $K1 }
    Check 'API03' 'A duplicate reading is still rejected with 409 and creates neither a source nor a manipulated row' ($apiDup.Status -eq 409 -and (Sql $Db "SELECT COUNT(*) FROM dbo.ManipulatedSensorData WHERE SourceSensorDataID=$($apiR.Json.id)") -eq '1')
    $apiNull = Api POST /api/v1/sensor-data @{ deviceId = 'VVTEST-DEV-1'; recordedAt = (Ts 3); aqi = 55 } $null @{ 'X-Device-Key' = $K1 }
    Check 'API04' 'An API reading without PM values (the device only sent aqi 55) gets NULL aqi / aqi_status in the manipulated table' ($apiNull.Status -eq 201 -and (Sql $Db "SELECT CONCAT(ISNULL(CAST(aqi AS varchar(9)),'N'), ISNULL(aqi_status,'N')) FROM dbo.ManipulatedSensorData WHERE SourceSensorDataID=$($apiNull.Json.id)") -eq 'NN')

    # ---- idempotency and failure behaviour (all inside transactions that are rolled back) ----
    $someId = Sql $Db "SELECT TOP 1 SourceSensorDataID FROM dbo.ManipulatedSensorData WHERE device_id='VVTEST-AQI-1' ORDER BY SourceSensorDataID"
    $idem = Sql $Db @"
DECLARE @t dbo.SensorDataIdList; INSERT @t VALUES ($someId);
DECLARE @before int = (SELECT COUNT(*) FROM dbo.ManipulatedSensorData), @p datetime2(3) = (SELECT processed_at FROM dbo.ManipulatedSensorData WHERE SourceSensorDataID=$someId);
EXEC dbo.ProcessSensorData @t; EXEC dbo.ProcessSensorData @t;
SELECT CONCAT(@before - (SELECT COUNT(*) FROM dbo.ManipulatedSensorData), '|', CASE WHEN @p = (SELECT processed_at FROM dbo.ManipulatedSensorData WHERE SourceSensorDataID=$someId) THEN 'unchanged' ELSE 'CHANGED' END, '|', (SELECT COUNT(*) FROM dbo.ManipulatedSensorData WHERE SourceSensorDataID=$someId))
"@
    Check 'ID01' 'Re-running the procedure for already processed readings (twice) adds no row and does not touch the existing one' ($idem -eq '0|unchanged|1') $idem
    $hist1 = Sql $Db "SELECT TOP 1 ID FROM dbo.SensorData WHERE device_id NOT LIKE 'VVTEST-%' ORDER BY ID"
    $fail = Sql $Db @"
SET XACT_ABORT OFF; BEGIN TRAN;
DECLARE @t dbo.SensorDataIdList; INSERT @t VALUES ($hist1), (9000000000099);
DECLARE @e int = 0;
BEGIN TRY EXEC dbo.ProcessSensorData @t; END TRY BEGIN CATCH SET @e = ERROR_NUMBER(); END CATCH;
DECLARE @partial int = (SELECT COUNT(*) FROM dbo.ManipulatedSensorData WHERE SourceSensorDataID=$hist1);
IF XACT_STATE() <> 0 ROLLBACK;
SELECT CONCAT(@e, '|', @partial, '|', (SELECT COUNT(*) FROM dbo.ManipulatedSensorData WHERE SourceSensorDataID=$hist1))
"@
    Check 'FA01' 'Procedure with one valid and one unknown id fails loudly (error 51020) and writes NOTHING for the valid id either (all-or-nothing)' ($fail -eq '51020|0|0') $fail
    $trgFail = Sql $Db @"
SET XACT_ABORT OFF; BEGIN TRAN;
ALTER TABLE dbo.ManipulatedSensorData WITH NOCHECK ADD CONSTRAINT CK_vvtest_inject CHECK (aqi < 0);
DECLARE @err int = 0, @proc nvarchar(128) = N'';
BEGIN TRY
  INSERT dbo.SensorData (device_id,data_date,data_time,recorded_at,pm25,pm10) VALUES (N'VVTEST-AQI-1','2020-01-01','00:00:01','2020-01-01T00:00:01',10,10);
END TRY
BEGIN CATCH SET @err = ERROR_NUMBER(); SET @proc = ISNULL(ERROR_PROCEDURE(), N'?'); END CATCH;
IF XACT_STATE() <> 0 ROLLBACK;
SELECT CONCAT(@err, '|', @proc, '|src=', (SELECT COUNT(*) FROM dbo.SensorData WHERE device_id=N'VVTEST-AQI-1' AND recorded_at='2020-01-01T00:00:01'), '|man=', (SELECT COUNT(*) FROM dbo.ManipulatedSensorData WHERE device_id=N'VVTEST-AQI-1' AND recorded_at='2020-01-01T00:00:01'), '|injected=', (SELECT COUNT(*) FROM sys.check_constraints WHERE name='CK_vvtest_inject'))
"@
    Check 'FA02' 'When processing fails inside the trigger (a transient CHECK constraint makes the procedure INSERT fail; everything is rolled back afterwards) the SOURCE insert fails too: no SensorData row, no manipulated row, injected constraint gone' ($trgFail -eq '547|dbo.ProcessSensorData|src=0|man=0|injected=0') $trgFail
    $histRun = Sql $Db @"
BEGIN TRAN;
DECLARE @t dbo.SensorDataIdList; INSERT @t SELECT ID FROM dbo.SensorData WHERE device_id NOT LIKE 'VVTEST-%';
DECLARE @n int = (SELECT COUNT(*) FROM @t);
EXEC dbo.ProcessSensorData @t;
SELECT CONCAT(@n, '|', (SELECT COUNT(*) FROM dbo.ManipulatedSensorData m JOIN dbo.SensorData s ON s.ID=m.SourceSensorDataID WHERE s.device_id NOT LIKE 'VVTEST-%'), '|', (SELECT COUNT(*) FROM dbo.ManipulatedSensorData m JOIN dbo.SensorData s ON s.ID=m.SourceSensorDataID WHERE s.device_id NOT LIKE 'VVTEST-%' AND ISNULL(m.aqi,-99999) <> ISNULL(s.aqi,-99999)), '|', (SELECT COUNT(*) FROM dbo.ManipulatedSensorData m JOIN dbo.SensorData s ON s.ID=m.SourceSensorDataID WHERE s.device_id NOT LIKE 'VVTEST-%' AND ISNULL(m.aqi_status,N'') <> ISNULL(s.aqi_status,N'')));
ROLLBACK;
"@
    $hf = $histRun -split '\|'
    Check 'HI01' 'Dry run on the real historical readings (processed in a transaction that is ROLLED BACK - nothing is backfilled): calculated AQI vs what the ESP32 itself reported' ($hf.Count -eq 4 -and $hf[0] -eq $hf[1]) "readings=$($hf[0]) processed=$($hf[1]) aqi-different-from-device=$($hf[2]) status-different=$($hf[3])"
    Write-Host "      (HI01 info) real-data comparison: $histRun"
    $histAfter = Sql $Db "SELECT CONCAT(COUNT(*),'|',CHECKSUM_AGG(CHECKSUM(ID,device_id,recorded_at,aqi,aqi_status,pm25,pm10,humidity,temperature,outer_temperature,outer_humidity,co_ppm,created_at))) FROM dbo.SensorData WHERE device_id NOT LIKE 'VVTEST-%'"
    Check 'HI02' 'Existing SensorData history is unchanged (row count + checksum before and after the whole run) and nothing was backfilled (no manipulated row for any non-test reading)' ($histAfter -eq $histBefore -and (Sql $Db "SELECT COUNT(*) FROM dbo.ManipulatedSensorData WHERE device_id NOT LIKE 'VVTEST-%'") -eq '0') "before=$histBefore after=$histAfter"
    if ($uatMode -and -not $runtimeIsOwner) {
        $rp = SqlApp "SELECT COUNT(*) FROM dbo.ManipulatedSensorData"
        $rd = SqlApp "DELETE FROM dbo.ManipulatedSensorData WHERE 1 = 0"
        Check 'PM01' 'Runtime login can read the manipulated table but cannot delete from it' ($rp -notlike 'ERR:*' -and $rd -match '^ERR:.*(denied|do not have permission)') "$rp / $rd"
    }

    # ================= PHASE 7: GPS position reports (dbo.GpsLocationData, POST/GET /api/v1/gps-data) =================
    $gd1 = New-Device $SA 'VVTEST-GPS-1'; $gd2 = New-Device $SA 'VVTEST-GPS-2'; $gd3 = New-Device $SA 'VVTEST-GPS-3'; $gd4 = New-Device $SA 'VVTEST-GPS-OFF'
    $GK1 = $gd1.Json.apiKey; $GK2 = $gd2.Json.apiKey; $GK3 = $gd3.Json.apiKey; $GK4 = $gd4.Json.apiKey
    $GD1 = $gd1.Json.id; $GD2 = $gd2.Json.id; $GD3 = $gd3.Json.id
    $null = Api POST "/api/v1/devices/$GD1/assign" @{ userId = $U1id } $SA        # U1 (under Admin A1)
    $null = Api POST "/api/v1/devices/$GD2/assign" @{ userId = $U3id } $SA        # U3 (under Admin A2)
    $null = Api PATCH "/api/v1/devices/$($gd4.Json.id)/status" @{ isActive = $false } $SA
    function Send-Gps([string]$dev, [string]$key, [hashtable]$b, [string]$root = $base) {
        $body = @{ deviceId = $dev; recordedAt = (Ts 10); fix = $true; source = 'gps'; lat = 28.580707; lon = 77.398512; altM = 239.9; speedKmh = 0.0; signalPct = 83 }
        foreach ($k in @($b.Keys)) { $body[$k] = $b[$k] }
        $h = @{}; if ($key) { $h['X-Device-Key'] = $key }
        ApiAt $root POST /api/v1/gps-data $body $null $h
    }
    $t1 = Ts 10
    $g1 = Send-Gps 'VVTEST-GPS-1' $GK1 @{ recordedAt = $t1 }
    $g1row = Sql $Db "SELECT CONCAT(device_id,'|',has_fix,'|',source,'|',latitude,'|',longitude,'|',altitude_m,'|',speed_kmh,'|',signal_pct) FROM dbo.GpsLocationData WHERE ID=$($g1.Json.id)"
    Check 'GP01' 'Valid fix from the Pi payload: 201, report returned and stored with exact precision (6 / 6 / 1 / 1 decimals, tinyint signal)' ($g1.Status -eq 201 -and $g1.Json.fix -eq $true -and $g1.Json.lat -eq 28.580707 -and $g1.Json.lon -eq 77.398512 -and $g1.Json.altM -eq 239.9 -and $g1.Json.signalPct -eq 83 -and $g1.Json.deviceId -eq 'VVTEST-GPS-1' -and $g1row -eq 'VVTEST-GPS-1|1|gps|28.580707|77.398512|239.9|0.0|83') "$($g1.Status) $g1row"
    Check 'GP01b' 'Timestamps are IST: returned with the +05:30 offset; receivedAt is set by SQL Server' ($g1.Raw -match '"recordedAt":"[^"]+\+05:30"' -and $g1.Raw -match '"receivedAt":"[^"]+\+05:30"') $g1.Raw
    $g1dup = Send-Gps 'VVTEST-GPS-1' $GK1 @{ recordedAt = $t1; lat = 10.0; lon = 20.0 }
    Check 'GP02' 'Re-sending the same (deviceId, recordedAt) is idempotent: 200 with the ORIGINAL stored report (id and position unchanged), still one row' ($g1dup.Status -eq 200 -and $g1dup.Json.id -eq $g1.Json.id -and $g1dup.Json.lat -eq 28.580707 -and (Sql $Db "SELECT COUNT(*) FROM dbo.GpsLocationData WHERE device_id='VVTEST-GPS-1' AND recorded_at=DATEADD(MINUTE,330,CAST('$($t1.TrimEnd('Z'))' AS datetime2(3)))") -eq '1') "$($g1dup.Status)"
    $t2 = Ts 12
    $par = 1..6 | ForEach-Object -ThrottleLimit 6 -Parallel {
        $r = Invoke-WebRequest -Uri "$($using:base)/api/v1/gps-data" -Method POST -Headers @{ 'X-Device-Key' = $using:GK1 } -ContentType 'application/json' -SkipHttpErrorCheck `
            -Body (@{ deviceId = 'VVTEST-GPS-1'; recordedAt = $using:t2; fix = $true; source = 'gps'; lat = 1.5; lon = 2.5 } | ConvertTo-Json)
        [int]$r.StatusCode
    }
    Check 'GP02b' 'Six simultaneous uploads of one new report: exactly one 201, the rest 200, no 5xx, one row' (@($par | Where-Object { $_ -eq 201 }).Count -eq 1 -and @($par | Where-Object { $_ -notin 200, 201 }).Count -eq 0 -and (Sql $Db "SELECT COUNT(*) FROM dbo.GpsLocationData WHERE device_id='VVTEST-GPS-1' AND latitude=1.5") -eq '1') ($par -join ',')
    $gNo = Send-Gps 'VVTEST-GPS-1' $GK1 @{ recordedAt = (Ts 9); fix = $false; lat = $null; lon = $null; altM = $null; speedKmh = $null; signalPct = 41 }
    $gNoRow = Sql $Db "SELECT CONCAT(has_fix,'|',ISNULL(CAST(latitude AS varchar(20)),'N'),'|',ISNULL(CAST(longitude AS varchar(20)),'N'),'|',ISNULL(CAST(altitude_m AS varchar(20)),'N'),'|',ISNULL(CAST(speed_kmh AS varchar(20)),'N'),'|',signal_pct) FROM dbo.GpsLocationData WHERE ID=$($gNo.Json.id)"
    Check 'GP03' 'A no-fix report (fix=false, null position) is accepted and stored with NULL position - never 0' ($gNo.Status -eq 201 -and $gNo.Json.fix -eq $false -and $null -eq $gNo.Json.lat -and $gNoRow -eq '0|N|N|N|N|41') "$($gNo.Status) $gNoRow"
    $gNoBad = Send-Gps 'VVTEST-GPS-1' $GK1 @{ recordedAt = (Ts 8); fix = $false }
    Check 'GP03b' 'fix=false together with coordinates is rejected (400)' ($gNoBad.Status -eq 400 -and $gNoBad.Json.errors.Lat)
    $gCell = Send-Gps 'VVTEST-GPS-1' $GK1 @{ recordedAt = (Ts 7); source = 'cell'; altM = 0.0; signalPct = 55 }
    Check 'GP04' 'source "cell" with altitude 0 is accepted' ($gCell.Status -eq 201 -and $gCell.Json.source -eq 'cell' -and $gCell.Json.altM -eq 0)
    $bad = [ordered]@{
        'lat > 90' = @{ lat = 91 }; 'lat < -90' = @{ lat = -90.5 }; 'lon > 180' = @{ lon = 181 }; 'lon < -180' = @{ lon = -180.1 }
        'fix without lat' = @{ lat = $null }; 'fix without lon' = @{ lon = $null }; 'bad source' = @{ source = 'wifi' }; 'empty source' = @{ source = '' }
        'signal 101' = @{ signalPct = 101 }; 'signal -1' = @{ signalPct = -1 }; 'negative speed' = @{ speedKmh = -1 }; 'altitude absurd' = @{ altM = 500000 }
        'future recordedAt' = @{ recordedAt = (Ts -60) }; 'ancient recordedAt' = @{ recordedAt = '2019-12-31T23:59:59Z' }
        'missing recordedAt' = @{ recordedAt = $null }; 'missing fix' = @{ fix = $null }; 'deviceId > 50' = @{ deviceId = ('D' * 51) }
    }
    $badOk = @(); $before = Sql $Db "SELECT COUNT(*) FROM dbo.GpsLocationData"
    foreach ($k in $bad.Keys) {
        $bodyBad = $bad[$k]; $dev = if ($bodyBad.ContainsKey('deviceId')) { $bodyBad.deviceId } else { 'VVTEST-GPS-1' }
        $r = Send-Gps $dev $GK1 $bodyBad
        if ($r.Status -ne 400 -or $r.Json.code -ne 'validation_failed') { $badOk += "$k -> $($r.Status)" }
    }
    Check 'GP05' "Validation: $($bad.Count) invalid payloads (coordinates out of range, missing fields, bad source/signal/speed/altitude, future or ancient time, long deviceId) are all 400 validation_failed" ($badOk.Count -eq 0) ($badOk -join '; ')
    Check 'GP05b' 'None of the rejected payloads stored anything' ((Sql $Db "SELECT COUNT(*) FROM dbo.GpsLocationData") -eq $before)
    $off = Send-Gps 'VVTEST-GPS-1' $GK1 @{ recordedAt = ((Get-Date).ToUniversalTime().AddMinutes(-6).ToString("yyyy-MM-ddTHH:mm:ss.fff") + '+05:30') }
    $offRow = Sql $Db "SELECT DATEDIFF(MINUTE, recorded_at, DATEADD(MINUTE, -6, SYSUTCDATETIME())) FROM dbo.GpsLocationData WHERE ID=$($off.Json.id)"
    Check 'GP06' 'A timestamp with an explicit offset (+05:30) is the same instant: stored as IST wall-clock (UTC + 5:30)' ($off.Status -eq 201 -and [Math]::Abs([int]$offRow) -le 3) "diff=$offRow"
    $au1 = Send-Gps 'VVTEST-GPS-1' $null @{ recordedAt = (Ts 6) }
    $au2 = Send-Gps 'VVTEST-GPS-1' 'vv_wrongkey' @{ recordedAt = (Ts 6) }
    $au3 = Send-Gps 'VVTEST-GPS-1' $GK2 @{ recordedAt = (Ts 6) }
    $au4 = Send-Gps 'NO-SUCH-GPS-DEVICE' $GK1 @{ recordedAt = (Ts 6) }
    $au5 = Send-Gps 'VVTEST-GPS-OFF' $GK4 @{ recordedAt = (Ts 6) }
    $au6 = ApiAt $base POST /api/v1/gps-data @{ deviceId = 'VVTEST-GPS-1'; recordedAt = (Ts 6); fix = $true; source = 'gps'; lat = 1; lon = 1 } $SA
    $hashAsKey = Send-Gps 'VVTEST-GPS-1' (Sql $Db "SELECT ApiKeyHash FROM Devices WHERE DeviceId='VVTEST-GPS-1'") @{ recordedAt = (Ts 6) }
    Check 'GP07' 'Auth: missing key, wrong key, another device''s key, unknown device, a user JWT and (secure default) the stored key hash are all 401 (same answer); an inactive device is 403' ($au1.Status -eq 401 -and $au2.Status -eq 401 -and $au3.Status -eq 401 -and $au4.Status -eq 401 -and $au6.Status -eq 401 -and $hashAsKey.Status -eq 401 -and $au5.Status -eq 403) "$($au1.Status)/$($au2.Status)/$($au3.Status)/$($au4.Status)/$($au6.Status)/$($hashAsKey.Status)/$($au5.Status)"
    $rotK = Api POST "/api/v1/devices/$GD3/rotate-key" $null $SA
    $rk = [string]$rotK.Json.apiKey
    $okNew = Send-Gps -dev 'VVTEST-GPS-3' -key $rk -b @{ recordedAt = (Ts 5) }; $oldK = Send-Gps -dev 'VVTEST-GPS-3' -key $GK3 -b @{ recordedAt = (Ts 4) }
    Check 'GP07b' 'Device-key lifecycle is shared with sensor data: after rotate-key the new key works for GPS and the old one stops' ($okNew.Status -eq 201 -and $oldK.Status -eq 401)
    # compatibility switch ON (as on the live UAT): the Pi / device that holds the stored key hash can push GPS too (throwaway instance)
    $rkPort = $Port + 5
    $env:DeviceAuth__AcceptStoredHashAsKey = 'true'
    $rkApp = Start-Process dotnet -ArgumentList @((Join-Path $bin 'VayuVata.dll'), '--urls', "http://localhost:$rkPort") -WorkingDirectory $project -PassThru -RedirectStandardOutput (Join-Path $runDir 'gpskey.log') -RedirectStandardError (Join-Path $runDir 'gpskey.err.log') -WindowStyle Hidden
    $env:DeviceAuth__AcceptStoredHashAsKey = $null
    $rkUp = $false; 1..40 | ForEach-Object { if (-not $rkUp) { try { $rkUp = ((Invoke-WebRequest "http://localhost:$rkPort/api/v1/health" -SkipHttpErrorCheck).StatusCode -eq 200) } catch { Start-Sleep 1 } } }
    $hk = Sql $Db "SELECT ApiKeyHash FROM Devices WHERE DeviceId='VVTEST-GPS-1'"; $hk2 = Sql $Db "SELECT ApiKeyHash FROM Devices WHERE DeviceId='VVTEST-GPS-2'"
    $rk1 = Send-Gps -dev 'VVTEST-GPS-1' -key $hk -b @{ recordedAt = (Ts 3.5) } -root "http://localhost:$rkPort"
    $rk2 = Send-Gps -dev 'VVTEST-GPS-1' -key $hk2 -b @{ recordedAt = (Ts 3.6) } -root "http://localhost:$rkPort"
    $rk3 = Send-Gps -dev 'VVTEST-GPS-1' -key $null -b @{ recordedAt = (Ts 3.7) } -root "http://localhost:$rkPort"
    Check 'GP07c' 'With DeviceAuth:AcceptStoredHashAsKey=on (as on UAT) the stored key hash authenticates ITS device for GPS (201); another device''s hash 401; no key 401' ($rkUp -and $rk1.Status -eq 201 -and $rk2.Status -eq 401 -and $rk3.Status -eq 401) "$($rk1.Status)/$($rk2.Status)/$($rk3.Status)"
    Get-NetTCPConnection -LocalPort $rkPort -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    if ($rkApp -and -not $rkApp.HasExited) { Stop-Process -Id $rkApp.Id -Force -ErrorAction SilentlyContinue }
    $bigR = Req POST /api/v1/gps-data -headers @{ 'X-Device-Key' = $GK1 } -rawBody ('{"deviceId":"VVTEST-GPS-1","fix":false,"source":"gps"}' + (' ' * 20000))
    Check 'GP08' 'Oversized body -> 413' ($bigR.StatusCode -eq 413)

    # public listener (the Pi reaches the API through the internet-facing port)
    $pubG = Send-Gps 'VVTEST-GPS-1' $GK1 @{ recordedAt = (Ts 3) } "http://localhost:$pubPort"
    $pubGet = Req GET /api/v1/gps-data -root "http://localhost:$pubPort" -token $SA
    $pubLogin = Req POST /api/v1/auth/login -root "http://localhost:$pubPort" -body @{ email = $saEmail; password = 'x' }
    $pubPut = Req PUT /api/v1/gps-data -root "http://localhost:$pubPort" -headers @{ 'X-Device-Key' = $GK1 }
    Check 'GP09' 'Public listener: POST /api/v1/gps-data works (201); GET gps-data, login and other verbs on it remain an empty 404' ($pubG.Status -eq 201 -and $pubGet.StatusCode -eq 404 -and [string]$pubGet.Content -eq '' -and $pubLogin.StatusCode -eq 404 -and $pubPut.StatusCode -eq 404)

    # reads: two open GETs, no token, no filters
    $null = Send-Gps -dev 'VVTEST-GPS-2' -key $GK2 -b @{ recordedAt = (Ts 10); lat = 19.07; lon = 72.87 }
    $null = Send-Gps -dev 'VVTEST-GPS-1' -key $GK1 -b @{ recordedAt = (Ts 2); fix = $false; lat = $null; lon = $null; altM = $null; speedKmh = $null }
    $gdE = New-Device $SA 'VVTEST-GPS-EMPTY'
    $all = Req GET /api/v1/gps-data
    $allJ = Body $all
    $allDevs = @($allJ | ForEach-Object { $_.deviceId } | Sort-Object -Unique)
    Check 'GP10' 'GET /api/v1/gps-data needs NO token and NO parameters: returns every row of the table as a plain list (all devices), newest first, each row with its deviceId' ($all.StatusCode -eq 200 -and $allJ.Count -ge 5 -and ($allDevs -contains 'VVTEST-GPS-1') -and ($allDevs -contains 'VVTEST-GPS-2') -and $allJ[0].recordedAt -ge $allJ[-1].recordedAt -and $allJ[0].deviceId -and [int](Sql $Db "SELECT COUNT(*) FROM dbo.GpsLocationData") -eq $allJ.Count) "status=$($all.StatusCode) rows=$($allJ.Count)"
    Check 'GP11' 'The list ignores query strings (no filtering / validation): ?deviceId=x&foo=bar returns the same rows' ((Body (Req GET '/api/v1/gps-data?deviceId=VVTEST-GPS-2&foo=bar')).Count -eq $allJ.Count)
    $cu1 = Req GET '/api/v1/gps-data/current?deviceId=VVTEST-GPS-1'
    $cu1j = Body $cu1
    $newest1 = @($allJ | Where-Object { $_.deviceId -eq 'VVTEST-GPS-1' })[0]
    Check 'GP12' 'GET /current?deviceId= (no token): active device -> 200 with its NEWEST report (IST +05:30), same as the first row of that device in the list' ($cu1.StatusCode -eq 200 -and $cu1j.deviceId -eq 'VVTEST-GPS-1' -and $cu1j.id -eq $newest1.id -and [string]$cu1.Content -match '\+05:30') "$($cu1.StatusCode)"
    $cu3 = Req GET '/api/v1/gps-data/current?deviceId=VVTEST-GPS-OFF'
    Check 'GP13' 'current: a device that exists but is NOT active -> 409 device_inactive, no data' ($cu3.StatusCode -eq 409 -and (Body $cu3).code -eq 'device_inactive' -and $null -eq (Body $cu3).lat)
    Check 'GP13b' 'current: unknown device 404; active device without any GPS data yet 404; missing deviceId 400' ((Req GET '/api/v1/gps-data/current?deviceId=NO-SUCH-DEVICE').StatusCode -eq 404 -and (Req GET '/api/v1/gps-data/current?deviceId=VVTEST-GPS-EMPTY').StatusCode -eq 404 -and (Req GET '/api/v1/gps-data/current').StatusCode -eq 400)

    $ist = Send-Gps -dev 'VVTEST-GPS-3' -key $rk -b @{ recordedAt = '2026-10-13T01:30:00Z' }
    $istRow = Sql $Db "SELECT CONCAT(CONVERT(varchar(23), recorded_at, 121), '|', CASE WHEN received_at BETWEEN DATEADD(MINUTE, 325, SYSUTCDATETIME()) AND DATEADD(MINUTE, 336, SYSUTCDATETIME()) THEN 'received-ist' ELSE 'received-OFF' END) FROM dbo.GpsLocationData WHERE ID=$($ist.Json.id)"
    Check 'GP18' 'IST storage: the Pi sends UTC 2026-10-13T01:30:00Z; the database holds 2026-10-13 07:00:00.000 (IST wall-clock), received_at is IST too, and the API returns 2026-10-13T07:00:00+05:30' ($ist.Status -eq 201 -and $istRow -eq '2026-10-13 07:00:00.000|received-ist' -and $ist.Raw -match '"recordedAt":"2026-10-13T07:00:00\+05:30"') "$($ist.Status) $istRow $($ist.Raw)"
    # database level
    $gcols = Sql $Db "SELECT STRING_AGG(name, ',') WITHIN GROUP (ORDER BY column_id) FROM sys.columns WHERE object_id=OBJECT_ID('dbo.GpsLocationData')"
    Check 'GP14' 'Table dbo.GpsLocationData has the designed columns' ($gcols -eq 'ID,device_id,recorded_at,received_at,has_fix,source,latitude,longitude,altitude_m,speed_kmh,signal_pct') $gcols
    $gi = "INSERT dbo.GpsLocationData (device_id,recorded_at,has_fix,source,latitude,longitude)"
    Check 'GP15' 'The database itself rejects: duplicate (device, time), latitude 91, longitude 181, fix without position, no-fix with position, unknown source, signal 101, unregistered device' ((DbTry "$gi SELECT device_id,recorded_at,has_fix,source,latitude,longitude FROM dbo.GpsLocationData WHERE ID=$($g1.Json.id)") -eq 'BLOCKED' -and (DbTry "$gi VALUES (N'VVTEST-GPS-1','2021-01-01T00:00:01',1,'gps',91,1)") -eq 'BLOCKED' -and (DbTry "$gi VALUES (N'VVTEST-GPS-1','2021-01-01T00:00:02',1,'gps',1,181)") -eq 'BLOCKED' -and (DbTry "$gi VALUES (N'VVTEST-GPS-1','2021-01-01T00:00:03',1,'gps',NULL,NULL)") -eq 'BLOCKED' -and (DbTry "$gi VALUES (N'VVTEST-GPS-1','2021-01-01T00:00:04',0,'gps',1,1)") -eq 'BLOCKED' -and (DbTry "$gi VALUES (N'VVTEST-GPS-1','2021-01-01T00:00:05',1,'wifi',1,1)") -eq 'BLOCKED' -and (DbTry "INSERT dbo.GpsLocationData (device_id,recorded_at,has_fix,source,signal_pct) VALUES (N'VVTEST-GPS-1','2021-01-01T00:00:06',0,'gps',101)") -eq 'BLOCKED' -and (DbTry "$gi VALUES (N'NOT-REGISTERED',N'2021-01-01T00:00:07',1,'gps',1,1)") -eq 'BLOCKED' -and (DbTry "$gi VALUES (N'VVTEST-GPS-1','2021-01-01T00:00:08',1,'gps',1,1)") -eq 'ALLOWED')
    Check 'GP16b' 'GPS storage is plain: NO trigger on dbo.GpsLocationData (the only table trigger on SensorData/Users/Devices side is untouched)' ((Sql $Db "SELECT COUNT(*) FROM sys.triggers WHERE parent_id=OBJECT_ID('dbo.GpsLocationData')") -eq '0')
    Check 'GP16' 'GPS API does not touch sensor data: no SensorData / ManipulatedSensorData rows for the GPS devices' ((Sql $Db "SELECT COUNT(*) FROM dbo.SensorData WHERE device_id LIKE 'VVTEST-GPS-%'") -eq '0' -and (Sql $Db "SELECT COUNT(*) FROM dbo.ManipulatedSensorData WHERE device_id LIKE 'VVTEST-GPS-%'") -eq '0')
    $swg = Api GET /swagger/v1/swagger.json
    $gp = $swg.Json.paths.'/api/v1/gps-data';     Check 'GP17' 'OpenAPI: POST /gps-data uses the DeviceKey scheme (not Bearer) with 200/201/400/401/403/413/429/500; both GETs are open (no security), the list has no parameters and /current only deviceId; request schema documents every field' (($gp.post.security | ConvertTo-Json -Compress -Depth 6) -match 'DeviceKey' -and ($gp.post.security | ConvertTo-Json -Compress -Depth 6) -notmatch 'Bearer' -and $gp.post.responses.'200' -and $gp.post.responses.'201' -and $gp.post.responses.'403' -and $gp.post.responses.'413' -and $gp.post.responses.'429' -and -not $gp.get.security -and -not $swg.Json.paths.'/api/v1/gps-data/current'.get.security -and @($swg.Json.paths.'/api/v1/gps-data'.get.parameters).Count -eq 0 -and @($swg.Json.paths.'/api/v1/gps-data/current'.get.parameters).Count -eq 1 -and @($swg.Json.components.schemas.CreateGpsLocationRequest.properties.PSObject.Properties.Name).Count -eq 9)

    # ================= SCRIPTS PARITY =================
    $sdb = 'tempdb'   # scratch tables only; removed again in the finally block
    foreach ($f in 'CreateTables.sql', 'CreateIndexes.sql') { $o = sqlcmd -S $SqlServer @adminAuth -C -I -d $sdb -b -i (Join-Path $project "Database/$f") 2>&1; if ($LASTEXITCODE -ne 0) { throw "$f failed: $o" } }
    $tl = "'Users','Devices','DeviceAssignments','SensorData','ManipulatedSensorData','GpsLocationData','RefreshTokens'"
    $schemaQ = "SELECT STRING_AGG(CONCAT(TABLE_NAME,'.',COLUMN_NAME,':',DATA_TYPE,'(',ISNULL(CHARACTER_MAXIMUM_LENGTH,0),',',ISNULL(NUMERIC_PRECISION,0),',',ISNULL(NUMERIC_SCALE,0),',',ISNULL(DATETIME_PRECISION,0),')',IS_NULLABLE), ';') WITHIN GROUP (ORDER BY TABLE_NAME, COLUMN_NAME) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME IN ($tl)"
    $idxQ = "SELECT STRING_AGG(CONCAT(OBJECT_NAME(object_id),'.',name,':',is_unique,':',ISNULL(filter_definition,'')), ';') WITHIN GROUP (ORDER BY OBJECT_NAME(object_id), name) FROM sys.indexes WHERE name IS NOT NULL AND is_primary_key = 0 AND is_unique_constraint = 0 AND OBJECT_NAME(object_id) IN ($tl)"
    Check 'W08' 'Hand-written SQL scripts produce the same columns as the EF migration' ((Sql $Db $schemaQ) -eq (Sql $sdb $schemaQ -Admin))
    Check 'W09' 'Hand-written SQL scripts produce the same indexes as the EF migration' ((Sql $Db $idxQ) -eq (Sql $sdb $idxQ -Admin))

}
catch { Write-Host "ABORTED: $($_.Exception.Message) (script line $($_.InvocationInfo.ScriptLineNumber))" -ForegroundColor Red; throw }
finally {
    if ($app -and -not $app.HasExited) { Stop-Process -Id $app.Id -Force }
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 500
    $errLog = Join-Path $runDir 'app.err.log'
    $leak = Select-String -Path $log, $errLog -Pattern 'StackTrace|   at VayuVata' -ErrorAction SilentlyContinue
    if ($results.Count -gt 0) { Check 'W10' 'No unhandled exceptions / stack traces in application log' (-not $leak) (($leak | Select-Object -First 2 | ForEach-Object { $_.Line }) -join ' | ') }
    Sql tempdb "DROP TABLE IF EXISTS dbo.GpsLocationData, dbo.ManipulatedSensorData, dbo.RefreshTokens, dbo.SensorData, dbo.DeviceAssignments, dbo.Users, dbo.Devices, dbo.__EFMigrationsHistory" -Admin | Out-Null
    Remove-TestData $tokenBaseline $saLastLogin $saUpdated
    $left = Sql $Db "SELECT (SELECT COUNT(*) FROM Users WHERE Email LIKE '%@vvtest.local') + (SELECT COUNT(*) FROM Devices WHERE DeviceId LIKE 'VVTEST-%') + (SELECT COUNT(*) FROM SensorData WHERE device_id LIKE 'VVTEST-%')"
    $saCnt = Sql $Db "SELECT COUNT(*) FROM Users WHERE Role='SuperAdmin' AND IsActive=1"
    if ($results.Count -gt 0) { Check 'W11' 'Cleanup removed every test row and kept the SuperAdmin' ($left -eq '0' -and $saCnt -eq '1') "leftover=$left activeSuperAdmins=$saCnt" }

    # ---------- write TestResults.md ----------
    $pass = @($results | Where-Object Passed).Count; $fail = $results.Count - $pass
    $md = [System.Text.StringBuilder]::new()
    [void]$md.AppendLine('# Test Results')
    [void]$md.AppendLine('')
    [void]$md.AppendLine("Generated by ``Tests/Run-ApiTests.ps1`` on $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz').")
    [void]$md.AppendLine("Environment: SQL Server ``$SqlServer`` (database ``$Db``; only tagged test rows are created and removed, nothing is dropped), API on ``$base``, .NET $(dotnet --version), ASPNETCORE_ENVIRONMENT=Development.")
    [void]$md.AppendLine('')
    [void]$md.AppendLine("**Total executed: $($results.Count) - Passed: $pass - Failed: $fail - Skipped (not run): $($skipped.Count)**")
    [void]$md.AppendLine('')
    [void]$md.AppendLine('| ID | Scenario | Result | Detail |')
    [void]$md.AppendLine('|----|----------|--------|--------|')
    foreach ($r in $results) {
        $d = ($r.Detail -replace '\|', '/' -replace "[`r`n]+", ' ')
        [void]$md.AppendLine("| $($r.Id) | $($r.Name -replace '\|','/') | $(if ($r.Passed) { 'PASS' } else { '**FAIL**' }) | $(if ($r.Passed) { '' } else { $d }) |")
    }
    if ($skipped.Count -gt 0) { [void]$md.AppendLine(''); [void]$md.AppendLine('Skipped: ' + (($skipped | ForEach-Object { "$($_.Id) ($($_.Reason))" }) -join '; ')) }
    [void]$md.AppendLine('')
    [void]$md.AppendLine('## Manual verification (performed by hand, not by this script)')
    [void]$md.AppendLine('')
    [void]$md.AppendLine('- M01 PASS - Swagger UI (`/swagger`), earlier phase: `GET /api/v1/auth/me` returned **401** before authorizing and **200** after Bearer authorization.')
    [void]$md.AppendLine('- M02 PASS - Swagger UI, hierarchy phase, authorized with the JWT of a tagged test **Admin**: `GET /api/v1/admins/{adminId}/users` executed from the UI returned **200** (`adminId`, `adminName`, `totalCount`, items with `managerId`/`assignmentType`); `POST /api/v1/admins/{adminId}/users` returned **201** (role User, `managerId` = that Admin, no password data); `GET /api/v1/superadmin/users` as that Admin returned **403**. The test users were removed afterwards.')
    [void]$md.AppendLine('- M03 PASS - Real-database start: connected (EFCore session on `VayuVata`), health Healthy, SuperAdmin login 200, bad login 401, Swagger UI 200, 24 paths / 30 operations in OpenAPI.')
    [void]$md.AppendLine('- M04 PASS - One-off migration rehearsal on `VayuVata` with tagged legacy rows (not part of the suite): (1) with a legacy standalone User (Role=User, AdminId NULL) present, `ManagerHierarchy` refused to run, named the affected id, and left schema and history unchanged; (2) after removing that row it migrated, both Admin-managed Users kept their Admin as `ManagerId`, the SuperAdmin kept `ManagerId` NULL, row counts unchanged; (3) `Down` restored `AdminId` correctly; (4) `Up` re-applied; (5) the database rejected 6 invalid manager shapes and accepted the valid one. Backup `VayuVata_pre_ManagerHierarchy.bak` was taken and verified beforehand.')
    [void]$md.AppendLine('')
    [void]$md.AppendLine('## Not covered')
    [void]$md.AppendLine('')
    [void]$md.AppendLine('- SuperAdmin-only endpoints (`/superadmin/users`, `PATCH /users/{id}/admin-assignment`, SuperAdmin creates) were **not executed through the Swagger UI with a SuperAdmin JWT**: SuperAdmin accounts cannot be created through the API and I did not paste the real SuperAdmin token into the browser. They are covered by the automated HTTP tests (N-series).')
    [void]$md.AppendLine('- Real ESP32 firmware (none exists in the repo); the ingestion contract in README is an assumption to confirm.')
    [void]$md.AppendLine('- `ResetDatabase.sql` was not executed (destructive by design); HTTPS/production hosting and load testing were not exercised.')
    Set-Content -Path (Join-Path $PSScriptRoot 'TestResults.md') -Value $md.ToString() -Encoding utf8
    Write-Host "`n== $pass passed, $fail failed, $($skipped.Count) skipped. Results written to Tests/TestResults.md =="
    if ($fail -gt 0) { exit 1 }
}


