using Microsoft.AspNetCore.Authorization;
using VayuVata.Models;

namespace VayuVata.Authorization;

public static class Policies
{
    public const string SuperAdminOnly = "SuperAdminOnly";
    public const string AdminOrAbove = "AdminOrAbove";
    public const string AnyRole = "AnyRole";

    public static void Register(AuthorizationOptions o)
    {
        o.AddPolicy(SuperAdminOnly, p => p.AddRequirements(new RoleRequirement(Roles.SuperAdmin)));
        o.AddPolicy(AdminOrAbove, p => p.AddRequirements(new RoleRequirement(Roles.SuperAdmin, Roles.Admin)));
        o.AddPolicy(AnyRole, p => p.AddRequirements(new RoleRequirement(Roles.All)));
    }
}
