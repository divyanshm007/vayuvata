-- Creates the first SuperAdmin only if none exists. Passwords are never stored in plain text:
-- supply a BCrypt hash (cost 11) generated with any bcrypt tool. The simpler route is to set the app's
-- Bootstrap__SuperAdminEmail / Bootstrap__SuperAdminPassword settings, which hash the password for you.
-- Usage:
--   sqlcmd -S localhost -E -C -d VayuVata -i SeedSuperAdmin.sql -v Email="you@example.com" Name="Super Admin" PasswordHash="<bcrypt hash>"
IF EXISTS (SELECT 1 FROM dbo.Users WHERE Role = 'SuperAdmin')
    PRINT 'A SuperAdmin already exists - nothing to do.';
ELSE
BEGIN
    INSERT INTO dbo.Users (Name, Email, PasswordHash, Role, IsActive)
    VALUES (N'$(Name)', LOWER(N'$(Email)'), N'$(PasswordHash)', 'SuperAdmin', 1);
    PRINT 'SuperAdmin created.';
END
GO
