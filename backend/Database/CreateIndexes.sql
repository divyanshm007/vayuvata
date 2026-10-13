-- Run after CreateTables.sql.
CREATE UNIQUE INDEX IX_Users_Email ON dbo.Users (Email);
CREATE INDEX IX_Users_ManagerId ON dbo.Users (ManagerId);

-- Devices.DeviceId uniqueness is enforced by the unique constraint AK_Devices_DeviceId (created with the table); no second index.

-- One ACTIVE assignment per device (filtered unique index) - also stops concurrent double-assignment.
CREATE UNIQUE INDEX UX_DeviceAssignments_ActiveDevice ON dbo.DeviceAssignments (DeviceRecordId) WHERE IsActive = 1;
CREATE INDEX IX_DeviceAssignments_UserId_IsActive ON dbo.DeviceAssignments (UserId, IsActive);
CREATE INDEX IX_DeviceAssignments_AssignedByUserId ON dbo.DeviceAssignments (AssignedByUserId);

CREATE INDEX IX_SensorData_device_id ON dbo.SensorData (device_id);
CREATE INDEX IX_SensorData_recorded_at ON dbo.SensorData (recorded_at);
-- Stable reading identity: duplicate (device, recorded_at) submissions are rejected.
CREATE UNIQUE INDEX UX_SensorData_device_recorded ON dbo.SensorData (device_id, recorded_at);

CREATE UNIQUE INDEX IX_RefreshTokens_TokenHash ON dbo.RefreshTokens (TokenHash);
CREATE UNIQUE INDEX UX_ManipulatedSensorData_Source ON dbo.ManipulatedSensorData (SourceSensorDataID);
CREATE INDEX IX_ManipulatedSensorData_device_recorded ON dbo.ManipulatedSensorData (device_id, recorded_at);
CREATE UNIQUE INDEX UX_GpsLocationData_device_recorded ON dbo.GpsLocationData (device_id, recorded_at);
CREATE INDEX IX_RefreshTokens_UserId ON dbo.RefreshTokens (UserId);
CREATE INDEX IX_RefreshTokens_FamilyId ON dbo.RefreshTokens (FamilyId);
CREATE INDEX IX_RefreshTokens_ExpiresAt ON dbo.RefreshTokens (ExpiresAt);
PRINT 'Indexes created.';
GO
