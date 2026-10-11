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
