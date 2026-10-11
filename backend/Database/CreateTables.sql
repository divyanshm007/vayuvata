-- Schema equivalent to EF migrations 20261010212021_InitialCreate + 20261010220738_ManagerHierarchy.
-- Use EITHER `dotnet ef database update` OR these scripts, not both on the same database.
-- Usage: sqlcmd -S localhost -E -C -d VayuVata -i CreateTables.sql  (then CreateIndexes.sql)
SET XACT_ABORT ON;
BEGIN TRAN;

CREATE TABLE dbo.Devices (
    Id           int IDENTITY(1,1) NOT NULL,
    DeviceId     nvarchar(64)  NOT NULL,           -- physical ESP32 identifier
    DeviceName   nvarchar(150) NOT NULL,
    Description  nvarchar(500) NULL,
    ApiKeyHash   nchar(64)     NULL,               -- SHA-256 hex of the device API key
    IsActive     bit           NOT NULL CONSTRAINT DF_Devices_IsActive DEFAULT 1,
    CreatedAt    datetime2(3)  NOT NULL CONSTRAINT DF_Devices_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt    datetime2(3)  NULL,
    CONSTRAINT PK_Devices PRIMARY KEY (Id),
    CONSTRAINT AK_Devices_DeviceId UNIQUE (DeviceId)
);

CREATE TABLE dbo.Users (
    Id            int IDENTITY(1,1) NOT NULL,
    Name          nvarchar(150) NOT NULL,
    Email         nvarchar(256) NOT NULL,
    PasswordHash  nvarchar(200) NOT NULL,
    Role          nvarchar(20)  NOT NULL,
    ManagerId     int           NULL,            -- NULL for SuperAdmin/Admin; Admin or SuperAdmin for a User
    IsActive      bit           NOT NULL CONSTRAINT DF_Users_IsActive DEFAULT 1,
    CreatedAt     datetime2(3)  NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt     datetime2(3)  NULL,
    LastLoginAt   datetime2(3)  NULL,
    CONSTRAINT PK_Users PRIMARY KEY (Id),
    CONSTRAINT CK_Users_Role CHECK (Role IN ('SuperAdmin','Admin','User')),
    CONSTRAINT CK_Users_Manager CHECK ((Role = 'User' AND ManagerId IS NOT NULL AND ManagerId <> Id) OR (Role IN ('SuperAdmin','Admin') AND ManagerId IS NULL)),
    CONSTRAINT FK_Users_Users_ManagerId FOREIGN KEY (ManagerId) REFERENCES dbo.Users (Id)
);

-- A User's manager must be an Admin or SuperAdmin (cross-row rule). Managers have ManagerId NULL, so cycles are impossible.
EXEC(N'
CREATE TRIGGER dbo.TR_Users_ManagerRules ON dbo.Users AFTER INSERT, UPDATE AS
BEGIN
    SET NOCOUNT ON;
    IF UPDATE(ManagerId) OR UPDATE(Role)
    BEGIN
        IF EXISTS (SELECT 1 FROM inserted i
                   WHERE i.Role = ''User''
                     AND NOT EXISTS (SELECT 1 FROM dbo.Users m WHERE m.Id = i.ManagerId AND m.Role IN (''Admin'', ''SuperAdmin'')))
            THROW 51010, ''A User must be managed by an Admin or the SuperAdmin.'', 1;
        IF EXISTS (SELECT 1 FROM inserted i JOIN dbo.Users u ON u.ManagerId = i.Id WHERE i.Role = ''User'')
            THROW 51011, ''An account that manages Users cannot be a regular User.'', 1;
    END
END');

CREATE TABLE dbo.DeviceAssignments (
    Id                int IDENTITY(1,1) NOT NULL,
    DeviceRecordId    int NOT NULL,
    UserId            int NOT NULL,
    AssignedByUserId  int NOT NULL,
    AssignedAt        datetime2(3) NOT NULL CONSTRAINT DF_DeviceAssignments_AssignedAt DEFAULT SYSUTCDATETIME(),
    UnassignedAt      datetime2(3) NULL,
    IsActive          bit NOT NULL,
    Notes             nvarchar(500) NULL,
    CONSTRAINT PK_DeviceAssignments PRIMARY KEY (Id),
    CONSTRAINT FK_DeviceAssignments_Devices_DeviceRecordId FOREIGN KEY (DeviceRecordId) REFERENCES dbo.Devices (Id),
    CONSTRAINT FK_DeviceAssignments_Users_UserId FOREIGN KEY (UserId) REFERENCES dbo.Users (Id),
    CONSTRAINT FK_DeviceAssignments_Users_AssignedByUserId FOREIGN KEY (AssignedByUserId) REFERENCES dbo.Users (Id)
);

CREATE TABLE dbo.SensorData (
    ID                 bigint IDENTITY(1,1) NOT NULL,
    device_id          nvarchar(64)  NOT NULL,
    data_date          date          NOT NULL,     -- UTC date of recorded_at
    data_time          time(3)       NOT NULL,     -- UTC time of recorded_at
    recorded_at        datetime2(3)  NOT NULL,     -- UTC
    aqi                int           NULL,
    aqi_status         nvarchar(32)  NULL,
    pm10               decimal(8,2)  NULL,
    pm25               decimal(8,2)  NULL,
    no2_ppm            decimal(10,4) NULL,
    so2_ppm            decimal(10,4) NULL,
    co_ppm             decimal(10,4) NULL,
    tvoc_ppb           decimal(10,2) NULL,
    humidity           decimal(5,2)  NULL,
    temperature        decimal(6,2)  NULL,
    outer_temperature  decimal(6,2)  NULL,
    outer_humidity     decimal(5,2)  NULL,
    created_at         datetime2(3)  NOT NULL CONSTRAINT DF_SensorData_created_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_SensorData PRIMARY KEY (ID),
    CONSTRAINT FK_SensorData_Devices_device_id FOREIGN KEY (device_id) REFERENCES dbo.Devices (DeviceId)
);

CREATE TABLE dbo.RefreshTokens (
    Id         int IDENTITY(1,1) NOT NULL,
    UserId     int NOT NULL,
    TokenHash  nchar(64) NOT NULL,                 -- SHA-256 hex, never the raw token
    CreatedAt  datetime2(3) NOT NULL,
    ExpiresAt  datetime2(3) NOT NULL,
    RevokedAt  datetime2(3) NULL,
    CONSTRAINT PK_RefreshTokens PRIMARY KEY (Id),
    CONSTRAINT FK_RefreshTokens_Users_UserId FOREIGN KEY (UserId) REFERENCES dbo.Users (Id)
);

-- Keep EF Core migrations consistent if the app later runs `database update`.
IF OBJECT_ID(N'dbo.__EFMigrationsHistory') IS NULL
    CREATE TABLE dbo.__EFMigrationsHistory (
        MigrationId nvarchar(150) NOT NULL, ProductVersion nvarchar(32) NOT NULL,
        CONSTRAINT PK___EFMigrationsHistory PRIMARY KEY (MigrationId));
INSERT INTO dbo.__EFMigrationsHistory (MigrationId, ProductVersion) VALUES (N'20261010212021_InitialCreate', N'10.0.12'), (N'20261010220738_ManagerHierarchy', N'10.0.12');

COMMIT;
PRINT 'Tables created.';
GO
