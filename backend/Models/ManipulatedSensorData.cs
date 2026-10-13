namespace VayuVata.Models;

/// <summary>
/// Maps to dbo.ManipulatedSensorData: one processed row per dbo.SensorData row, written by the SQL Server INSERT trigger
/// (TR_SensorData_AfterInsert -> dbo.ProcessSensorData), never by the API. Same 18 columns as the source; aqi / aqi_status are
/// CALCULATED from pm25 / pm10 (firmware calculateAQI_INDIA), not copied from what the device reported.
/// </summary>
public class ManipulatedSensorData
{
    public long ManipulatedId { get; set; }
    public long SourceSensorDataId { get; set; }
    public SensorData Source { get; set; } = null!;
    public long Id { get; set; }                       // column ID = the source reading's ID
    public string DeviceCode { get; set; } = "";
    public DateOnly DataDate { get; set; }
    public TimeOnly DataTime { get; set; }
    public DateTime RecordedAt { get; set; }
    public int? Aqi { get; set; }
    public string? AqiStatus { get; set; }
    public decimal? Pm10 { get; set; }
    public decimal? Pm25 { get; set; }
    public decimal? No2Ppm { get; set; }
    public decimal? So2Ppm { get; set; }
    public decimal? CoPpm { get; set; }
    public decimal? TvocPpb { get; set; }
    public decimal? Humidity { get; set; }
    public decimal? Temperature { get; set; }
    public decimal? OuterTemperature { get; set; }
    public decimal? OuterHumidity { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime ProcessedAt { get; set; }
}
