using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using VayuVata.Data;
using VayuVata.DTOs.Government;
using VayuVata.Helpers;
using VayuVata.Models;

namespace VayuVata.Services;

public class GovDataOptions
{
    public bool Enabled { get; set; } = true;
    public string BaseUrl { get; set; } = "https://api.data.gov.in/resource/";
    /// <summary>"Real time Air Quality Index from various locations" (CPCB), hourly.</summary>
    public string ResourceId { get; set; } = "3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69";
    /// <summary>The api-key. Prefer ApiKeyFile (a root-only file) over putting the key in an environment value.</summary>
    public string? ApiKey { get; set; }
    public string? ApiKeyFile { get; set; }
    public int PageSize { get; set; } = 1000;
    public int IntervalMinutes { get; set; } = 60;
    /// <summary>A device is only matched to a station within this distance.</summary>
    public double MaxMatchDistanceKm { get; set; } = 50;
    /// <summary>A station whose newest observation is older than this is not eligible and its data is labelled stale.</summary>
    public int StaleAfterHours { get; set; } = 3;
    /// <summary>The mapping only moves to another station when that one is at least this much closer (or the current one is no longer eligible).</summary>
    public double SwitchHysteresisKm { get; set; } = 0.5;
    /// <summary>Device readings in the window [observedAt - this, observedAt] are averaged against the hourly government value.</summary>
    public int ComparisonWindowMinutes { get; set; } = 60;
}

/// <summary>CPCB AQI for PM2.5 / PM10 with exactly the firmware's integer arithmetic (see Tests/firmware/calculateAQI_INDIA.cpp).</summary>
public static class IndiaAqi
{
    private static long Map(long x, long inMin, long inMax, long outMin, long outMax) => (x - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;

    public static int? Calculate(decimal? pm25, decimal? pm10)
    {
        if (pm25 is null || pm10 is null) return null;
        long a = (long)pm25.Value, b = (long)pm10.Value;
        long x = a <= 30 ? Map(a, 0, 30, 0, 50) : a <= 60 ? Map(a, 31, 60, 51, 100) : a <= 90 ? Map(a, 61, 90, 101, 200)
               : a <= 120 ? Map(a, 91, 120, 201, 300) : a <= 250 ? Map(a, 121, 250, 301, 400) : Map(a, 251, 500, 401, 500);
        long y = b <= 50 ? Map(b, 0, 50, 0, 50) : b <= 100 ? Map(b, 51, 100, 51, 100) : b <= 250 ? Map(b, 101, 250, 101, 200)
               : b <= 350 ? Map(b, 251, 350, 201, 300) : b <= 430 ? Map(b, 351, 430, 301, 400) : Map(b, 431, 500, 401, 500);
        return (int)Math.Max(x, y);
    }

    public static string Status(int aqi) => aqi <= 50 ? "Good" : aqi <= 100 ? "Satisfactory" : aqi <= 200 ? "Moderate" : aqi <= 300 ? "Poor" : aqi <= 400 ? "Very Poor" : "Severe";
}

/// <summary>Fetches the data.gov.in feed, stores stations and readings, and keeps each device mapped to its nearest eligible station.</summary>
public class GovernmentDataService(VayuVataDbContext db, IHttpClientFactory http, IOptions<GovDataOptions> options, ILogger<GovernmentDataService> log)
{
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private readonly GovDataOptions _o = options.Value;

    /// <summary>IST wall-clock now: the same convention as SensorData.recorded_at and the feed's last_update.</summary>
    public static DateTime IstNow => DateTime.UtcNow.AddMinutes(330);

    public string? ResolveApiKey()
    {
        if (!string.IsNullOrWhiteSpace(_o.ApiKey)) return _o.ApiKey.Trim();
        if (!string.IsNullOrWhiteSpace(_o.ApiKeyFile) && File.Exists(_o.ApiKeyFile)) return File.ReadAllText(_o.ApiKeyFile).Trim();
        return null;
    }

