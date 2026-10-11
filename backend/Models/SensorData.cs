namespace VayuVata.Models;

/// <summary>
/// Maps to dbo.SensorData. Column names are preserved exactly (see Data/Configurations).
/// Timestamp contract: RecordedAt is UTC; DataDate/DataTime are its UTC date and time parts.
/// Every measurement is nullable: a missing value is stored as NULL, never as 0.
/// </summary>
public class SensorData
{
    public long Id { get; set; }
    public string DeviceCode { get; set; } = "";   // column device_id -> Devices.DeviceId
    public Device Device { get; set; } = null!;
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
}
