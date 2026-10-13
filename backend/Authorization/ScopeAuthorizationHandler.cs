using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using VayuVata.Data;
using VayuVata.Models;

namespace VayuVata.Authorization;

public class RoleRequirement(params string[] roles) : IAuthorizationRequirement
{
    public string[] Roles { get; } = roles;
}

/// <summary>Grants access when the (JWT-derived) role is one of the roles the policy allows.</summary>
public class ScopeAuthorizationHandler : AuthorizationHandler<RoleRequirement>
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext context, RoleRequirement requirement)
    {
        var role = context.User.FindFirst("role")?.Value;
        if (role != null && requirement.Roles.Contains(role)) context.Succeed(requirement);
        return Task.CompletedTask;
    }
}

/// <summary>
/// Row-level visibility rules. Every list/detail query is filtered with these so that
/// authorization is enforced in the SQL query itself (no IDOR via ids or query parameters).
/// </summary>
public static class ScopeFilters
{
    /// <summary>SuperAdmin: everyone. Admin: own Users. User: self.</summary>
    public static IQueryable<User> VisibleUsers(this VayuVataDbContext db, CurrentUser c) =>
        c.IsSuperAdmin ? db.Users
        : c.IsAdmin ? db.Users.Where(u => u.ManagerId == c.Id && u.Role == Roles.User)
        : db.Users.Where(u => u.Id == c.Id);

    /// <summary>
    /// Devices a caller can see in device APIs. SuperAdmin: all. Admin: devices assigned to their Users
    /// plus unassigned devices (the pool an Admin may assign from). User: own currently-assigned devices.
    /// </summary>
    public static IQueryable<Device> VisibleDevices(this VayuVataDbContext db, CurrentUser c) =>
        c.IsSuperAdmin ? db.Devices
        : c.IsAdmin ? db.Devices.Where(d =>
            !d.Assignments.Any(a => a.IsActive) ||
            d.Assignments.Any(a => a.IsActive && a.User.ManagerId == c.Id))
        : db.Devices.Where(d => d.Assignments.Any(a => a.IsActive && a.UserId == c.Id));

    /// <summary>Devices whose sensor data the caller may read. Unassigned devices are visible to SuperAdmin only.</summary>
    public static IQueryable<Device> DataDevices(this VayuVataDbContext db, CurrentUser c) =>
        c.IsSuperAdmin ? db.Devices
        : c.IsAdmin ? db.Devices.Where(d => d.Assignments.Any(a => a.IsActive && a.User.ManagerId == c.Id))
        : db.Devices.Where(d => d.Assignments.Any(a => a.IsActive && a.UserId == c.Id));

    /// <summary>GPS reports of devices the caller may read (same scope as sensor data).</summary>
    public static IQueryable<GpsLocationData> VisibleGpsLocations(this VayuVataDbContext db, CurrentUser c) =>
        c.IsSuperAdmin ? db.GpsLocationData
        : db.GpsLocationData.Where(g => db.DataDevices(c).Select(d => d.DeviceId).Contains(g.DeviceCode));

    public static IQueryable<SensorData> VisibleSensorData(this VayuVataDbContext db, CurrentUser c) =>
        c.IsSuperAdmin ? db.SensorData
        : db.SensorData.Where(s => db.DataDevices(c).Select(d => d.DeviceId).Contains(s.DeviceCode));
}

