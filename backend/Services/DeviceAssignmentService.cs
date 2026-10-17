using FluentValidation;
using Microsoft.EntityFrameworkCore;
using VayuVata.Authorization;
using VayuVata.Data;
using VayuVata.DTOs.Devices;
using VayuVata.Helpers;
using VayuVata.Models;

namespace VayuVata.Services;

public class DeviceAssignmentService(
    VayuVataDbContext db, DeviceService devices,
    IValidator<AssignDeviceRequest> assignValidator, ILogger<DeviceAssignmentService> log)
{
    /// <summary>
    /// Assigns (or reassigns) a device. The previous active assignment is closed, never deleted.
    /// The filtered unique index UX_DeviceAssignments_ActiveDevice makes concurrent double-assignment impossible.
    /// </summary>
    public async Task<DeviceDto> AssignAsync(int deviceRecordId, AssignDeviceRequest req, CurrentUser caller, CancellationToken ct)
    {
        if (caller.IsUser) throw ApiException.Forbidden();
        await assignValidator.ValidateAndThrowAsync(req, ct);

        // Device must be inside the caller's scope (Admin: assigned to themselves or to one of their Users).
        var device = await db.VisibleDevices(caller).FirstOrDefaultAsync(d => d.Id == deviceRecordId, ct)
                     ?? throw ApiException.NotFound("Device not found.");
        if (!device.IsActive) throw ApiException.Conflict("Device is inactive.", "device_inactive");

        var target = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == req.UserId, ct)
                     ?? throw ApiException.NotFound("Target user not found.");
        if (caller.IsAdmin && (target.ManagerId != caller.Id || target.Role != Roles.User))
            throw ApiException.Forbidden("The target user is outside your scope.");
        if (target.Role != Roles.User && target.Role != Roles.Admin)
            throw ApiException.BadRequest("Devices can only be assigned to Users or Admins.");
        if (!target.IsActive) throw ApiException.Conflict("Target user is inactive.", "user_inactive");

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        try
        {
            var now = DateTime.UtcNow;
            var current = await db.DeviceAssignments.FirstOrDefaultAsync(a => a.DeviceRecordId == device.Id && a.IsActive, ct);
            if (current?.UserId == target.Id)
                throw ApiException.Conflict("Device is already assigned to this user.", "already_assigned");
            if (current != null)
            {
                current.IsActive = false;
                current.UnassignedAt = now;
                await db.SaveChangesAsync(ct);   // close the old row before inserting the new active one
            }

            db.DeviceAssignments.Add(new DeviceAssignment
            {
                DeviceRecordId = device.Id, UserId = target.Id, AssignedByUserId = caller.Id,
                AssignedAt = now, IsActive = true, Notes = req.Notes?.Trim(),
            });
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (DbUpdateException ex) when (SqlErrors.IsUniqueViolation(ex))
        {
            throw ApiException.Conflict("The device was assigned concurrently; retry.", "assignment_conflict");
        }
        log.LogInformation("Device {DeviceId} assigned to user {UserId} by {CallerId}", device.DeviceId, target.Id, caller.Id);
        return await devices.GetAsync(device.Id, caller, ct);
    }

    public async Task<DeviceDto> UnassignAsync(int deviceRecordId, UnassignDeviceRequest? req, CurrentUser caller, CancellationToken ct)
    {
        // Taking a device out of circulation is a SuperAdmin decision. An Admin passes a device on to one of their Users (assign) but never releases it.
        if (!caller.IsSuperAdmin) throw ApiException.Forbidden("Only the SuperAdmin can unassign a device.");
        var device = await db.VisibleDevices(caller).FirstOrDefaultAsync(d => d.Id == deviceRecordId, ct)
                     ?? throw ApiException.NotFound("Device not found.");
        var current = await db.DeviceAssignments.Include(a => a.User)
                          .FirstOrDefaultAsync(a => a.DeviceRecordId == device.Id && a.IsActive, ct)
                      ?? throw ApiException.Conflict("Device is not currently assigned.", "not_assigned");
        // An Admin may release devices of their own Users and devices assigned to themselves.
        if (caller.IsAdmin && current.User.ManagerId != caller.Id && current.UserId != caller.Id) throw ApiException.NotFound("Device not found.");

        current.IsActive = false;
        current.UnassignedAt = DateTime.UtcNow;
        if (!string.IsNullOrWhiteSpace(req?.Notes))
            current.Notes = string.IsNullOrEmpty(current.Notes) ? req.Notes.Trim() : $"{current.Notes} | {req.Notes.Trim()}";
        await db.SaveChangesAsync(ct);
        log.LogInformation("Device {DeviceId} unassigned by {CallerId}", device.DeviceId, caller.Id);
        return await devices.GetAsync(device.Id, caller, ct);
    }

    /// <summary>Full assignment history. Admins only see entries for their own Users.</summary>
    public async Task<PagedResult<AssignmentDto>> HistoryAsync(int deviceRecordId, PageQuery page, CurrentUser caller, CancellationToken ct)
    {
        if (caller.IsUser) throw ApiException.Forbidden();
        if (!await db.VisibleDevices(caller).AnyAsync(d => d.Id == deviceRecordId, ct))
            throw ApiException.NotFound("Device not found.");

        var q = db.DeviceAssignments.AsNoTracking().Where(a => a.DeviceRecordId == deviceRecordId);
        if (caller.IsAdmin) q = q.Where(a => a.User.ManagerId == caller.Id || a.UserId == caller.Id);
        return await q.OrderByDescending(a => a.AssignedAt).ThenByDescending(a => a.Id)
            .Select(a => new AssignmentDto
            {
                Id = a.Id, DeviceRecordId = a.DeviceRecordId, DeviceId = a.Device.DeviceId,
                UserId = a.UserId, UserName = a.User.Name,
                AssignedByUserId = a.AssignedByUserId, AssignedByName = a.AssignedBy.Name,
                AssignedAt = a.AssignedAt, UnassignedAt = a.UnassignedAt, IsActive = a.IsActive, Notes = a.Notes,
            }).ToPagedAsync(page, ct);
    }
}

