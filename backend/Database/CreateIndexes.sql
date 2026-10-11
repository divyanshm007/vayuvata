-- Run after CreateTables.sql.
CREATE UNIQUE INDEX IX_Users_Email ON dbo.Users (Email);
CREATE INDEX IX_Users_ManagerId ON dbo.Users (ManagerId);

CREATE UNIQUE INDEX IX_Devices_DeviceId ON dbo.Devices (DeviceId);

-- One ACTIVE assignment per device (filtered unique index) - also stops concurrent double-assignment.
CREATE UNIQUE INDEX UX_DeviceAssignments_ActiveDevice ON dbo.DeviceAssignments (DeviceRecordId) WHERE IsActive = 1;
CREATE INDEX IX_DeviceAssignments_UserId_IsActive ON dbo.DeviceAssignments (UserId, IsActive);
CREATE INDEX IX_DeviceAssignments_AssignedByUserId ON dbo.DeviceAssignments (AssignedByUserId);

CREATE INDEX IX_SensorData_device_id ON dbo.SensorData (device_id);
CREATE INDEX IX_SensorData_recorded_at ON dbo.SensorData (recorded_at);
-- Stable reading identity: duplicate (device, recorded_at) submissions are rejected.
CREATE UNIQUE INDEX UX_SensorData_device_recorded ON dbo.SensorData (device_id, recorded_at);

CREATE UNIQUE INDEX IX_RefreshTokens_TokenHash ON dbo.RefreshTokens (TokenHash);
CREATE INDEX IX_RefreshTokens_UserId ON dbo.RefreshTokens (UserId);
PRINT 'Indexes created.';
GO
