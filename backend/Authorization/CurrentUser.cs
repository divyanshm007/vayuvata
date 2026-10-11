using System.Security.Claims;
using VayuVata.Models;

namespace VayuVata.Authorization;

/// <summary>Identity of the caller, taken only from the validated JWT (never from request bodies).</summary>
public record CurrentUser(int Id, string Role)
{
    public bool IsSuperAdmin => Role == Roles.SuperAdmin;
    public bool IsAdmin => Role == Roles.Admin;
    public bool IsUser => Role == Roles.User;

    public static CurrentUser From(ClaimsPrincipal p)
    {
        var id = p.FindFirstValue("sub");
        var role = p.FindFirstValue("role");
        if (!int.TryParse(id, out var uid) || role is null)
            throw Helpers.ApiException.Unauthorized();
        return new CurrentUser(uid, role);
    }
}
