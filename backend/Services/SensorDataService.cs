using System.Security.Cryptography;
using System.Text;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using VayuVata.Authorization;
using VayuVata.Data;
using VayuVata.DTOs.SensorData;
using VayuVata.Helpers;
using VayuVata.Models;

namespace VayuVata.Services;

public class SensorDataService(
    VayuVataDbContext db, IValidator<CreateSensorDataRequest> validator,
    IConfiguration config, IWebHostEnvironment env, Microsoft.Extensions.Options.IOptions<IngestOptions> ingest,
    Microsoft.Extensions.Options.IOptions<DeviceAuthOptions> deviceAuth, ILogger<SensorDataService> log)
{
    private static IQueryable<SensorDataDto> Project(IQueryable<ManipulatedSensorData> q) => q.Select(s => new SensorDataDto
    {
        Id = s.Id, DeviceId = s.DeviceCode, DataDate = s.DataDate, DataTime = s.DataTime, RecordedAt = s.RecordedAt,
        Aqi = s.Aqi, AqiStatus = s.AqiStatus, Pm10 = s.Pm10, Pm25 = s.Pm25, No2Ppm = s.No2Ppm, So2Ppm = s.So2Ppm,
        CoPpm = s.CoPpm, TvocPpb = s.TvocPpb, Humidity = s.Humidity, Temperature = s.Temperature,
        OuterTemperature = s.OuterTemperature, OuterHumidity = s.OuterHumidity, CreatedAt = s.CreatedAt,
    });

    /// <summary>
    /// Ingests a reading. Auth: X-Device-Key must match the stored hash for req.DeviceId.
    /// Unknown device or bad/missing key -> 401 (same answer, no device enumeration); inactive device -> 403.
    /// </summary>
    public async Task<SensorDataDto> IngestAsync(CreateSensorDataRequest req, string? deviceKey, CancellationToken ct)
    {
        await validator.ValidateAndThrowAsync(req, ct);
        var device = await db.Devices.AsNoTracking().FirstOrDefaultAsync(d => d.DeviceId == req.DeviceId.Trim(), ct);

        var devModeAllowsMissingKey = env.IsDevelopment() && config.GetValue<bool>("DeviceAuth:AllowMissingKeyInDevelopment");
        if (device is null || !KeyMatches(device, deviceKey, devModeAllowsMissingKey))
        {
            log.LogWarning("Rejected sensor submission for device {DeviceId}: bad credentials", req.DeviceId);
            throw ApiException.Unauthorized("Unknown device or invalid device key.");
        }
        if (!device.IsActive) throw ApiException.Forbidden("Device is inactive.");

        // The device clock reports IST wall-clock time; a supplied recordedAt is stored exactly as sent (no zone conversion),
        // and an omitted one is stamped with the same convention. Both match the behaviour the live ESP32 integration relies on.
        var recorded = req.RecordedAt is { } r ? r : DateTime.UtcNow.AddMinutes(ingest.Value.MissingRecordedAtOffsetMinutes);
        recorded = new DateTime(recorded.Ticks - recorded.Ticks % TimeSpan.TicksPerMillisecond, DateTimeKind.Utc);

        if (await db.SensorData.AnyAsync(s => s.DeviceCode == device.DeviceId && s.RecordedAt == recorded, ct))
            throw ApiException.Conflict("A reading for this device at this recordedAt already exists.", "duplicate_reading");

        var row = new SensorData
        {
            DeviceCode = device.DeviceId,
            RecordedAt = recorded,
            DataDate = req.DataDate ?? DateOnly.FromDateTime(recorded),
            DataTime = req.DataTime ?? TimeOnly.FromDateTime(recorded),
            Aqi = req.Aqi, AqiStatus = req.AqiStatus?.Trim(),
            Pm10 = req.Pm10, Pm25 = req.Pm25, No2Ppm = req.No2Ppm, So2Ppm = req.So2Ppm, CoPpm = req.CoPpm,
            TvocPpb = req.TvocPpb, Humidity = req.Humidity, Temperature = req.Temperature,
            OuterTemperature = req.OuterTemperature, OuterHumidity = req.OuterHumidity,
        };
        db.SensorData.Add(row);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException ex) when (SqlErrors.IsUniqueViolation(ex))
        {
            throw ApiException.Conflict("A reading for this device at this recordedAt already exists.", "duplicate_reading");
        }
        // The AFTER INSERT trigger has already written the processed row in the same transaction; the response shows that
        // row (calculated AQI), never the raw dbo.SensorData row.
        return await Project(db.ManipulatedSensorData.AsNoTracking().Where(s => s.Id == row.Id)).FirstAsync(ct);
    }

    private bool KeyMatches(Device device, string? provided, bool devModeAllowsMissingKey)
    {
        if (string.IsNullOrEmpty(provided)) return devModeAllowsMissingKey;
        if (device.ApiKeyHash is null) return false;
        var stored = Encoding.ASCII.GetBytes(device.ApiKeyHash);
        if (CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(JwtService.Hash(provided)), stored)) return true;
        // Compatibility switch (default off): the live device presents the stored key hash itself. See DeviceAuthOptions.
        return deviceAuth.Value.AcceptStoredHashAsKey
            && CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(provided.Trim().ToLowerInvariant()), stored);
    }

    public Task<PagedResult<SensorDataDto>> QueryAsync(SensorDataQuery q, CurrentUser caller, CancellationToken ct)
    {
        var query = db.VisibleSensorData(caller).AsNoTracking();
        if (!string.IsNullOrWhiteSpace(q.DeviceId)) query = query.Where(s => s.DeviceCode == q.DeviceId);
        query = ApplyRange(query, q.From, q.To);
        var desc = !string.Equals(q.SortDir, "asc", StringComparison.OrdinalIgnoreCase);
        query = q.SortBy.ToLowerInvariant() switch
        {
            "aqi" => desc ? query.OrderByDescending(s => s.Aqi).ThenByDescending(s => s.Id) : query.OrderBy(s => s.Aqi).ThenBy(s => s.Id),
            "createdat" => desc ? query.OrderByDescending(s => s.CreatedAt).ThenByDescending(s => s.Id) : query.OrderBy(s => s.CreatedAt).ThenBy(s => s.Id),
            "recordedat" => desc ? query.OrderByDescending(s => s.RecordedAt).ThenByDescending(s => s.Id) : query.OrderBy(s => s.RecordedAt).ThenBy(s => s.Id),
            _ => throw ApiException.BadRequest("sortBy must be one of: recordedAt, createdAt, aqi."),
        };
        return Project(query).ToPagedAsync(q, ct);
    }

    public async Task<SensorDataDto> GetAsync(long id, CurrentUser caller, CancellationToken ct) =>
        await Project(db.VisibleSensorData(caller).AsNoTracking().Where(s => s.Id == id)).FirstOrDefaultAsync(ct)
        ?? throw ApiException.NotFound("Reading not found.");

    public async Task<SensorDataDto> LatestAsync(int deviceRecordId, CurrentUser caller, CancellationToken ct)
    {
        var code = await AuthorizedDeviceCodeAsync(deviceRecordId, caller, ct);
        return await Project(db.ManipulatedSensorData.AsNoTracking().Where(s => s.DeviceCode == code)
                   .OrderByDescending(s => s.RecordedAt).ThenByDescending(s => s.Id)).FirstOrDefaultAsync(ct)
               ?? throw ApiException.NotFound("No readings for this device yet.");
    }

    public async Task<PagedResult<SensorDataDto>> HistoryAsync(int deviceRecordId, HistoryQuery q, CurrentUser caller, CancellationToken ct)
    {
        var code = await AuthorizedDeviceCodeAsync(deviceRecordId, caller, ct);
        var query = ApplyRange(db.ManipulatedSensorData.AsNoTracking().Where(s => s.DeviceCode == code), q.From, q.To);
        var desc = !string.Equals(q.SortDir, "asc", StringComparison.OrdinalIgnoreCase);
        query = desc ? query.OrderByDescending(s => s.RecordedAt).ThenByDescending(s => s.Id)
                     : query.OrderBy(s => s.RecordedAt).ThenBy(s => s.Id);
        return await Project(query).ToPagedAsync(q, ct);
    }

    /// <summary>
    /// Chart series for one device. Up to <c>Points</c> readings are returned as they are; a longer range is averaged into equal time buckets
    /// (computed in SQL, so the browser never downloads the raw rows) and therefore always covers the WHOLE range, not just its newest readings.
    /// </summary>
    public async Task<SensorSeriesResult> SeriesAsync(SensorSeriesQuery q, CurrentUser caller, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(q.DeviceId)) throw ApiException.BadRequest("deviceId is required.");
        var code = q.DeviceId.Trim();
        var max = Math.Clamp(q.Points, 50, 1000);
        var query = ApplyRange(db.VisibleSensorData(caller).AsNoTracking().Where(s => s.DeviceCode == code), q.From, q.To);

        var stats = await query.GroupBy(_ => 1).Select(g => new { Count = g.Count(), Min = g.Min(s => s.RecordedAt), Max = g.Max(s => s.RecordedAt) }).FirstOrDefaultAsync(ct);
        if (stats is null || stats.Count == 0) return new SensorSeriesResult { BucketMinutes = 1 };

        if (stats.Count <= max)
        {
            var raw = await Project(query.OrderBy(s => s.RecordedAt).ThenBy(s => s.Id)).ToListAsync(ct);
            return new SensorSeriesResult { Points = raw, BucketMinutes = 1, TotalReadings = stats.Count };
        }

        var span = (stats.Max - stats.Min).TotalMinutes;
        var bucket = Math.Max(2, (int)Math.Ceiling(span / max));
        var origin = stats.Min;
        var rows = await query
            .GroupBy(s => EF.Functions.DateDiffMinute(origin, s.RecordedAt) / bucket)
            .Select(g => new
            {
                Key = g.Key, At = g.Min(s => s.RecordedAt), Aqi = g.Average(s => (double?)s.Aqi),
                Pm10 = g.Average(s => s.Pm10), Pm25 = g.Average(s => s.Pm25), No2 = g.Average(s => s.No2Ppm), So2 = g.Average(s => s.So2Ppm),
                Co = g.Average(s => s.CoPpm), Tvoc = g.Average(s => s.TvocPpb), Hum = g.Average(s => s.Humidity), Temp = g.Average(s => s.Temperature),
                OTemp = g.Average(s => s.OuterTemperature), OHum = g.Average(s => s.OuterHumidity),
            }).OrderBy(g => g.Key).ToListAsync(ct);

        static decimal? R(decimal? v, int d = 2) => v is null ? null : Math.Round(v.Value, d);
        var points = rows.Select(r =>
        {
            int? aqi = r.Aqi is null ? null : (int)Math.Round(r.Aqi.Value);
            return new SensorDataDto
            {
                Id = r.Key, DeviceId = code, RecordedAt = DateTime.SpecifyKind(r.At, DateTimeKind.Utc),
                DataDate = DateOnly.FromDateTime(r.At), DataTime = TimeOnly.FromDateTime(r.At), CreatedAt = DateTime.SpecifyKind(r.At, DateTimeKind.Utc),
                Aqi = aqi, AqiStatus = aqi is null ? null : IndiaAqi.Status(aqi.Value),
                Pm10 = R(r.Pm10), Pm25 = R(r.Pm25), No2Ppm = R(r.No2, 4), So2Ppm = R(r.So2, 4), CoPpm = R(r.Co, 4), TvocPpb = R(r.Tvoc),
                Humidity = R(r.Hum), Temperature = R(r.Temp), OuterTemperature = R(r.OTemp), OuterHumidity = R(r.OHum),
            };
        }).ToList();
        return new SensorSeriesResult { Points = points, BucketMinutes = bucket, TotalReadings = stats.Count };
    }

    private async Task<string> AuthorizedDeviceCodeAsync(int deviceRecordId, CurrentUser caller, CancellationToken ct) =>
        await db.DataDevices(caller).Where(d => d.Id == deviceRecordId).Select(d => d.DeviceId).FirstOrDefaultAsync(ct)
        ?? throw ApiException.NotFound("Device not found.");

    private static IQueryable<ManipulatedSensorData> ApplyRange(IQueryable<ManipulatedSensorData> q, DateTime? from, DateTime? to)
    {
        if (from is { } f) { var fu = AsStoredWallClock(f); q = q.Where(s => s.RecordedAt >= fu); }
        if (to is { } t) { var tu = AsStoredWallClock(t); q = q.Where(s => s.RecordedAt <= tu); }
        return q;
    }

    /// <summary>
    /// Readings are stored as IST wall-clock labelled UTC (what the device sends). A filter time WITHOUT a zone (what the panel sends, e.g. 2026-10-18T01:37:00)
    /// is therefore compared as typed; it must never go through the SERVER's local time zone, which shifted the filter by the host's offset (5:30 on an IST PC, 0 on the UTC server).
    /// A time with an explicit zone is converted to UTC as before.
    /// </summary>
    internal static DateTime AsStoredWallClock(DateTime t) => t.Kind switch
    {
        DateTimeKind.Unspecified => DateTime.SpecifyKind(t, DateTimeKind.Utc),
        DateTimeKind.Local => t.ToUniversalTime(),
        _ => t,
    };
}
