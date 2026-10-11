-- DESTRUCTIVE. Drops the VayuVata database. It refuses to run unless
--   1. you pass Confirm=YES_DROP_VAYUVATA, and
--   2. it first takes a BACKUP ... WITH CHECKSUM to BackupPath and RESTORE VERIFYONLY succeeds.
-- Never run against production without a separately verified backup.
-- Usage:
--   sqlcmd -S localhost -E -C -i ResetDatabase.sql -v Confirm="YES_DROP_VAYUVATA" BackupPath="D:\Backups\VayuVata_pre_reset.bak"
:on error exit
IF N'$(Confirm)' <> N'YES_DROP_VAYUVATA'
    THROW 50000, 'Reset refused: pass Confirm=YES_DROP_VAYUVATA.', 1;
GO
IF DB_ID(N'VayuVata') IS NOT NULL
BEGIN
    BACKUP DATABASE [VayuVata] TO DISK = N'$(BackupPath)' WITH CHECKSUM, INIT, FORMAT;
    RESTORE VERIFYONLY FROM DISK = N'$(BackupPath)' WITH CHECKSUM;
    PRINT 'Backup verified at $(BackupPath).';
    ALTER DATABASE [VayuVata] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [VayuVata];
    PRINT 'VayuVata dropped. Re-run CreateDatabase.sql, CreateTables.sql, CreateIndexes.sql (or dotnet ef database update).';
END
ELSE
    PRINT 'VayuVata does not exist - nothing to drop.';
GO