    public static double HaversineKm(double lat1, double lon1, double lat2, double lon2)
    {
        const double R = 6371.0088;
        static double Rad(double d) => d * Math.PI / 180;
        var dLat = Rad(lat2 - lat1); var dLon = Rad(lon2 - lon1);
        var h = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) + Math.Cos(Rad(lat1)) * Math.Cos(Rad(lat2)) * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        return 2 * R * Math.Asin(Math.Min(1, Math.Sqrt(h)));
    }

    // ------------------------------------------------------------------ sync

    private sealed record FeedRow(string Station, string City, string State, decimal Lat, decimal Lon, string Pollutant, DateTime Observed, decimal? Min, decimal? Max, decimal? Avg);

    /// <summary>SQL rounds decimal(9,6) half away from zero; use the same rule so a feed position always matches its stored station.</summary>
    private static decimal R6(decimal v) => Math.Round(v, 6, MidpointRounding.AwayFromZero);

    private static decimal? Num(string? s) =>
        decimal.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : null;

    private async Task<List<FeedRow>> FetchAsync(string key, CancellationToken ct)
    {
        var client = http.CreateClient("datagov");
        var rows = new List<FeedRow>();
        for (int offset = 0, total = int.MaxValue; offset < total; offset += _o.PageSize)
        {
            var url = $"{_o.BaseUrl.TrimEnd('/')}/{_o.ResourceId}?api-key={Uri.EscapeDataString(key)}&format=json&limit={_o.PageSize}&offset={offset}";
            using var resp = await client.GetAsync(url, ct);
            if (!resp.IsSuccessStatusCode) throw new InvalidOperationException($"data.gov.in answered HTTP {(int)resp.StatusCode}.");
            using var doc = await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
            var root = doc.RootElement;
            total = root.TryGetProperty("total", out var t) && int.TryParse(t.ToString(), out var tt) ? tt : 0;
            if (!root.TryGetProperty("records", out var recs) || recs.GetArrayLength() == 0) break;
            foreach (var r in recs.EnumerateArray())
            {
                string S(string n) => r.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? (v.GetString() ?? "").Trim() : "";
                var lat = Num(S("latitude")); var lon = Num(S("longitude"));
                if (lat is null or 0 || lon is null or 0) continue;                    // a station without a usable position cannot be matched
                if (!DateTime.TryParseExact(S("last_update"), "dd-MM-yyyy HH:mm:ss", CultureInfo.InvariantCulture, DateTimeStyles.None, out var obs)) continue;
                var name = S("station"); var pol = S("pollutant_id");
                if (name.Length == 0 || pol.Length == 0) continue;
                rows.Add(new FeedRow(name, S("city"), S("state"), lat.Value, lon.Value, pol.ToUpperInvariant(), obs, Num(S("min_value")), Num(S("max_value")), Num(S("avg_value"))));
            }
        }
        return rows;
    }

