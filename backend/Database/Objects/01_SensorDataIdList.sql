-- Table type used to pass one or many dbo.SensorData IDs to dbo.ProcessSensorData (set-based, no cursor).
-- Types cannot be altered in place, so this is "create if missing" (safe to re-run).
IF TYPE_ID(N'dbo.SensorDataIdList') IS NULL
    CREATE TYPE dbo.SensorDataIdList AS TABLE (SensorDataID bigint NOT NULL PRIMARY KEY);
