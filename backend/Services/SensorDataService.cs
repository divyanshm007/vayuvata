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
    private static IQueryable<SensorDataDto> Project(IQueryable<SensorData> q) => q.Select(s => new SensorDataDto
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
        return await Project(db.SensorData.AsNoTracking().Where(s => s.Id == row.Id)).FirstAsync(ct);
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
        return await Project(db.SensorData.AsNoTracking().Where(s => s.DeviceCode == code)
                   .OrderByDescending(s => s.RecordedAt).ThenByDescending(s => s.Id)).FirstOrDefaultAsync(ct)
               ?? throw ApiException.NotFound("No readings for this device yet.");
    }

    public async Task<PagedResult<SensorDataDto>> HistoryAsync(int deviceRecordId, HistoryQuery q, CurrentUser caller, CancellationToken ct)
    {
        var code = await AuthorizedDeviceCodeAsync(deviceRecordId, caller, ct);
        var query = ApplyRange(db.SensorData.AsNoTracking().Where(s => s.DeviceCode == code), q.From, q.To);
        var desc = !string.Equals(q.SortDir, "asc", StringComparison.OrdinalIgnoreCase);
        query = desc ? query.OrderByDescending(s => s.RecordedAt).ThenByDescending(s => s.Id)
                     : query.OrderBy(s => s.RecordedAt).ThenBy(s => s.Id);
        return await Project(query).ToPagedAsync(q, ct);
    }

    private async Task<string> AuthorizedDeviceCodeAsync(int deviceRecordId, CurrentUser caller, CancellationToken ct) =>
        await db.DataDevices(caller).Where(d => d.Id == deviceRecordId).Select(d => d.DeviceId).FirstOrDefaultAsync(ct)
        ?? throw ApiException.NotFound("Device not found.");

    private static IQueryable<SensorData> ApplyRange(IQueryable<SensorData> q, DateTime? from, DateTime? to)
    {
        if (from is { } f) { var fu = f.ToUniversalTime(); q = q.Where(s => s.RecordedAt >= fu); }
        if (to is { } t) { var tu = t.ToUniversalTime(); q = q.Where(s => s.RecordedAt <= tu); }
        return q;
    }
}