    public async Task<SyncResultDto> SyncAsync(string trigger, CancellationToken ct)
    {
        if (!await Gate.WaitAsync(0, ct)) return new SyncResultDto { Status = "busy", Error = "A sync is already running." };
        var logRow = new GovernmentSyncLog { StartedAt = DateTime.UtcNow, Trigger = trigger };
        var result = new SyncResultDto();
        try
        {
            db.GovernmentSyncLogs.Add(logRow); await db.SaveChangesAsync(ct);
            var key = ResolveApiKey() ?? throw new InvalidOperationException("No data.gov.in API key is configured (DataGov:ApiKey or DataGov:ApiKeyFile).");
            var rows = await FetchAsync(key, ct);
            result.RecordsFetched = logRow.RecordsFetched = rows.Count;

            // stations (identity = name + position)
            var stations = await db.GovernmentStations.ToListAsync(ct);
            var byKey = stations.ToDictionary(s => (s.Name, R6(s.Latitude), R6(s.Longitude)));
            var now = DateTime.UtcNow;
            foreach (var g in rows.GroupBy(r => (r.Station, Lat: R6(r.Lat), Lon: R6(r.Lon))))
            {
                if (!byKey.TryGetValue(g.Key, out var st))
                {
                    var f = g.First();
                    st = new GovernmentStation { Name = f.Station, City = f.City, State = f.State, Latitude = R6(f.Lat), Longitude = R6(f.Lon) };
                    db.GovernmentStations.Add(st); byKey[g.Key] = st; result.StationsAdded++;
                }
                st.LastSeenAt = now;
            }
            await db.SaveChangesAsync(ct);

            // readings: only unseen (station, pollutant, observedAt); rows with no value at all are not stored
            var observedSet = rows.Select(r => r.Observed).Distinct().ToList();
            var existing = (await db.GovernmentStationReadings.Where(r => observedSet.Contains(r.ObservedAt))
                .Select(r => new { r.StationId, r.Pollutant, r.ObservedAt }).ToListAsync(ct))
                .Select(r => (r.StationId, r.Pollutant, r.ObservedAt)).ToHashSet();
            foreach (var r in rows)
            {
                if (r.Avg is null && r.Min is null && r.Max is null) continue;
                var st = byKey[(r.Station, R6(r.Lat), R6(r.Lon))];
                if (!existing.Add((st.Id, r.Pollutant, r.Observed))) continue;
                db.GovernmentStationReadings.Add(new GovernmentStationReading
                { StationId = st.Id, Pollutant = r.Pollutant, ObservedAt = r.Observed, MinValue = r.Min, MaxValue = r.Max, AvgValue = r.Avg, FetchedAt = now });
                result.ReadingsAdded++;
            }
            await db.SaveChangesAsync(ct);

            var (matched, switched) = await MatchAllAsync(ct);
            result.DevicesMatched = matched; result.DevicesSwitched = switched;
            logRow.StationsAdded = result.StationsAdded; logRow.ReadingsAdded = result.ReadingsAdded;
            logRow.Status = "ok"; result.Status = "ok";
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            var msg = ex.GetBaseException().Message;
            log.LogWarning("Government data sync failed: {Reason}", msg);
            logRow.Status = "failed"; logRow.Error = msg[..Math.Min(480, msg.Length)];
            result.Status = "failed"; result.Error = logRow.Error;
        }
        finally
        {
            // After a failed save the tracker still holds the rejected entities; drop them and update the log row on its own.
            var status = logRow.Status; var err = logRow.Error; var fetched = logRow.RecordsFetched; var added = logRow.StationsAdded; var readings = logRow.ReadingsAdded;
            if (status == "running") { status = "failed"; err ??= "The sync stopped before it finished."; }
            db.ChangeTracker.Clear();
            try
            {
                await db.GovernmentSyncLogs.Where(l => l.Id == logRow.Id).ExecuteUpdateAsync(u => u
                    .SetProperty(l => l.CompletedAt, DateTime.UtcNow).SetProperty(l => l.Status, status).SetProperty(l => l.Error, err)
                    .SetProperty(l => l.RecordsFetched, fetched).SetProperty(l => l.StationsAdded, added).SetProperty(l => l.ReadingsAdded, readings), CancellationToken.None);
            }
            catch { /* the log row is best effort */ }
            Gate.Release();
        }
        return result;
    }

    // -------------------------------------------------------------- matching

    private sealed record Eligible(GovernmentStation Station, DateTime Observed);

    /// <summary>Stations whose newest PM observation is fresh and has a PM2.5 or PM10 average.</summary>
    private async Task<List<Eligible>> EligibleStationsAsync(CancellationToken ct)
    {
        var floor = IstNow.AddHours(-_o.StaleAfterHours);
        var latest = await db.GovernmentStationReadings
            .Where(r => (r.Pollutant == "PM2.5" || r.Pollutant == "PM10") && r.AvgValue != null && r.ObservedAt >= floor)
            .GroupBy(r => r.StationId).Select(g => new { StationId = g.Key, Observed = g.Max(x => x.ObservedAt) }).ToListAsync(ct);
        var ids = latest.Select(l => l.StationId).ToList();
        var stations = await db.GovernmentStations.Where(s => ids.Contains(s.Id)).ToDictionaryAsync(s => s.Id, ct);
        return latest.Select(l => new Eligible(stations[l.StationId], l.Observed)).ToList();
    }

