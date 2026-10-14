using System.Text.Json.Serialization;
using VayuVata.Helpers;

namespace VayuVata.DTOs.SensorData;

/// <summary>
/// ESP32 reading. All measurements are optional: an omitted/null value is stored as NULL, never 0.
/// </summary>
public class CreateSensorDataRequest
{
    /// <summary>Physical device identifier (must match the owner of the X-Device-Key).</summary>
    /// <example>ESP32-A1B2C3</example>
    public string DeviceId { get; set; } = "";
    /// <summary>Time of measurement exactly as the device sends it (the ESP32 sends IST wall-clock, e.g. 2026-10-11T14:00:00); stored as given. Defaults to current IST if omitted. (DeviceId, RecordedAt) uniquely identifies a reading; resubmitting it returns 409.</summary>
    /// <example>2026-10-11T14:00:00</example>
    public DateTime? RecordedAt { get; set; }
    /// <summary>Date of measurement as sent by the device (yyyy-MM-dd). Stored as given; defaults to the date part of RecordedAt.</summary>
    /// <example>2026-10-11</example>
    public DateOnly? DataDate { get; set; }
    /// <summary>Time of measurement as sent by the device (HH:mm:ss). Stored as given; defaults to the time part of RecordedAt.</summary>
    /// <example>14:00:00</example>
    public TimeOnly? DataTime { get; set; }
    /// <example>87</example>
    public int? Aqi { get; set; }
    /// <example>Moderate</example>
    public string? AqiStatus { get; set; }
    /// <example>45.2</example>
    public decimal? Pm10 { get; set; }
    /// <example>22.5</example>
    public decimal? Pm25 { get; set; }
    /// <example>0.021</example>
    public decimal? No2Ppm { get; set; }
    /// <example>0.004</example>
    public decimal? So2Ppm { get; set; }
    /// <example>1.2</example>
    public decimal? CoPpm { get; set; }
    /// <example>180</example>
    public decimal? TvocPpb { get; set; }
    /// <example>55.3</example>
    public decimal? Humidity { get; set; }
    /// <example>26.8</example>
    public decimal? Temperature { get; set; }
    /// <example>31.4</example>
    public decimal? OuterTemperature { get; set; }
    /// <example>48.0</example>
    public decimal? OuterHumidity { get; set; }

    /// <summary>Legacy firmware name for <c>outerTemperature</c> (RS485 outer sensor). Used only when <c>outerTemperature</c> is not sent.</summary>
    [JsonPropertyName("rs485_temperature")]
    public decimal? Rs485Temperature { get => null; set => OuterTemperature ??= value; }
    /// <summary>Legacy firmware name for <c>outerHumidity</c> (RS485 outer sensor). Used only when <c>outerHumidity</c> is not sent.</summary>
    [JsonPropertyName("rs485_humidity")]
    public decimal? Rs485Humidity { get => null; set => OuterHumidity ??= value; }
}

public class SensorDataDto
{
    public long Id { get; set; }
    public string DeviceId { get; set; } = "";
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

public class SensorDataQuery : PageQuery
{
    /// <summary>Physical device identifier filter.</summary>
    public string? DeviceId { get; set; }
    public DateTime? From { get; set; }
    public DateTime? To { get; set; }
    /// <summary>recordedAt (default) | createdAt | aqi</summary>
    public string SortBy { get; set; } = "recordedAt";
    /// <summary>desc (default) | asc</summary>
    public string SortDir { get; set; } = "desc";
}

public class HistoryQuery : PageQuery
{
    public DateTime? From { get; set; }
    public DateTime? To { get; set; }
    public string SortDir { get; set; } = "desc";
}
