using VayuVata.Helpers;

namespace VayuVata.DTOs.Gps;

/// <summary>
/// One position report (Raspberry Pi, once a minute). Send <c>fix:false</c> with null position fields for a "no fix" minute
/// (optional - the device may simply skip those minutes).
/// </summary>
public class CreateGpsLocationRequest
{
    /// <summary>Registered device identifier (must match the owner of the X-Device-Key), at most 50 characters.</summary>
    /// <example>vayuvata-pi-01</example>
    public string DeviceId { get; set; } = "";
    /// <summary>Time of the fix, ISO-8601 UTC (GPS time, e.g. ...Z); an explicit offset is also accepted. Required; cannot be in the future. It is converted to and STORED AS IST (UTC+5:30). (deviceId, recordedAt) is unique: a repeat returns 200 with the stored report.</summary>
    /// <example>2026-10-14T01:30:00Z</example>
    public DateTime? RecordedAt { get; set; }
    /// <summary>true when a position is included; false for a no-fix report (then lat/lon/altM/speedKmh must be null). Required.</summary>
    /// <example>true</example>
    public bool? Fix { get; set; }
    /// <summary>"gps" (satellite fix) or "cell" (approximate tower position).</summary>
    /// <example>gps</example>
    public string Source { get; set; } = "";
    /// <summary>Decimal degrees, -90..90 (6 decimals kept).</summary>
    /// <example>28.580707</example>
    public decimal? Lat { get; set; }
    /// <summary>Decimal degrees, -180..180 (6 decimals kept).</summary>
    /// <example>77.398512</example>
    public decimal? Lon { get; set; }
    /// <summary>Altitude in metres (1 decimal kept); may be 0 for cell positions.</summary>
    /// <example>239.9</example>
    public decimal? AltM { get; set; }
    /// <summary>Speed in km/h, 0 or more (1 decimal kept).</summary>
    /// <example>0.0</example>
    public decimal? SpeedKmh { get; set; }
    /// <summary>LTE signal quality, integer 0-100.</summary>
    /// <example>83</example>
    public int? SignalPct { get; set; }
}

/// <summary>Filters for the GPS history list (login required; limited to the caller's devices).</summary>
public class GpsHistoryQuery : PageQuery
{
    /// <summary>Physical device identifier, e.g. Vayu_004.</summary>
    public string? DeviceId { get; set; }
    /// <summary>Earliest report time. A value without a zone is compared as typed (stored times are IST wall-clock).</summary>
    public DateTime? From { get; set; }
    public DateTime? To { get; set; }
    /// <summary>true = only reports with a position fix.</summary>
    public bool? FixOnly { get; set; }
    /// <summary>desc (default) | asc</summary>
    public string SortDir { get; set; } = "desc";
}

public class GpsLocationDto
{
    public long Id { get; set; }
    public string DeviceId { get; set; } = "";
    /// <summary>Time of the fix in IST, with the +05:30 offset (e.g. 2026-10-14T07:00:00+05:30).</summary>
    public DateTimeOffset RecordedAt { get; set; }
    /// <summary>Time the server stored the report, in IST with the +05:30 offset.</summary>
    public DateTimeOffset ReceivedAt { get; set; }
    public bool Fix { get; set; }
    public string Source { get; set; } = "";
    public decimal? Lat { get; set; }
    public decimal? Lon { get; set; }
    public decimal? AltM { get; set; }
    public decimal? SpeedKmh { get; set; }
    public int? SignalPct { get; set; }
}
