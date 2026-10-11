-- Creates the VayuVata database if it does not exist. Non-destructive.
-- Usage: sqlcmd -S localhost -E -C -i CreateDatabase.sql
IF DB_ID(N'VayuVata') IS NULL
BEGIN
    CREATE DATABASE [VayuVata];
    PRINT 'Database VayuVata created.';
END
ELSE
    PRINT 'Database VayuVata already exists - nothing to do.';
GO
