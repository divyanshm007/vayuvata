namespace VayuVata.Models;

/// <summary>An official CPCB / partner monitoring station, learnt from the data.gov.in "Real time Air Quality Index" feed.</summary>
public class GovernmentStation
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string City { get; set; } = "";
    public string State { get; set; } = "";
    public decimal Latitude { get; set; }
    public decimal Longitude { get; set; }
    /// <summary>Last sync (UTC) in which the feed still listed this station.</summary>
    public DateTime LastSeenAt { get; set; }
    public ICollection<GovernmentStationReading> Readings { get; set; } = [];
}

/// <summary>One pollutant of one station for one hourly observation (the feed has one row per station and pollutant). Values are µg/m³, except CO (mg/m³).</summary>
public class GovernmentStationReading
{
    public long Id { get; set; }
    public int StationId { get; set; }
    public GovernmentStation Station { get; set; } = null!;
    /// <summary>PM2.5, PM10, NO2, NH3, SO2, CO, OZONE.</summary>
    public string Pollutant { get; set; } = "";
    /// <summary>The feed's last_update, an IST wall-clock time (same convention as SensorData.recorded_at).</summary>
    public DateTime ObservedAt { get; set; }
    public decimal? MinValue { get; set; }
    public decimal? MaxValue { get; set; }
    public decimal? AvgValue { get; set; }
    /// <summary>When this server stored the row (UTC).</summary>
    public DateTime FetchedAt { get; set; }
}

/// <summary>Which station a device is compared with. History is kept: the current mapping has ValidTo = NULL.</summary>
public class DeviceStationMapping
{
    public long Id { get; set; }
    public string DeviceCode { get; set; } = "";
    public Device Device { get; set; } = null!;
    public int StationId { get; set; }
    public GovernmentStation Station { get; set; } = null!;
    public decimal DistanceKm { get; set; }
    public decimal DeviceLatitude { get; set; }
    public decimal DeviceLongitude { get; set; }
    public DateTime MatchedAt { get; set; }
    public DateTime? ValidTo { get; set; }
    /// <summary>"auto" (nearest eligible station) - reserved for a later manual override.</summary>
    public string Method { get; set; } = "auto";
}

public class GovernmentSyncLog
{
    public long Id { get; set; }
    public DateTime StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public int RecordsFetched { get; set; }
    public int StationsAdded { get; set; }
    public int ReadingsAdded { get; set; }
    /// <summary>running | ok | failed</summary>
    public string Status { get; set; } = "running";
    public string? Error { get; set; }
    public string Trigger { get; set; } = "schedule";
}
