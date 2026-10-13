namespace VayuVata.Models;

/// <summary>
/// Maps to dbo.GpsLocationData: one position report per device per minute (Raspberry Pi / GPS-or-cell tracker).
/// (device_id, recorded_at) is unique, so a retried upload can never create a second row.
/// When HasFix is false the position columns are NULL (never 0).
/// </summary>
public class GpsLocationData
{
    public long Id { get; set; }
    public string DeviceCode { get; set; } = "";       // column device_id -> Devices.DeviceId
    public Device Device { get; set; } = null!;
    /// <summary>Time of the fix as IST (UTC+5:30) wall-clock. The device sends UTC (GPS time); the server converts before storing.</summary>
    public DateTime RecordedAt { get; set; }
    /// <summary>Time SQL Server stored the row, as IST wall-clock (UTC+5:30).</summary>
    public DateTime ReceivedAt { get; set; }
    public bool HasFix { get; set; }
    /// <summary>"gps" (satellite fix) or "cell" (approximate tower position).</summary>
    public string Source { get; set; } = "gps";
    public decimal? Latitude { get; set; }
    public decimal? Longitude { get; set; }
    public decimal? AltitudeM { get; set; }
    public decimal? SpeedKmh { get; set; }
    public byte? SignalPct { get; set; }
}