    public async Task<GpsLocationData?> LatestFixAsync(string deviceCode, CancellationToken ct) =>
        await db.GpsLocationData.AsNoTracking().Where(g => g.DeviceCode == deviceCode && g.HasFix && g.Latitude != null && g.Longitude != null)
            .OrderByDescending(g => g.RecordedAt).FirstOrDefaultAsync(ct);

    /// <summary>(Re)assigns every active device to its nearest eligible station. Keeps history; switches only when clearly closer.</summary>
    public async Task<(int Matched, int Switched)> MatchAllAsync(CancellationToken ct)
    {
        var eligible = await EligibleStationsAsync(ct);
        var eligibleIds = eligible.Select(e => e.Station.Id).ToHashSet();
        var devices = await db.Devices.AsNoTracking().Where(d => d.IsActive).Select(d => d.DeviceId).ToListAsync(ct);
        int matched = 0, switched = 0;
        foreach (var code in devices)
        {
            var fix = await LatestFixAsync(code, ct);
            if (fix is null) continue;
            double dLat = (double)fix.Latitude!.Value, dLon = (double)fix.Longitude!.Value;
            var ranked = eligible.Select(e => (e.Station, Km: HaversineKm(dLat, dLon, (double)e.Station.Latitude, (double)e.Station.Longitude)))
                .Where(x => x.Km <= _o.MaxMatchDistanceKm).OrderBy(x => x.Km).ToList();
            if (ranked.Count == 0) continue;
            var best = ranked[0];
            var current = await db.DeviceStationMappings.Include(m => m.Station).FirstOrDefaultAsync(m => m.DeviceCode == code && m.ValidTo == null, ct);
            if (current is not null)
            {
                var curKm = HaversineKm(dLat, dLon, (double)current.Station.Latitude, (double)current.Station.Longitude);
                var currentOk = eligibleIds.Contains(current.StationId) && curKm <= _o.MaxMatchDistanceKm;
                if (current.StationId == best.Station.Id || (currentOk && best.Km > curKm - _o.SwitchHysteresisKm))
                {
                    current.DistanceKm = (decimal)Math.Round(curKm, 3);          // keep the station, refresh the distance
                    current.DeviceLatitude = fix.Latitude.Value; current.DeviceLongitude = fix.Longitude.Value;
                    matched++; continue;
                }
                current.ValidTo = DateTime.UtcNow; switched++;
                await db.SaveChangesAsync(ct);
            }
            db.DeviceStationMappings.Add(new DeviceStationMapping
            {
                DeviceCode = code, StationId = best.Station.Id, DistanceKm = (decimal)Math.Round(best.Km, 3),
                DeviceLatitude = fix.Latitude.Value, DeviceLongitude = fix.Longitude.Value, MatchedAt = DateTime.UtcNow,
            });
            matched++;
        }
        await db.SaveChangesAsync(ct);
        return (matched, switched);
    }

    // ------------------------------------------------------------ comparison

    private static string UnitOf(string p) => p == "CO" ? "mg/m³" : "µg/m³";

    public async Task<GovernmentStatusDto> StatusAsync(CancellationToken ct)
    {
        var last = await db.GovernmentSyncLogs.AsNoTracking().OrderByDescending(l => l.Id).FirstOrDefaultAsync(ct);
        return new GovernmentStatusDto
        {
            ApiKeyConfigured = ResolveApiKey() is not null,
            StationCount = await db.GovernmentStations.CountAsync(ct),
            MappedDevices = await db.DeviceStationMappings.CountAsync(m => m.ValidTo == null, ct),
            LastSyncAt = last?.CompletedAt ?? last?.StartedAt, LastSyncStatus = last?.Status, LastSyncError = last?.Error, LastSyncRecords = last?.RecordsFetched ?? 0,
            LatestObservedAt = await db.GovernmentStationReadings.MaxAsync(r => (DateTime?)r.ObservedAt, ct),
        };
    }

