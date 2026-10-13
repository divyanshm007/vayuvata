CREATE OR ALTER PROCEDURE dbo.ProcessSensorData
    @SensorDataIds dbo.SensorDataIdList READONLY
AS
/*
  Copies the given dbo.SensorData readings into dbo.ManipulatedSensorData and CALCULATES aqi / aqi_status from pm25 and pm10.
  The aqi / aqi_status stored in dbo.SensorData (what the device reported) are deliberately NOT used.

  - Set based (one INSERT ... SELECT for all ids); no cursor, no per-row round trip.
  - Idempotent: a reading that already has a manipulated row is skipped (never duplicated, never updated).
  - Does not BEGIN / COMMIT / ROLLBACK anything: it runs inside the caller's transaction (the INSERT trigger's), so a failure
    here fails the caller's statement and the source insert is rolled back with it.
  - Never swallows errors: unknown ids raise error 51020 before anything is written.

  AQI = firmware calculateAQI_INDIA(): (int) truncation of pm25 / pm10, then Arduino map() per interval
        map(x, inMin, inMax, outMin, outMax) = (x - inMin) * (outMax - outMin) / (inMax - inMin) + outMin   (integer, truncating division, NO clamping),
        AQI = MAX(PM2.5 sub-index, PM10 sub-index). Values above the last breakpoint (500) are extrapolated exactly like the firmware.
  If pm25 OR pm10 is NULL the AQI cannot be calculated: aqi and aqi_status stay NULL (no value is invented).
  The firmware already applies its PM calibration (0.77 / 1.10) and moving average before upload, so nothing is re-applied here.
*/
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (SELECT 1 FROM @SensorDataIds i WHERE NOT EXISTS (SELECT 1 FROM dbo.SensorData s WHERE s.ID = i.SensorDataID))
    BEGIN
        DECLARE @missing nvarchar(max) = (
            SELECT STRING_AGG(CAST(x.SensorDataID AS nvarchar(20)), N',')
            FROM (SELECT TOP (20) i.SensorDataID FROM @SensorDataIds i
                  WHERE NOT EXISTS (SELECT 1 FROM dbo.SensorData s WHERE s.ID = i.SensorDataID)
                  ORDER BY i.SensorDataID) x);
        DECLARE @msg nvarchar(2048) = CONCAT(N'ProcessSensorData: unknown dbo.SensorData ID(s): ', @missing);
        THROW 51020, @msg, 1;
    END;

    INSERT dbo.ManipulatedSensorData
        (SourceSensorDataID, ID, device_id, data_date, data_time, recorded_at, aqi, aqi_status, pm10, pm25,
         no2_ppm, so2_ppm, co_ppm, tvoc_ppb, humidity, temperature, outer_temperature, outer_humidity, created_at)
    SELECT
        s.ID, s.ID, s.device_id, s.data_date, s.data_time, s.recorded_at, calc.aqi, st.aqi_status, s.pm10, s.pm25,
        s.no2_ppm, s.so2_ppm, s.co_ppm, s.tvoc_ppb, s.humidity, s.temperature, s.outer_temperature, s.outer_humidity, s.created_at
    FROM @SensorDataIds i
    JOIN dbo.SensorData s ON s.ID = i.SensorDataID
    CROSS APPLY (SELECT p25 = CAST(s.pm25 AS bigint), p10 = CAST(s.pm10 AS bigint)) pm      -- (int) cast: truncates toward zero, NULL stays NULL
    CROSS APPLY (SELECT
        a25 = CASE WHEN pm.p25 IS NULL THEN NULL
                   WHEN pm.p25 <= 30  THEN (pm.p25 - 0)   * 50 / 30  + 0
                   WHEN pm.p25 <= 60  THEN (pm.p25 - 31)  * 49 / 29  + 51
                   WHEN pm.p25 <= 90  THEN (pm.p25 - 61)  * 99 / 29  + 101
                   WHEN pm.p25 <= 120 THEN (pm.p25 - 91)  * 99 / 29  + 201
                   WHEN pm.p25 <= 250 THEN (pm.p25 - 121) * 99 / 129 + 301
                   ELSE                    (pm.p25 - 251) * 99 / 249 + 401 END,
        a10 = CASE WHEN pm.p10 IS NULL THEN NULL
                   WHEN pm.p10 <= 50  THEN (pm.p10 - 0)   * 50 / 50  + 0
                   WHEN pm.p10 <= 100 THEN (pm.p10 - 51)  * 49 / 49  + 51
                   WHEN pm.p10 <= 250 THEN (pm.p10 - 101) * 99 / 149 + 101
                   WHEN pm.p10 <= 350 THEN (pm.p10 - 251) * 99 / 99  + 201
                   WHEN pm.p10 <= 430 THEN (pm.p10 - 351) * 99 / 79  + 301
                   ELSE                    (pm.p10 - 431) * 99 / 69  + 401 END) sub
    CROSS APPLY (SELECT aqi = CAST(CASE WHEN sub.a25 IS NULL OR sub.a10 IS NULL THEN NULL
                                        WHEN sub.a25 >= sub.a10 THEN sub.a25 ELSE sub.a10 END AS int)) calc
    CROSS APPLY (SELECT aqi_status = CAST(CASE WHEN calc.aqi IS NULL THEN NULL
                                               WHEN calc.aqi <= 50  THEN N'Good'
                                               WHEN calc.aqi <= 100 THEN N'Satisfactory'
                                               WHEN calc.aqi <= 200 THEN N'Moderate'
                                               WHEN calc.aqi <= 300 THEN N'Poor'
                                               WHEN calc.aqi <= 400 THEN N'Very Poor'
                                               ELSE N'Severe' END AS nvarchar(32))) st
    WHERE NOT EXISTS (SELECT 1 FROM dbo.ManipulatedSensorData m WITH (UPDLOCK, HOLDLOCK) WHERE m.SourceSensorDataID = s.ID);
END
