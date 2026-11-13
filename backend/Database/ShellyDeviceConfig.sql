-- Shelly Device Configuration (daily schedule + SuperAdmin override). Additive only: adds columns, changes no data, touches no sensor table.
-- Same change as migration 20261112105249_ShellyDeviceConfiguration. Safe to run twice. Run with sqlcmd -I (filtered indexes exist on other tables).
IF COL_LENGTH('dbo.ShellyDevices', 'ScheduleEnabled') IS NULL
BEGIN
    ALTER TABLE dbo.ShellyDevices ADD
        ScheduleEnabled       bit          NOT NULL CONSTRAINT DF_ShellyDevices_ScheduleEnabled DEFAULT 0,
        DailyOnTime           time(0)      NULL,
        DailyOffTime          time(0)      NULL,
        OverrideActive        bit          NOT NULL CONSTRAINT DF_ShellyDevices_OverrideActive DEFAULT 0,
        OverrideSetAt         datetime2(3) NULL,
        OverrideSetByUserId   int          NULL,
        LastScheduleOnDate    date         NULL,
        LastScheduleOffDate   date         NULL,
        ConfigUpdatedAt       datetime2(3) NULL,
        ConfigUpdatedByUserId int          NULL;
END;
IF COL_LENGTH('dbo.ShellyCommands', 'Source') IS NULL
BEGIN
    ALTER TABLE dbo.ShellyCommands ADD Source varchar(12) NOT NULL CONSTRAINT DF_ShellyCommands_Source DEFAULT 'Manual';
    ALTER TABLE dbo.ShellyCommands ALTER COLUMN UserId int NULL;   -- the daily schedule has no user
END;