    private static GovernmentStationDto ToStationDto(GovernmentStation s, IEnumerable<GovernmentStationReading> latest, double? km)
    {
        var rs = latest.ToList();
        var pm25 = rs.FirstOrDefault(r => r.Pollutant == "PM2.5")?.AvgValue; var pm10 = rs.FirstOrDefault(r => r.Pollutant == "PM10")?.AvgValue;
        var aqi = IndiaAqi.Calculate(pm25, pm10);
        return new GovernmentStationDto
        {
            Id = s.Id, Name = s.Name, City = s.City, State = s.State, Latitude = s.Latitude, Longitude = s.Longitude,
            ObservedAt = rs.Count == 0 ? null : rs.Max(r => r.ObservedAt), DistanceKm = km is null ? null : (decimal)Math.Round(km.Value, 2),
            Pm25 = pm25, Pm10 = pm10, CalculatedAqi = aqi, CalculatedAqiStatus = aqi is null ? null : IndiaAqi.Status(aqi.Value),
        };
    }

    /// <summary>Newest observation per pollutant of one station.</summary>
    private async Task<List<GovernmentStationReading>> LatestReadingsAsync(int stationId, CancellationToken ct)
    {
        var all = await db.GovernmentStationReadings.AsNoTracking().Where(r => r.StationId == stationId)
            .OrderByDescending(r => r.ObservedAt).Take(60).ToListAsync(ct);
        var newest = all.Count == 0 ? (DateTime?)null : all.Max(r => r.ObservedAt);
        return all.Where(r => r.ObservedAt == newest).ToList();
    }

