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
  UAT mode (SQL Server reached through an SSH tunnel, SQL login instead of Windows auth). Credentials come ONLY from env vars:
    VV_SQL_USER / VV_SQL_PASSWORD        limited login with rights on the VayuVata database
    VV_SQL_ADMIN_USER / VV_SQL_ADMIN_PASSWORD   (optional) used only for the tempdb schema-parity scratch tables
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
$runDir = Join-Path $PSScriptRoot '.run'
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
$env:ConnectionStrings__Default = if ($uatMode) { "Server=$SqlServer;Database=$Db;User Id=$($env:VV_SQL_USER);Password=$($env:VV_SQL_PASSWORD);TrustServerCertificate=True;Encrypt=True;" } else { "Server=$SqlServer;Database=$Db;Trusted_Connection=True;TrustServerCertificate=True;" }
$env:PublicListener__Port = "$pubPort"
$env:RateLimiting__IngestPermitPerMinute = '100000'
$env:RateLimiting__LoginPermitLimit = '60'
$env:Database__ApplyMigrationsOnStartup = 'true'
$env:DeviceAuth__AllowMissingKeyInDevelopment = 'false'

function Remove-TestData([object]$tokenBaseline = $null, [string]$saLastLogin = $null, [string]$saUpdated = $null) {
    $tok = if ($null -ne $tokenBaseline) { "OR Id > $tokenBaseline" } else { '' }
    $restore = if ($saLastLogin) { "UPDATE Users SET LastLoginAt = $saLastLogin, UpdatedAt = $saUpdated WHERE Role = 'SuperAdmin';" } else { '' }
    Sql $Db @"
SET XACT_ABORT ON; BEGIN TRAN;
DECLARE @u TABLE (Id int PRIMARY KEY); INSERT @u SELECT Id FROM Users WHERE Email LIKE '%@vvtest.local';
DECLARE @d TABLE (Id int PRIMARY KEY, Code nvarchar(64)); INSERT @d SELECT Id, DeviceId FROM Devices WHERE DeviceId LIKE 'VVTEST-%';
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
function Ts([int]$minutesAgo) { (Get-Date).ToUniversalTime().AddMinutes(-$minutesAgo).ToString("yyyy-MM-ddTHH:mm:ss.fffZ") }
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
$saLastLogin = Sql $Db "SELECT ISNULL(CHAR(39) + CONVERT(varchar(23), LastLoginAt, 121) + CHAR(39), 'NULL') FROM Users WHERE Role='SuperAdmin'"
$saUpdated = Sql $Db "SELECT ISNULL(CHAR(39) + CONVERT(varchar(23), UpdatedAt, 121) + CHAR(39), 'NULL') FROM Users WHERE Role='SuperAdmin'"
Push-Location $project
$bin = Join-Path $runDir 'bin'
dotnet build -c Debug --nologo -v q -o $bin | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
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
    Check 'D06' "Admin cannot assign a device to another Admin's User (403)" ((Api POST "/api/v1/devices/$D5/assign" @{ userId = $U3id } $A1).Status -eq 403)
    Check 'D07' 'Admin cannot assign a device to a standalone User (403)' ((Api POST "/api/v1/devices/$D5/assign" @{ userId = $S1id } $A1).Status -eq 403)
    Check 'D08' 'Regular User cannot assign devices (403)' ((Api POST "/api/v1/devices/$D5/assign" @{ userId = $U1id } $U1).Status -eq 403)
    Check 'D09' "Admin cannot take a device assigned to another Admin's User (404)" ((Api POST "/api/v1/devices/$D3/assign" @{ userId = $U1id } $A1).Status -eq 404)
    Check 'D10' "Admin cannot see a device assigned outside their scope (404)" ((Api GET "/api/v1/devices/$D3" $null $A1).Status -eq 404 -and (Api GET "/api/v1/devices/$D4" $null $A1).Status -eq 404)
    $adm_assign = Api POST "/api/v1/devices/$D5/assign" @{ userId = $U2id } $A1
    Check 'D11' 'Admin assigns an unassigned device to their own User' ($adm_assign.Status -eq 200 -and $adm_assign.Json.assignedUserId -eq $U2id)
    $dl = Api GET '/api/v1/devices?pageSize=100' $null $A1
    $dev_ids = @($dl.Json.items | ForEach-Object { $_.deviceId })
    Check 'D12' 'Admin device list contains only scoped/unassigned devices' (($dev_ids -contains 'VVTEST-DEV-1') -and ($dev_ids -contains 'VVTEST-DEV-5') -and -not ($dev_ids -contains 'VVTEST-DEV-3') -and -not ($dev_ids -contains 'VVTEST-DEV-4')) ($dev_ids -join ',')
    $ul = Api GET '/api/v1/devices?pageSize=100' $null $U1
    Check 'D13' 'User device list contains only their own devices' ($ul.Json.totalCount -eq 2 -and (@($ul.Json.items | ForEach-Object { $_.deviceId }) -contains 'VVTEST-DEV-1'))
    $null = Api PATCH "/api/v1/devices/$D6/status" @{ isActive = $false } $SA
    Check 'D14' 'Inactive device cannot be assigned (409)' ((Api POST "/api/v1/devices/$D6/assign" @{ userId = $U1id } $SA).Status -eq 409)
    Check 'D15' 'Inactive target user cannot receive a device (409)' ((Api POST "/api/v1/devices/$D5/assign" @{ userId = $in.Json.id } $SA).Status -eq 409)
    Check 'D16' 'Devices cannot be assigned to an Admin account (400)' ((Api POST "/api/v1/devices/$D5/assign" @{ userId = $A1id } $SA).Status -eq 400)

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
    Check 'S21' 'created_at is server generated (UTC)' ((Sql $Db "SELECT COUNT(*) FROM SensorData WHERE device_id LIKE 'VVTEST-%' AND (created_at < DATEADD(minute,-5,SYSUTCDATETIME()) OR created_at > DATEADD(minute,5,SYSUTCDATETIME()))") -eq '0')
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
    Check 'E09b' 'Wrong-typed field returns 400 ApiError (not a raw ProblemDetails)' ($wt.Status -eq 400 -and $wt.Json.code -eq 'validation_failed' -and $null -eq $wt.Json.title) $wt.Raw
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
    Check 'W04b' 'OpenAPI documents exactly the 30 implemented operations' ($opCount -eq 30) "operations=$opCount"
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
    Check 'N21c' 'Admins cannot assign or unassign a device whose User is outside their scope (404/403)' ((Api POST "/api/v1/devices/$ND/assign" @{ userId = $U1id } $A1).Status -eq 404 -and (Api POST "/api/v1/devices/$ND/unassign" @{} $A1).Status -eq 404 -and (Api POST "/api/v1/devices/$ND/assign" @{ userId = $NUid } $A2).Status -eq 404)
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
    Check 'N25' 'Users schema: ManagerId present, AdminId gone, other columns preserved' ($cols -eq 'Id,Name,Email,PasswordHash,Role,IsActive,CreatedAt,UpdatedAt,LastLoginAt,ManagerId') $cols
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
    $rApp = Start-Process dotnet -ArgumentList @((Join-Path $bin 'VayuVata.dll'), '--urls', "http://localhost:$rPort") -WorkingDirectory $project -PassThru `
        -RedirectStandardOutput (Join-Path $runDir 'rate.log') -RedirectStandardError (Join-Path $runDir 'rate.err.log') -WindowStyle Hidden
    $env:RateLimiting__IngestPermitPerMinute = $saveLim
    $rUp = $false
    1..40 | ForEach-Object { if (-not $rUp) { try { $rUp = ((Invoke-WebRequest "http://localhost:$rPort/api/v1/health" -SkipHttpErrorCheck).StatusCode -eq 200) } catch { Start-Sleep 1 } } }
    $codes = 1..8 | ForEach-Object { (ApiAt "http://localhost:$rPort" POST /api/v1/sensor-data @{ deviceId = 'VVTEST-DEV-1'; aqi = 1 } $null @{ 'X-Device-Key' = 'wrong-key' }).Status }
    Check 'P07' 'Ingest endpoint is rate limited per client IP: with a limit of 3/min the first 3 requests reach the endpoint (401) and the rest get 429' ($rUp -and @($codes[0..2] | Where-Object { $_ -ne 401 }).Count -eq 0 -and @($codes[3..7] | Where-Object { $_ -ne 429 }).Count -eq 0) ($codes -join ',')
    Get-NetTCPConnection -LocalPort $rPort -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    if ($rApp -and -not $rApp.HasExited) { Stop-Process -Id $rApp.Id -Force -ErrorAction SilentlyContinue }

    # ================= SCRIPTS PARITY =================
    $sdb = 'tempdb'   # scratch tables only; removed again in the finally block
    foreach ($f in 'CreateTables.sql', 'CreateIndexes.sql') { $o = sqlcmd -S $SqlServer @adminAuth -C -I -d $sdb -b -i (Join-Path $project "Database/$f") 2>&1; if ($LASTEXITCODE -ne 0) { throw "$f failed: $o" } }
    $tl = "'Users','Devices','DeviceAssignments','SensorData','RefreshTokens'"
    $schemaQ = "SELECT STRING_AGG(CONCAT(TABLE_NAME,'.',COLUMN_NAME,':',DATA_TYPE,'(',ISNULL(CHARACTER_MAXIMUM_LENGTH,0),',',ISNULL(NUMERIC_PRECISION,0),',',ISNULL(NUMERIC_SCALE,0),',',ISNULL(DATETIME_PRECISION,0),')',IS_NULLABLE), ';') WITHIN GROUP (ORDER BY TABLE_NAME, COLUMN_NAME) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME IN ($tl)"
    $idxQ = "SELECT STRING_AGG(CONCAT(OBJECT_NAME(object_id),'.',name,':',is_unique,':',ISNULL(filter_definition,'')), ';') WITHIN GROUP (ORDER BY OBJECT_NAME(object_id), name) FROM sys.indexes WHERE name IS NOT NULL AND is_primary_key = 0 AND is_unique_constraint = 0 AND OBJECT_NAME(object_id) IN ($tl)"
    Check 'W08' 'Hand-written SQL scripts produce the same columns as the EF migration' ((Sql $Db $schemaQ) -eq (Sql $sdb $schemaQ -Admin))
    Check 'W09' 'Hand-written SQL scripts produce the same indexes as the EF migration' ((Sql $Db $idxQ) -eq (Sql $sdb $idxQ -Admin))

    # ================= RATE LIMIT (last: it locks the IP for a minute) =================
    $got429 = $false
    1..80 | ForEach-Object { if (-not $got429) { if ((Login 'user1@vvtest.local' 'bad-password-x').Status -eq 429) { $got429 = $true } } }
    Check 'A19' 'Login rate limiting returns 429 after repeated attempts' $got429
}
finally {
    if ($app -and -not $app.HasExited) { Stop-Process -Id $app.Id -Force }
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 500
    $errLog = Join-Path $runDir 'app.err.log'
    $leak = Select-String -Path $log, $errLog -Pattern 'StackTrace|   at VayuVata' -ErrorAction SilentlyContinue
    if ($results.Count -gt 0) { Check 'W10' 'No unhandled exceptions / stack traces in application log' (-not $leak) (($leak | Select-Object -First 2 | ForEach-Object { $_.Line }) -join ' | ') }
    Sql tempdb "DROP TABLE IF EXISTS dbo.RefreshTokens, dbo.SensorData, dbo.DeviceAssignments, dbo.Users, dbo.Devices, dbo.__EFMigrationsHistory" -Admin | Out-Null
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
    [void]$md.AppendLine("**Total: $($results.Count) - Passed: $pass - Failed: $fail**")
    [void]$md.AppendLine('')
    [void]$md.AppendLine('| ID | Scenario | Result | Detail |')
    [void]$md.AppendLine('|----|----------|--------|--------|')
    foreach ($r in $results) {
        $d = ($r.Detail -replace '\|', '/' -replace "[`r`n]+", ' ')
        [void]$md.AppendLine("| $($r.Id) | $($r.Name -replace '\|','/') | $(if ($r.Passed) { 'PASS' } else { '**FAIL**' }) | $(if ($r.Passed) { '' } else { $d }) |")
    }
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
    Write-Host "`n== $pass passed, $fail failed. Results written to Tests/TestResults.md =="
    if ($fail -gt 0) { exit 1 }
}


