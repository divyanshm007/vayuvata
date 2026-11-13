using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using VayuVata.Authorization;
using VayuVata.DTOs.Registration;
using VayuVata.Helpers;
using VayuVata.Services;

namespace VayuVata.Controllers;

/// <summary>
/// Common registration for Admin and User. Public: register, check and use an activation link. Super Admin only: requests, approval, direct creation,
/// invitations, mapping, history and the email log.
/// </summary>
[ApiController]
[Produces("application/json")]
public class RegistrationController(RegistrationService reg) : ControllerBase
{
    private CurrentUser Me => CurrentUser.From(User);

    // ---------------------------------------------------------------- public

    /// <summary>Register as Admin or User (public, no login). The request waits for Super Admin approval; nothing can log in before that. A User must give the email of an approved Admin.</summary>
    [HttpPost("api/v1/registrations"), AllowAnonymous, EnableRateLimiting("login")]
    [ProducesResponseType<RegisterResponse>(201)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(409)]
    public async Task<ActionResult<RegisterResponse>> Register(RegisterRequest req, CancellationToken ct) =>
        StatusCode(StatusCodes.Status201Created, await reg.RegisterAsync(req, ct));

    /// <summary>Is this activation link still usable? Returns the name and email it belongs to (nothing when it is invalid, used or expired).</summary>
    [HttpPost("api/v1/auth/activation/check"), AllowAnonymous, EnableRateLimiting("login")]
    public async Task<ActionResult<ActivationCheckResponse>> CheckActivation(ActivationCheckRequest req, CancellationToken ct) => await reg.CheckActivationAsync(req.Token, ct);

    /// <summary>Set the password and activate an approved account with its single-use activation link. This also confirms ownership of the email address.</summary>
    [HttpPost("api/v1/auth/activate"), AllowAnonymous, EnableRateLimiting("login")]
    [ProducesResponseType(204)]
    [ProducesResponseType<ApiError>(400)]
    public async Task<IActionResult> Activate(ActivateRequest req, CancellationToken ct) { await reg.ActivateAsync(req, ct); return NoContent(); }

    // ---------------------------------------------------------------- Super Admin

    [HttpGet("api/v1/user-management/requests"), Authorize(Policies.SuperAdminOnly)]
    public async Task<ActionResult<PagedResult<RegistrationRequestDto>>> Requests([FromQuery] RegistrationQuery q, CancellationToken ct) => await reg.ListAsync(q, ct);

    /// <summary>Approve a request: creates the account (inactive until activated), may change the role, assigns devices, and sends the activation email plus the notifications.</summary>
    [HttpPost("api/v1/user-management/requests/{id:int}/approve"), Authorize(Policies.SuperAdminOnly)]
    public async Task<ActionResult<RegistrationRequestDto>> Approve(int id, ApproveRegistrationRequest req, CancellationToken ct) => await reg.ApproveAsync(id, req, Me, ct);

    [HttpPost("api/v1/user-management/requests/{id:int}/reject"), Authorize(Policies.SuperAdminOnly)]
    public async Task<ActionResult<RegistrationRequestDto>> Reject(int id, RejectRegistrationRequest req, CancellationToken ct) => await reg.RejectAsync(id, req, Me, ct);

    /// <summary>Create an Admin or User directly. It is approved at once (no public approval) and the person gets an activation invitation.</summary>
    [HttpPost("api/v1/user-management/invite"), Authorize(Policies.SuperAdminOnly)]
    [ProducesResponseType<InviteResultDto>(201)]
    public async Task<ActionResult<InviteResultDto>> Invite(InviteUserRequest req, CancellationToken ct) => StatusCode(StatusCodes.Status201Created, await reg.InviteAsync(req, Me, ct));

    [HttpPost("api/v1/user-management/users/{id:int}/resend-invitation"), Authorize(Policies.SuperAdminOnly)]
    public async Task<ActionResult<InviteResultDto>> Resend(int id, CancellationToken ct) => await reg.ResendInvitationAsync(id, Me, ct);

    [HttpGet("api/v1/user-management/admin-mapping"), Authorize(Policies.SuperAdminOnly)]
    public async Task<ActionResult<List<AdminMappingDto>>> Mapping(CancellationToken ct) => await reg.MappingAsync(ct);

    [HttpGet("api/v1/user-management/history"), Authorize(Policies.SuperAdminOnly)]
    public async Task<ActionResult<PagedResult<AccountHistoryDto>>> History([FromQuery] HistoryQuery2 q, CancellationToken ct) => await reg.HistoryAsync(q, ct);

    [HttpGet("api/v1/user-management/email-log"), Authorize(Policies.SuperAdminOnly)]
    public async Task<ActionResult<PagedResult<EmailLogDto>>> EmailLog([FromQuery] PageQuery q, CancellationToken ct) => await reg.EmailLogAsync(q, ct);

    /// <summary>The public registration link, to copy.</summary>
    [HttpGet("api/v1/user-management/registration-link"), Authorize(Policies.SuperAdminOnly)]
    public ActionResult<RegistrationLinkDto> Link() => reg.GetLink();

    /// <summary>Email the registration link to any address.</summary>
    [HttpPost("api/v1/user-management/registration-link/send"), Authorize(Policies.SuperAdminOnly), EnableRateLimiting("login")]
    public async Task<ActionResult<EmailOutcomeDto>> SendLink(SendRegistrationLinkRequest req, CancellationToken ct) => await reg.SendLinkAsync(req, Me, ct);
}
