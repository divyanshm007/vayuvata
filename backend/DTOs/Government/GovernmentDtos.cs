namespace VayuVata.DTOs.Government;

public record GeoPointDto(decimal Latitude, decimal Longitude);

public record PollutantDto(string Pollutant, decimal? Avg, decimal? Min, decimal? Max, string Unit);

public class GovernmentStationDto
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string City { get; set; } = "";
    public string State { get; set; } = "";
    public decimal Latitude { get; set; }
    public decimal Longitude { get; set; }
    public DateTime? ObservedAt { get; set; }
    public decimal? DistanceKm { get; set; }
    public decimal? Pm25 { get; set; }
    public decimal? Pm10 { get; set; }
    /// <summary>AQI calculated here from the station's PM2.5 / PM10 averages (the feed has no official AQI).</summary>
    public int? CalculatedAqi { get; set; }
    public string? CalculatedAqiStatus { get; set; }
}

public class ComparisonRowDto
{
    public string Parameter { get; set; } = "";
    public string Unit { get; set; } = "";
    public decimal? Device { get; set; }
    public decimal? Government { get; set; }
    public decimal? Difference { get; set; }
    public decimal? PercentDifference { get; set; }
    /// <summary>true when both sides use the same unit and can be subtracted.</summary>
    public bool Comparable { get; set; }
    public string? Note { get; set; }
}

public class DeviceSideDto
{
    public string DeviceId { get; set; } = "";
    public string? DeviceName { get; set; }
    public GeoPointDto? Location { get; set; }
    public DateTime? LocationRecordedAt { get; set; }
    public string? LocationSource { get; set; }
    public DateTime? LatestReadingAt { get; set; }
    public int? LatestAqi { get; set; }
    public string? LatestAqiStatus { get; set; }
    /// <summary>Readings averaged inside the comparison window (the hour that ends at the government observation).</summary>
    public int WindowSamples { get; set; }
    /// <summary>true when the values shown are the device's last reading (it has not reported near the government time); they are not compared.</summary>
    public bool IsLastKnown { get; set; }
    public DateTime? WindowFrom { get; set; }
    public DateTime? WindowTo { get; set; }
    public decimal? Pm25 { get; set; }
    public decimal? Pm10 { get; set; }
    public decimal? No2Ppm { get; set; }
    public decimal? So2Ppm { get; set; }
    public decimal? CoPpm { get; set; }
    public decimal? TvocPpb { get; set; }
    public decimal? Temperature { get; set; }
    public decimal? Humidity { get; set; }
    public decimal? OuterTemperature { get; set; }
    public decimal? OuterHumidity { get; set; }
    public int? Aqi { get; set; }
    public string? AqiStatus { get; set; }
}

public class GovernmentSideDto
{
    public GovernmentStationDto? Station { get; set; }
    public DateTime? MappedAt { get; set; }
    public List<PollutantDto> Pollutants { get; set; } = [];
}

public class DeviceComparisonDto
{
    public DeviceSideDto Device { get; set; } = new();
    public GovernmentSideDto Government { get; set; } = new();
    public List<ComparisonRowDto> Rows { get; set; } = [];
    /// <summary>ok | stale | device_offline | no_location | no_station | no_government_data</summary>
    public string Status { get; set; } = "ok";
    public string StatusMessage { get; set; } = "";
    /// <summary>Age of the government observation in minutes (IST now minus ObservedAt).</summary>
    public int? GovernmentAgeMinutes { get; set; }
    /// <summary>Device latest reading time minus government observation time, in minutes (positive = the device reading is newer).</summary>
    public int? TimeGapMinutes { get; set; }
    public List<GovernmentStationDto> NearbyStations { get; set; } = [];
}

public class GovernmentStatusDto
{
    public bool ApiKeyConfigured { get; set; }
    public int StationCount { get; set; }
    public int MappedDevices { get; set; }
    public DateTime? LastSyncAt { get; set; }
    public string? LastSyncStatus { get; set; }
    public string? LastSyncError { get; set; }
    public int LastSyncRecords { get; set; }
    public DateTime? LatestObservedAt { get; set; }
    public string Source { get; set; } = "data.gov.in - CPCB Real time Air Quality Index";
}

public class SyncResultDto
{
    public string Status { get; set; } = "";
    public int RecordsFetched { get; set; }
    public int StationsAdded { get; set; }
    public int ReadingsAdded { get; set; }
    public int DevicesMatched { get; set; }
    public int DevicesSwitched { get; set; }
    public string? Error { get; set; }
}