    public async Task<DeviceComparisonDto> CompareAsync(string deviceCode, double nearbyRadiusKm, CancellationToken ct)
    {
        var device = await db.Devices.AsNoTracking().FirstOrDefaultAsync(d => d.DeviceId == deviceCode, ct) ?? throw ApiException.NotFound("Device not found.");
        var dto = new DeviceComparisonDto { Device = new DeviceSideDto { DeviceId = device.DeviceId, DeviceName = device.DeviceName } };

        var fix = await LatestFixAsync(deviceCode, ct);
        if (fix is not null)
        {
            dto.Device.Location = new GeoPointDto(fix.Latitude!.Value, fix.Longitude!.Value);
            dto.Device.LocationRecordedAt = fix.RecordedAt; dto.Device.LocationSource = fix.Source;
        }
        var latestRow = await db.ManipulatedSensorData.AsNoTracking().Where(s => s.DeviceCode == deviceCode)
            .OrderByDescending(s => s.RecordedAt).ThenByDescending(s => s.Id).FirstOrDefaultAsync(ct);
        if (latestRow is not null) { dto.Device.LatestReadingAt = latestRow.RecordedAt; dto.Device.LatestAqi = latestRow.Aqi; dto.Device.LatestAqiStatus = latestRow.AqiStatus; }

        if (fix is null) { dto.Status = "no_location"; dto.StatusMessage = "This device has not reported a GPS fix yet, so no station can be matched."; return dto; }

        var mapping = await db.DeviceStationMappings.AsNoTracking().Include(m => m.Station)
            .FirstOrDefaultAsync(m => m.DeviceCode == deviceCode && m.ValidTo == null, ct);
        if (mapping is null) { dto.Status = "no_station"; dto.StatusMessage = $"No eligible government station within {_o.MaxMatchDistanceKm:0} km with fresh data."; }
        else
        {
            var readings = await LatestReadingsAsync(mapping.StationId, ct);
            double km = HaversineKm((double)fix.Latitude!.Value, (double)fix.Longitude!.Value, (double)mapping.Station.Latitude, (double)mapping.Station.Longitude);
            dto.Government = new GovernmentSideDto
            {
                Station = ToStationDto(mapping.Station, readings, km), MappedAt = mapping.MatchedAt,
                Pollutants = readings.OrderBy(r => r.Pollutant).Select(r => new PollutantDto(r.Pollutant, r.AvgValue, r.MinValue, r.MaxValue, UnitOf(r.Pollutant))).ToList(),
            };
            var observed = dto.Government.Station.ObservedAt;
            if (observed is null) { dto.Status = "no_government_data"; dto.StatusMessage = "The matched station has no stored readings."; }
            else
            {
                dto.GovernmentAgeMinutes = (int)(IstNow - observed.Value).TotalMinutes;
                dto.Status = dto.GovernmentAgeMinutes > _o.StaleAfterHours * 60 ? "stale" : "ok";
                dto.StatusMessage = dto.Status == "stale" ? $"The government reading is {dto.GovernmentAgeMinutes / 60} h old." : "Government data is current.";

                // device side: average of the readings in the hour that ends at the government observation time (both IST wall-clock)
                var to = observed.Value; var from = to.AddMinutes(-_o.ComparisonWindowMinutes);
                var win = await db.ManipulatedSensorData.AsNoTracking().Where(s => s.DeviceCode == deviceCode && s.RecordedAt > from && s.RecordedAt <= to).ToListAsync(ct);
                dto.Device.WindowFrom = from; dto.Device.WindowTo = to; dto.Device.WindowSamples = win.Count;
                if (win.Count == 0 && latestRow is not null && latestRow.RecordedAt <= to && to - latestRow.RecordedAt <= TimeSpan.FromHours(_o.StaleAfterHours))
                {
                    win = [latestRow];
                    dto.StatusMessage += " No device readings exist inside the government hour, so the device's latest reading (within " + _o.StaleAfterHours + " h) is used instead.";
                }
                else if (win.Count == 0)
                {
                    if (latestRow is not null) { win = [latestRow]; dto.Device.IsLastKnown = true; }   // show the last known values, labelled; never compared
                    dto.Status = "device_offline";
                    dto.StatusMessage = latestRow is null ? "The device has no readings yet."
                        : $"The device has not reported near the government observation time (its latest reading is from {latestRow.RecordedAt:dd MMM yyyy HH:mm} IST), so there is nothing to compare.";
                }
                decimal? Avg(Func<ManipulatedSensorData, decimal?> f) { var v = win.Select(f).Where(x => x != null).Select(x => x!.Value).ToList(); return v.Count == 0 ? null : Math.Round(v.Average(), 2); }
                dto.Device.Pm25 = Avg(s => s.Pm25); dto.Device.Pm10 = Avg(s => s.Pm10); dto.Device.No2Ppm = Avg(s => s.No2Ppm); dto.Device.So2Ppm = Avg(s => s.So2Ppm);
                dto.Device.CoPpm = Avg(s => s.CoPpm); dto.Device.TvocPpb = Avg(s => s.TvocPpb); dto.Device.Temperature = Avg(s => s.Temperature);
                dto.Device.Humidity = Avg(s => s.Humidity); dto.Device.OuterTemperature = Avg(s => s.OuterTemperature); dto.Device.OuterHumidity = Avg(s => s.OuterHumidity);
                dto.Device.Aqi = IndiaAqi.Calculate(dto.Device.Pm25, dto.Device.Pm10);
                dto.Device.AqiStatus = dto.Device.Aqi is null ? null : IndiaAqi.Status(dto.Device.Aqi.Value);
                dto.Rows = BuildRows(dto);
                if (dto.Device.IsLastKnown)
                    foreach (var r in dto.Rows) { r.Comparable = false; r.Difference = null; r.PercentDifference = null; r.Note = "Device offline: last known value, not compared."; }
            }
        }

        // nearby stations for the map (any station with a fresh PM reading inside the radius)
        var eligible = await EligibleStationsAsync(ct);
        var near = eligible.Select(e => (e.Station, Km: HaversineKm((double)fix.Latitude!.Value, (double)fix.Longitude!.Value, (double)e.Station.Latitude, (double)e.Station.Longitude)))
            .Where(x => x.Km <= nearbyRadiusKm).OrderBy(x => x.Km).Take(25).ToList();
        foreach (var (station, km) in near)
            dto.NearbyStations.Add(ToStationDto(station, await LatestReadingsAsync(station.Id, ct), km));
        return dto;
    }

