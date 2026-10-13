CREATE OR ALTER TRIGGER dbo.TR_SensorData_AfterInsert ON dbo.SensorData AFTER INSERT AS
/*
  Hands every newly inserted dbo.SensorData ID (single or multi-row insert) to dbo.ProcessSensorData. No calculation lives here.
  Fires for INSERT only, never writes to dbo.SensorData (no recursion), and runs inside the inserting transaction:
  if processing fails the error propagates (XACT_ABORT ON) and the source insert is rolled back with it.
*/
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;

    DECLARE @ids dbo.SensorDataIdList;
    INSERT @ids (SensorDataID) SELECT ID FROM inserted;
    EXEC dbo.ProcessSensorData @SensorDataIds = @ids;
END
