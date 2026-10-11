using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using VayuVata.Authorization;
using VayuVata.DTOs.Devices;
using VayuVata.DTOs.Users;
using VayuVata.Helpers;
using VayuVata.Services;

namespace VayuVata.Controllers;

/// <summary>
/// User management. SuperAdmin: everyone. Admin: own Users (ManagerId = their id). User: own profile only.
/// A regular User's <c>managerId</c> is an Admin (Admin-managed) or the SuperAdmin (standalone).
/// </summary>
[ApiController]
[Route("api/v1/users")]
[Produces("application/json")]
[Authorize(Policies.AnyRole)]
[ProducesResponseType<ApiError>(401)]
[ProducesResponseType<ApiError>(403)]
public class UsersController(UserService users, DeviceService devices) : ControllerBase
{
    private CurrentUser Me => CurrentUser.From(User);

    /// <summary>Create an account.</summary>
    /// <remarks>
    /// * **SuperAdmin → Admin:** `role: "Admin"` (ManagerId = NULL).
    /// * **SuperAdmin → standalone User:** `role: "User"`, no `managerId` → ManagerId is set to the SuperAdmin's own id.
    /// * **SuperAdmin → User under an Admin:** `role: "User"`, `managerId` = an active Admin's id.
    /// * **Admin → User:** `role: "User"`; the manager is always the authenticated Admin (a different `managerId` is rejected with 403).
    /// * Admins cannot create Admins; nobody can create a SuperAdmin through the API.
    /// </remarks>
    /// <response code="201">Account created.</response>
    /// <response code="400">Validation failed, or `managerId` is not an active Admin / the SuperAdmin.</response>
    /// <response code="403">Caller may not create this kind of account.</response>
    /// <response code="409">Email already in use.</response>
    [HttpPost, Authorize(Policies.AdminOrAbove)]
    [ProducesResponseType<UserDto>(201)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(409)]
    public async Task<ActionResult<UserDto>> Create(CreateUserRequest req, CancellationToken ct)
    {
        var created = await users.CreateAsync(req, Me, ct);
        return CreatedAtAction(nameof(Get), new { id = created.Id }, created);
    }

    /// <summary>List accounts in the caller's scope (paged).</summary>
    /// <remarks>
    /// SuperAdmin: all accounts; filters `role`, `managerId`, `standalone`, `isActive`, `search`.
    /// Admin: only Users with ManagerId = their own id; `managerId` (other than their own) and `standalone` are rejected with 403.
    /// </remarks>
    [HttpGet, Authorize(Policies.AdminOrAbove)]
    [ProducesResponseType<PagedResult<UserDto>>(200)]
    [ProducesResponseType<ApiError>(400)]
    public async Task<ActionResult<PagedResult<UserDto>>> List([FromQuery] UserQuery q, CancellationToken ct) =>
        await users.ListAsync(q, Me, ct);

    /// <summary>Get one user (404 when outside the caller's scope).</summary>
    [HttpGet("{id:int}")]
    [ProducesResponseType<UserDto>(200)]
    [ProducesResponseType<ApiError>(404)]
    public async Task<ActionResult<UserDto>> Get(int id, CancellationToken ct) => await users.GetAsync(id, Me, ct);

    /// <summary>Update name and email. Role and manager cannot be changed here.</summary>
    [HttpPut("{id:int}"), Authorize(Policies.AdminOrAbove)]
    [ProducesResponseType<UserDto>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(409)]
    public async Task<ActionResult<UserDto>> Update(int id, UpdateUserRequest req, CancellationToken ct) =>
        await users.UpdateAsync(id, req, Me, ct);

    /// <summary>Activate or deactivate a user. The last active SuperAdmin is protected (409).</summary>
    [HttpPatch("{id:int}/status"), Authorize(Policies.AdminOrAbove)]
    [ProducesResponseType<UserDto>(200)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(409)]
    public async Task<ActionResult<UserDto>> SetStatus(int id, SetStatusRequest req, CancellationToken ct) =>
        await users.SetStatusAsync(id, req, Me, ct);

    /// <summary>SuperAdmin only: change a regular User's manager.</summary>
    /// <remarks>
    /// `managerId` is required. Send an **active Admin's id** to assign the User to that Admin, or the **SuperAdmin's own id** to make the
    /// User standalone. `null` does not mean standalone and is rejected. Admin and SuperAdmin accounts cannot be assigned.
    /// The User's devices, device assignments and sensor history are preserved; only visibility follows the new manager.
    /// </remarks>
    /// <response code="200">Updated user including the manager relationship (`managerId`, `managerRole`, `assignmentType`).</response>
    /// <response code="400">Target is not a regular User, or `managerId` is missing / not an active Admin / not the SuperAdmin.</response>
    /// <response code="404">User not found.</response>
    [HttpPatch("{id:int}/admin-assignment"), Authorize(Policies.SuperAdminOnly)]
    [ProducesResponseType<UserDto>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(404)]
    public async Task<ActionResult<UserDto>> SetManager(int id, ManagerAssignmentRequest req, CancellationToken ct) =>
        await users.SetManagerAsync(id, req, Me, ct);

    /// <summary>Devices currently assigned to the user.</summary>
    [HttpGet("{id:int}/devices")]
    [ProducesResponseType<PagedResult<DeviceDto>>(200)]
    [ProducesResponseType<ApiError>(404)]
    public async Task<ActionResult<PagedResult<DeviceDto>>> Devices(int id, [FromQuery] PageQuery paging, CancellationToken ct) =>
        await devices.ListForUserAsync(id, paging, Me, ct);

    /// <summary>Set a new password for a user in the caller's scope; revokes their refresh tokens.</summary>
    [HttpPost("{id:int}/reset-password"), Authorize(Policies.AdminOrAbove)]
    [ProducesResponseType(204)]
    [ProducesResponseType<ApiError>(404)]
    public async Task<IActionResult> ResetPassword(int id, ResetPasswordRequest req, CancellationToken ct)
    {
        await users.ResetPasswordAsync(id, req, Me, ct);
        return NoContent();
    }
}
