using System.Security.Cryptography;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using VayuVata.Authorization;
using VayuVata.Data;
using VayuVata.DTOs.Devices;
using VayuVata.Helpers;
using VayuVata.Models;

namespace VayuVata.Services;

public class DeviceService(
    VayuVataDbContext db,
    IValidator<CreateDeviceRequest> createValidator,
    IValidator<UpdateDeviceRequest> updateValidator,
    ILogger<DeviceService> log)
{
    private static IQueryable<DeviceDto> Project(IQueryable<Device> q) => q.Select(d => new DeviceDto
    {
        Id = d.Id, DeviceId = d.DeviceId, DeviceName = d.DeviceName, Description = d.Description,
        IsActive = d.IsActive, CreatedAt = d.CreatedAt, UpdatedAt = d.UpdatedAt,
        AssignedUserId = d.Assignments.Where(a => a.IsActive).Select(a => (int?)a.UserId).FirstOrDefault(),
        AssignedUserName = d.Assignments.Where(a => a.IsActive).Select(a => a.User.Name).FirstOrDefault(),
        AssignedAt = d.Assignments.Where(a => a.IsActive).Select(a => (DateTime?)a.AssignedAt).FirstOrDefault(),
    });

    /// <summary>Random device API key, e.g. "vv_Zk3...". Shown to the operator once; only its hash is stored.</summary>
    private static (string Raw, string Hash) NewApiKey()
    {
        var raw = "vv_" + Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');
        return (raw, JwtService.Hash(raw));
    }

    public async Task<DeviceWithKeyDto> CreateAsync(CreateDeviceRequest req, CurrentUser caller, CancellationToken ct)
    {
        await createValidator.ValidateAndThrowAsync(req, ct);
        var deviceId = req.DeviceId.Trim();
        if (await db.Devices.AnyAsync(d => d.DeviceId == deviceId, ct))
            throw ApiException.Conflict("A device with this DeviceId is already registered.", "device_exists");

        var (raw, hash) = NewApiKey();
        var device = new Device
        {
            DeviceId = deviceId, DeviceName = req.DeviceName.Trim(),
            Description = req.Description?.Trim(), ApiKeyHash = hash,
        };
        db.Devices.Add(device);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException ex) when (SqlErrors.IsUniqueViolation(ex))
        {
            throw ApiException.Conflict("A device with this DeviceId is already registered.", "device_exists");
        }
        log.LogInformation("Device {DeviceId} registered by {CallerId}", deviceId, caller.Id);
        return WithKey(await GetAsync(device.Id, caller, ct), raw);
    }

    public Task<PagedResult<DeviceDto>> ListAsync(DeviceQuery q, CurrentUser caller, CancellationToken ct)
    {
        var query = db.VisibleDevices(caller).AsNoTracking();
        if (q.IsActive != null) query = query.Where(d => d.IsActive == q.IsActive);
        if (q.Assigned != null)
            query = q.Assigned == true
                ? query.Where(d => d.Assignments.Any(a => a.IsActive))
                : query.Where(d => !d.Assignments.Any(a => a.IsActive));
        if (!string.IsNullOrWhiteSpace(q.Search))
        {
            var s = q.Search.Trim();
            query = query.Where(d => d.DeviceId.Contains(s) || d.DeviceName.Contains(s));
        }
        return Project(query.OrderBy(d => d.Id)).ToPagedAsync(q, ct);
    }

    public async Task<DeviceDto> GetAsync(int id, CurrentUser caller, CancellationToken ct) =>
        await Project(db.VisibleDevices(caller).AsNoTracking().Where(d => d.Id == id)).FirstOrDefaultAsync(ct)
        ?? throw ApiException.NotFound("Device not found.");

    public async Task<DeviceDto> UpdateAsync(int id, UpdateDeviceRequest req, CurrentUser caller, CancellationToken ct)
    {
        await updateValidator.ValidateAndThrowAsync(req, ct);
        var device = await db.Devices.FindAsync([id], ct) ?? throw ApiException.NotFound("Device not found.");
        device.DeviceName = req.DeviceName.Trim();
        device.Description = req.Description?.Trim();
        device.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return await GetAsync(id, caller, ct);
    }

    public async Task<DeviceDto> SetStatusAsync(int id, SetDeviceStatusRequest req, CurrentUser caller, CancellationToken ct)
    {
        var device = await db.Devices.FindAsync([id], ct) ?? throw ApiException.NotFound("Device not found.");
        device.IsActive = req.IsActive;
        device.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        log.LogInformation("Device {Id} active={Active} set by {CallerId}", id, req.IsActive, caller.Id);
        return await GetAsync(id, caller, ct);
    }

    /// <summary>Stored key hash for flashing a device. SuperAdmin only (enforced by the controller policy); every view is logged.</summary>
    public async Task<DeviceKeyHashDto> GetKeyHashAsync(int id, CurrentUser caller, CancellationToken ct)
    {
        var d = await db.Devices.AsNoTracking().Where(x => x.Id == id)
            .Select(x => new DeviceKeyHashDto { Id = x.Id, DeviceId = x.DeviceId, ApiKeyHash = x.ApiKeyHash })
            .FirstOrDefaultAsync(ct) ?? throw ApiException.NotFound("Device not found.");
        log.LogInformation("Device {Id} key hash viewed by {CallerId}", id, caller.Id);
        return d;
    }

    /// <summary>Issues a new API key and invalidates the previous one immediately.</summary>
    public async Task<DeviceWithKeyDto> RotateKeyAsync(int id, CurrentUser caller, CancellationToken ct)
    {
        var device = await db.Devices.FindAsync([id], ct) ?? throw ApiException.NotFound("Device not found.");
        var (raw, hash) = NewApiKey();
        device.ApiKeyHash = hash;
        device.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        log.LogInformation("Device {Id} API key rotated by {CallerId}", id, caller.Id);
        return WithKey(await GetAsync(id, caller, ct), raw);
    }

    private const decimal OuterWarnPercent = 20, OuterFailPercent = 80;
    private const int OuterMinSamples = 10;

    /// <summary>
    /// Health of the caller's devices from their last hour of readings (IST wall-clock): offline, or the RS485 outer sensor missing from many readings.
    /// Same visibility as sensor data: SuperAdmin all, Admin their own and their Users' devices, User their own.
    /// </summary>
    public async Task<List<DeviceHealthDto>> HealthAsync(CurrentUser caller, CancellationToken ct)
    {
        var devs = await db.DataDevices(caller).AsNoTracking().Where(d => d.IsActive).OrderBy(d => d.DeviceId)
            .Select(d => new { d.Id, d.DeviceId, d.DeviceName }).ToListAsync(ct);
        var codes = devs.Select(d => d.DeviceId).ToList();
        var from = DateTime.UtcNow.AddMinutes(330).AddMinutes(-60);
        var hour = await db.ManipulatedSensorData.AsNoTracking().Where(s => codes.Contains(s.DeviceCode) && s.RecordedAt >= from)
            .GroupBy(s => s.DeviceCode)
            .Select(g => new { Code = g.Key, N = g.Count(), Missing = g.Count(s => s.OuterTemperature == null || s.OuterHumidity == null) }).ToListAsync(ct);
        var last = await db.ManipulatedSensorData.AsNoTracking().Where(s => codes.Contains(s.DeviceCode))
            .GroupBy(s => s.DeviceCode).Select(g => new { Code = g.Key, At = g.Max(s => s.RecordedAt) }).ToListAsync(ct);

        return devs.Select(d =>
        {
            var h = hour.FirstOrDefault(x => x.Code == d.DeviceId);
            var l = last.FirstOrDefault(x => x.Code == d.DeviceId)?.At;
            var dto = new DeviceHealthDto
            {
                Id = d.Id, DeviceId = d.DeviceId, DeviceName = d.DeviceName, LastReadingAt = l,
                ReadingsLastHour = h?.N ?? 0, OuterMissingLastHour = h?.Missing ?? 0,
            };
            if (h is null || h.N == 0)
            {
                dto.Status = "offline";
                dto.Message = l is null ? "This device has not reported any readings yet."
                    : $"No readings in the last hour (last reading {l:dd MMM yyyy HH:mm} IST). Check power, Wi-Fi or SIM.";
                return dto;
            }
            dto.OuterMissingPercent = Math.Round(100m * h.Missing / h.N, 1);
            if (h.N >= OuterMinSamples && dto.OuterMissingPercent >= OuterFailPercent)
            {
                dto.Status = "failing";
                dto.Message = $"Outer temperature / humidity are missing in {dto.OuterMissingPercent:0}% of the last {h.N} readings. The RS485 outer sensor is not answering reliably: check its wiring (A/B, ground, termination) and power.";
            }
            else if (h.N >= OuterMinSamples && dto.OuterMissingPercent >= OuterWarnPercent)
            {
                dto.Status = "warning";
                dto.Message = $"Outer temperature / humidity are missing in {dto.OuterMissingPercent:0}% of the last {h.N} readings (intermittent RS485 problem).";
            }
            return dto;
        }).ToList();
    }

    public async Task<PagedResult<DeviceDto>> ListForUserAsync(int userId, PageQuery page, CurrentUser caller, CancellationToken ct)
    {
        if (!await db.VisibleUsers(caller).AnyAsync(u => u.Id == userId, ct))
            throw ApiException.NotFound("User not found.");
        var query = db.Devices.AsNoTracking().Where(d => d.Assignments.Any(a => a.IsActive && a.UserId == userId));
        return await Project(query.OrderBy(d => d.Id)).ToPagedAsync(page, ct);
    }

    private static DeviceWithKeyDto WithKey(DeviceDto d, string key) => new()
    {
        Id = d.Id, DeviceId = d.DeviceId, DeviceName = d.DeviceName, Description = d.Description,
        IsActive = d.IsActive, CreatedAt = d.CreatedAt, UpdatedAt = d.UpdatedAt,
        AssignedUserId = d.AssignedUserId, AssignedUserName = d.AssignedUserName, AssignedAt = d.AssignedAt,
        ApiKey = key,
    };
}
