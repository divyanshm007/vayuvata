using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using VayuVata.Authorization;
using VayuVata.DTOs.Users;
using VayuVata.Helpers;
using VayuVata.Services;

namespace VayuVata.Controllers;

[ApiController]
[Route("api/v1/superadmin")]
[Produces("application/json")]
[Authorize(Policies.SuperAdminOnly)]
[ProducesResponseType<ApiError>(401)]
[ProducesResponseType<ApiError>(403)]
public class SuperAdminController(UserService users) : ControllerBase
{
    /// <summary>List the standalone Users: regular Users whose manager is the authenticated SuperAdmin (paged, optional search).</summary>
    /// <remarks>Never includes Users managed by an Admin. `managerRole` is "SuperAdmin" and `assignmentType` is "Standalone", derived from the stored relationship.</remarks>
    [HttpGet("users")]
    [ProducesResponseType<PagedResult<UserDto>>(200)]
    public async Task<ActionResult<PagedResult<UserDto>>> StandaloneUsers([FromQuery] ManagedUsersQuery q, CancellationToken ct) =>
        await users.ListStandaloneAsync(q, CurrentUser.From(User), ct);
}