    private static ComparisonRowDto Row(string name, string unit, decimal? dev, decimal? gov, bool comparable, string? note = null)
    {
        var r = new ComparisonRowDto { Parameter = name, Unit = unit, Device = dev, Government = gov, Comparable = comparable, Note = note };
        if (comparable && dev is not null && gov is not null)
        {
            r.Difference = Math.Round(dev.Value - gov.Value, 2);
            r.PercentDifference = gov.Value == 0 ? null : Math.Round((dev.Value - gov.Value) / gov.Value * 100, 1);
        }
        return r;
    }

    private static List<ComparisonRowDto> BuildRows(DeviceComparisonDto d)
    {
        decimal? G(string p) => d.Government.Pollutants.FirstOrDefault(x => x.Pollutant == p)?.Avg;
        var gAqi = d.Government.Station?.CalculatedAqi;
        return
        [
            Row("AQI (calculated from PM)", "", d.Device.Aqi, gAqi, true, "The feed has no official AQI; both sides use the same CPCB PM2.5/PM10 formula."),
            Row("PM2.5", "µg/m³", d.Device.Pm25, G("PM2.5"), true),
            Row("PM10", "µg/m³", d.Device.Pm10, G("PM10"), true),
            Row("NO₂", "device raw / gov µg/m³", d.Device.No2Ppm, G("NO2"), false, "Units differ (the device reports an uncalibrated sensor value); shown, not subtracted."),
            Row("SO₂", "device raw / gov µg/m³", d.Device.So2Ppm, G("SO2"), false, "Units differ (the device reports an uncalibrated sensor value); shown, not subtracted."),
            Row("CO", "device ppm / gov mg/m³", d.Device.CoPpm, G("CO"), false, "Units differ; shown, not subtracted."),
            Row("TVOC", "ppb", d.Device.TvocPpb, null, false, "The government station has no equivalent of TVOC."),
            Row("Temperature", "°C", d.Device.Temperature, null, false, "The government feed has no temperature."),
            Row("Humidity", "%", d.Device.Humidity, null, false, "The government feed has no humidity."),
            Row("Outer temperature", "°C", d.Device.OuterTemperature, null, false, "The government feed has no temperature."),
            Row("Outer humidity", "%", d.Device.OuterHumidity, null, false, "The government feed has no humidity."),
        ];
    }

    public async Task<List<DeviceComparisonDto>> CompareAllAsync(double nearbyRadiusKm, CancellationToken ct)
    {
        var codes = await db.Devices.AsNoTracking().Where(d => d.IsActive).OrderBy(d => d.DeviceId).Select(d => d.DeviceId).ToListAsync(ct);
        var list = new List<DeviceComparisonDto>();
        foreach (var c in codes) list.Add(await CompareAsync(c, nearbyRadiusKm, ct));
        return list;
    }
}

/// <summary>Runs the government sync shortly after start-up and then on a timer. Failures never stop the API.</summary>
public class GovernmentDataBackgroundService(IServiceScopeFactory scopes, IOptions<GovDataOptions> options, ILogger<GovernmentDataBackgroundService> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        var o = options.Value;
        if (!o.Enabled) { log.LogInformation("Government data sync is disabled."); return; }
        try { await Task.Delay(TimeSpan.FromSeconds(20), stop); } catch (OperationCanceledException) { return; }
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(Math.Max(10, o.IntervalMinutes)));
        while (!stop.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope();
                var svc = scope.ServiceProvider.GetRequiredService<GovernmentDataService>();
                if (svc.ResolveApiKey() is null) log.LogInformation("Government data sync skipped: no API key configured.");
                else
                {
                    var r = await svc.SyncAsync("schedule", stop);
                    log.LogInformation("Government data sync {Status}: {Records} records, {Stations} new stations, {Readings} new readings, {Matched} devices matched, {Switched} switched.",
                        r.Status, r.RecordsFetched, r.StationsAdded, r.ReadingsAdded, r.DevicesMatched, r.DevicesSwitched);
                }
                await timer.WaitForNextTickAsync(stop);
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { return; }
            catch (Exception ex)
            {
                log.LogWarning("Government data sync cycle failed: {Reason}", ex.GetBaseException().Message);
                try { await timer.WaitForNextTickAsync(stop); } catch (OperationCanceledException) { return; }
            }
        }
    }
}
