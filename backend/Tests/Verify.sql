-- Read-only SQL verification queries. Run against a test or dev database:
--   sqlcmd -S localhost -E -C -I -d VayuVata -i Tests/Verify.sql

PRINT '1. Devices with more than one ACTIVE assignment (must return 0 rows)';
SELECT DeviceRecordId, COUNT(*) AS ActiveCount FROM dbo.DeviceAssignments
WHERE IsActive = 1 GROUP BY DeviceRecordId HAVING COUNT(*) > 1;

PRINT '2. Assignment history preserved: closed assignments per device';
SELECT DeviceRecordId, COUNT(*) AS Total, SUM(CAST(IsActive AS int)) AS Active FROM dbo.DeviceAssignments GROUP BY DeviceRecordId;

PRINT '3. Sensor rows whose device is not registered (must return 0 rows)';
SELECT s.ID FROM dbo.SensorData s LEFT JOIN dbo.Devices d ON d.DeviceId = s.device_id WHERE d.Id IS NULL;

PRINT '4. data_date/data_time consistent with recorded_at (must return 0 rows)';
SELECT ID FROM dbo.SensorData WHERE data_date <> CAST(recorded_at AS date) OR data_time <> CAST(recorded_at AS time(3));

PRINT '5. Users violating the manager rules (must return 0 rows)';
SELECT Id, Role, ManagerId FROM dbo.Users WHERE (Role <> 'User' AND ManagerId IS NOT NULL) OR (Role = 'User' AND ManagerId IS NULL);
SELECT u.Id FROM dbo.Users u LEFT JOIN dbo.Users m ON m.Id = u.ManagerId WHERE u.Role = 'User' AND (m.Id IS NULL OR m.Role NOT IN ('Admin','SuperAdmin'));

PRINT '5b. Standalone Users (managed by a SuperAdmin) vs Admin-managed Users';
SELECT m.Role AS ManagerRole, COUNT(*) AS Users FROM dbo.Users u JOIN dbo.Users m ON m.Id = u.ManagerId WHERE u.Role = 'User' GROUP BY m.Role;

PRINT '6. At least one active SuperAdmin exists';
SELECT COUNT(*) AS ActiveSuperAdmins FROM dbo.Users WHERE Role = 'SuperAdmin' AND IsActive = 1;

PRINT '7. No plain-text passwords (bcrypt hashes start with $2) - must return 0 rows';
SELECT Id FROM dbo.Users WHERE PasswordHash NOT LIKE '$2%';

PRINT '8. Raw secrets are not stored: hashes are 64 hex chars (must return 0 rows)';
SELECT Id FROM dbo.Devices WHERE ApiKeyHash IS NOT NULL AND LEN(ApiKeyHash) <> 64;
SELECT Id FROM dbo.RefreshTokens WHERE LEN(TokenHash) <> 64;

PRINT '9. Index check';
SELECT name, is_unique, filter_definition FROM sys.indexes
WHERE object_id IN (OBJECT_ID('dbo.DeviceAssignments'), OBJECT_ID('dbo.SensorData')) AND name IS NOT NULL;
