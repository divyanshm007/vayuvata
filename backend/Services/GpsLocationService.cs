using System.Security.Cryptography;
using System.Text;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using VayuVata.Authorization;
using VayuVata.Data;
using VayuVata.DTOs.Gps;
using VayuVata.Helpers;
using VayuVata.Models;
using VayuVata.Validators;

namespace VayuVata.Services;

public class GpsLocationService(VayuVataDbContext db, IValidator<CreateGpsLocationRequest> validator, ILogger<GpsLocationService> log)
{
    private static IQueryable<GpsLocationDto> Project(IQueryable<GpsLocationData> q) => q.Select(g => new GpsLocationDto
    {
        Id = g.Id, DeviceId = g.DeviceCode, RecordedAt = g.RecordedAt, ReceivedAt = g.ReceivedAt, Fix = g.HasFix, Source = g.Source,
        Lat = g.Latitude, Lon = g.Longitude, AltM = g.AltitudeM, SpeedKmh = g.SpeedKmh, SignalPct = g.SignalPct,
    });

    /// <summary>
    /// Stores one position report. Auth: X-Device-Key must be the key issued for req.DeviceId (strict: the raw key only).
    /// Unknown device or bad/missing key -> 401 (same answer, no device enumeration); inactive device -> 403.
    /// Idempotent: a repeat of (deviceId, recordedAt) is not an error - the stored report is returned with Created = false.
    /// </summary>
    public async Task<(GpsLocationDto Report, bool Created)> IngestAsync(CreateGpsLocationRequest req, string? deviceKey, CancellationToken ct)
    {
        await validator.ValidateAndThrowAsync(req, ct);
        var deviceCode = req.DeviceId.Trim();
        var device = await db.Devices.AsNoTracking().FirstOrDefaultAsync(d => d.DeviceId == deviceCode, ct);
        if (device is null || !KeyMatches(device, deviceKey))
        {
            log.LogWarning("Rejected GPS submission for device {DeviceId}: bad credentials", LogRedactor.Clean(deviceCode, 64));
            throw ApiException.Unauthorized("Unknown device or invalid device key.");
        }
        if (!device.IsActive) throw ApiException.Forbidden("Device is inactive.");

        var recorded = CreateGpsLocationValidator.Utc(req.RecordedAt!.Value);
        recorded = new DateTime(recorded.Ticks - recorded.Ticks % TimeSpan.TicksPerMillisecond, DateTimeKind.Utc);

        var existing = await Existing(device.DeviceId, recorded, ct);
        if (existing is not null) return (existing, false);

        var row = new GpsLocationData
        {
            DeviceCode = device.DeviceId, RecordedAt = recorded, HasFix = req.Fix!.Value, Source = req.Source,
            Latitude = req.Lat, Longitude = req.Lon, AltitudeM = req.AltM, SpeedKmh = req.SpeedKmh,
            SignalPct = req.SignalPct is { } s ? (byte)s : null,
        };
        db.GpsLocationData.Add(row);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException ex) when (SqlErrors.IsUniqueViolation(ex))
        {
            // Two uploads of the same report raced: the other one won; return what it stored.
            var won = await Existing(device.DeviceId, recorded, ct);
            if (won is not null) return (won, false);
            throw;
        }
        return (await Project(db.GpsLocationData.AsNoTracking().Where(g => g.Id == row.Id)).FirstAsync(ct), true);
    }

    private Task<GpsLocationDto?> Existing(string deviceCode, DateTime recorded, CancellationToken ct) =>
        Project(db.GpsLocationData.AsNoTracking().Where(g => g.DeviceCode == deviceCode && g.RecordedAt == recorded)).FirstOrDefaultAsync(ct);

    private static bool KeyMatches(Device device, string? provided)
    {
        if (string.IsNullOrEmpty(provided) || device.ApiKeyHash is null) return false;
        return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(JwtService.Hash(provided)), Encoding.ASCII.GetBytes(device.ApiKeyHash));
    }

    public Task<PagedResult<GpsLocationDto>> QueryAsync(GpsLocationQuery q, CurrentUser caller, CancellationToken ct)
    {
        var query = db.VisibleGpsLocations(caller).AsNoTracking();
        if (!string.IsNullOrWhiteSpace(q.DeviceId)) query = query.Where(g => g.DeviceCode == q.DeviceId);
        if (q.Fix is { } fix) query = query.Where(g => g.HasFix == fix);
        if (!string.IsNullOrWhiteSpace(q.Source))
        {
            if (q.Source is not ("gps" or "cell")) throw ApiException.BadRequest("source must be 'gps' or 'cell'.");
            query = query.Where(g => g.Source == q.Source);
        }
        if (q.From is { } f) { var fu = f.ToUniversalTime(); query = query.Where(g => g.RecordedAt >= fu); }
        if (q.To is { } t) { var tu = t.ToUniversalTime(); query = query.Where(g => g.RecordedAt <= tu); }
        var desc = !string.Equals(q.SortDir, "asc", StringComparison.OrdinalIgnoreCase);
        query = desc ? query.OrderByDescending(g => g.RecordedAt).ThenByDescending(g => g.Id) : query.OrderBy(g => g.RecordedAt).ThenBy(g => g.Id);
        return Project(query).ToPagedAsync(q, ct);
    }
}
