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

public class GpsLocationService(VayuVataDbContext db, IValidator<CreateGpsLocationRequest> validator,
    Microsoft.Extensions.Options.IOptions<DeviceAuthOptions> deviceAuth, ILogger<GpsLocationService> log)
{
    /// <summary>India Standard Time: all GPS timestamps are STORED as IST wall-clock (UTC+5:30) and returned with the +05:30 offset.</summary>
    public static readonly TimeSpan Ist = TimeSpan.FromMinutes(330);

    /// <summary>UTC (or offset) instant -> IST wall-clock value as stored. A value without zone is taken as IST already.</summary>
    public static DateTime ToIstWallClock(DateTime t) => t.Kind switch
    {
        DateTimeKind.Utc => DateTime.SpecifyKind(t + Ist, DateTimeKind.Unspecified),
        DateTimeKind.Local => DateTime.SpecifyKind(t.ToUniversalTime() + Ist, DateTimeKind.Unspecified),
        _ => t,
    };

    private static DateTimeOffset AsIst(DateTime stored) => new(DateTime.SpecifyKind(stored, DateTimeKind.Unspecified), Ist);

    private record Row(long Id, string DeviceCode, DateTime RecordedAt, DateTime ReceivedAt, bool HasFix, string Source,
        decimal? Lat, decimal? Lon, decimal? AltM, decimal? SpeedKmh, byte? SignalPct);

    private static IQueryable<Row> Project(IQueryable<GpsLocationData> q) => q.Select(g => new Row(
        g.Id, g.DeviceCode, g.RecordedAt, g.ReceivedAt, g.HasFix, g.Source, g.Latitude, g.Longitude, g.AltitudeM, g.SpeedKmh, g.SignalPct));

    private static GpsLocationDto Map(Row r) => new()
    {
        Id = r.Id, DeviceId = r.DeviceCode, RecordedAt = AsIst(r.RecordedAt), ReceivedAt = AsIst(r.ReceivedAt), Fix = r.HasFix, Source = r.Source,
        Lat = r.Lat, Lon = r.Lon, AltM = r.AltM, SpeedKmh = r.SpeedKmh, SignalPct = r.SignalPct,
    };

    /// <summary>
    /// Stores one position report. Auth: X-Device-Key must match req.DeviceId's key - same rule as sensor data: the issued raw key,
    /// or the stored key hash while DeviceAuth:AcceptStoredHashAsKey is on.
    /// Unknown device or bad/missing key -> 401 (same answer, no device enumeration); inactive device -> 403.
    /// Idempotent: a repeat of (deviceId, recordedAt) is not an error - the stored report is returned with Created = false.
    /// recordedAt arrives as UTC (GPS time) and is stored as IST wall-clock.
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

        // validated as a real instant (UTC), stored as IST wall-clock
        var recorded = ToIstWallClock(DateTime.SpecifyKind(CreateGpsLocationValidator.Utc(req.RecordedAt!.Value), DateTimeKind.Utc));
        recorded = new DateTime(recorded.Ticks - recorded.Ticks % TimeSpan.TicksPerMillisecond, DateTimeKind.Unspecified);

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
        return (Map(await Project(db.GpsLocationData.AsNoTracking().Where(g => g.Id == row.Id)).FirstAsync(ct)), true);
    }

    private async Task<GpsLocationDto?> Existing(string deviceCode, DateTime recorded, CancellationToken ct) =>
        await Project(db.GpsLocationData.AsNoTracking().Where(g => g.DeviceCode == deviceCode && g.RecordedAt == recorded)).FirstOrDefaultAsync(ct) is { } r
            ? Map(r) : null;

    private bool KeyMatches(Device device, string? provided)
    {
        if (string.IsNullOrEmpty(provided) || device.ApiKeyHash is null) return false;
        var stored = Encoding.ASCII.GetBytes(device.ApiKeyHash);
        if (CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(JwtService.Hash(provided)), stored)) return true;
        // Same compatibility switch as sensor data (default off; on for UAT): the device presents the stored key hash itself.
        return deviceAuth.Value.AcceptStoredHashAsKey
            && CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(provided.Trim().ToLowerInvariant()), stored);
    }

    public async Task<PagedResult<GpsLocationDto>> QueryAsync(GpsLocationQuery q, CurrentUser caller, CancellationToken ct)
    {
        var query = db.VisibleGpsLocations(caller).AsNoTracking();
        if (!string.IsNullOrWhiteSpace(q.DeviceId)) query = query.Where(g => g.DeviceCode == q.DeviceId);
        if (q.Fix is { } fix) query = query.Where(g => g.HasFix == fix);
        if (!string.IsNullOrWhiteSpace(q.Source))
        {
            if (q.Source is not ("gps" or "cell")) throw ApiException.BadRequest("source must be 'gps' or 'cell'.");
            query = query.Where(g => g.Source == q.Source);
        }
        if (q.From is { } f) { var fi = ToIstWallClock(f); query = query.Where(g => g.RecordedAt >= fi); }
        if (q.To is { } t) { var ti = ToIstWallClock(t); query = query.Where(g => g.RecordedAt <= ti); }
        var desc = !string.Equals(q.SortDir, "asc", StringComparison.OrdinalIgnoreCase);
        query = desc ? query.OrderByDescending(g => g.RecordedAt).ThenByDescending(g => g.Id) : query.OrderBy(g => g.RecordedAt).ThenBy(g => g.Id);
        var page = await Project(query).ToPagedAsync(q, ct);
        return new PagedResult<GpsLocationDto>
        {
            Items = page.Items.Select(Map).ToList(), Page = page.Page, PageSize = page.PageSize, TotalCount = page.TotalCount, HasNextPage = page.HasNextPage,
        };
    }
}
