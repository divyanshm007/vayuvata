using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using VayuVata.Authorization;
using VayuVata.DTOs.Users;
using VayuVata.Helpers;
using VayuVata.Services;

namespace VayuVata.Controllers;

/// <summary>Users managed by a specific Admin. SuperAdmin: any Admin. Admin: only themself.</summary>
[ApiController]
[Route("api/v1/admins/{adminId:int}/users")]
[Produces("application/json")]
[Authorize(Policies.AdminOrAbove)]
[ProducesResponseType<ApiError>(401)]
[ProducesResponseType<ApiError>(403)]
public class AdminsController(UserService users) : ControllerBase
{
    private CurrentUser Me => CurrentUser.From(User);

    /// <summary>List the regular Users managed by the given Admin (paged).</summary>
    /// <remarks>An Admin may only request their own id (otherwise 403 and no data). Regular Users get 403.</remarks>
    /// <response code="200">Page of Users (`managerId` = the Admin).</response>
    /// <response code="403">Caller is a regular User, or an Admin asking for another Admin.</response>
    /// <response code="404">`adminId` is not an existing Admin.</response>
    [HttpGet]
    [ProducesResponseType<AdminUsersPage>(200)]
    [ProducesResponseType<ApiError>(404)]
    public async Task<ActionResult<AdminUsersPage>> List(int adminId, [FromQuery] ManagedUsersQuery q, CancellationToken ct) =>
        await users.ListByAdminAsync(adminId, q, Me, ct);

    /// <summary>Create a User directly under the given Admin (same creation logic as POST /users).</summary>
    /// <remarks>SuperAdmin: any active Admin. Admin: only when `adminId` is their own id. Role is always `User`.</remarks>
    /// <response code="201">User created with `managerId` = `adminId`.</response>
    /// <response code="400">Validation failed, or the Admin is inactive.</response>
    /// <response code="403">Caller is a regular User, or an Admin using another Admin's id.</response>
    /// <response code="404">`adminId` is not an existing Admin.</response>
    /// <response code="409">Email already in use.</response>
    [HttpPost]
    [ProducesResponseType<UserDto>(201)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(409)]
    public async Task<ActionResult<UserDto>> Create(int adminId, CreateManagedUserRequest req, CancellationToken ct)
    {
        var created = await users.CreateUnderAdminAsync(adminId, req, Me, ct);
        return CreatedAtAction("Get", "Users", new { id = created.Id }, created);
    }
}
