using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using VayuVata.Authorization;
using VayuVata.DTOs.Auth;
using VayuVata.Helpers;
using VayuVata.Services;

namespace VayuVata.Controllers;

/// <summary>Login, token refresh and profile. One login API for SuperAdmin, Admin and User.</summary>
[ApiController]
[Route("api/v1/auth")]
[Produces("application/json")]
public class AuthController(AuthService auth) : ControllerBase
{
    /// <summary>Log in and receive a JWT access token plus a refresh token.</summary>
    /// <response code="200">Authenticated.</response>
    /// <response code="400">Validation failed.</response>
    /// <response code="401">Invalid credentials, inactive account or temporarily locked account (deliberately indistinguishable).</response>
    /// <response code="429">Too many login attempts.</response>
    [HttpPost("login"), AllowAnonymous, EnableRateLimiting("login")]
    [ProducesResponseType<LoginResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(401)]
    public async Task<ActionResult<LoginResponse>> Login(LoginRequest req, CancellationToken ct) =>
        await auth.LoginAsync(req, ct);

    /// <summary>Exchange a valid refresh token for a new access token (refresh token rotates).</summary>
    /// <remarks>Each refresh token is single-use. Presenting an already-rotated token is treated as theft and revokes every token of that login (family).</remarks>
    /// <response code="401">Invalid, expired, revoked or reused refresh token.</response>
    /// <response code="429">Too many attempts from this address.</response>
    [HttpPost("refresh"), AllowAnonymous, EnableRateLimiting("login")]
    [ProducesResponseType<LoginResponse>(200)]
    [ProducesResponseType<ApiError>(401)]
    public async Task<ActionResult<LoginResponse>> Refresh(RefreshRequest req, CancellationToken ct) =>
        await auth.RefreshAsync(req, ct);

    /// <summary>Change the signed-in user's own password.</summary>
    /// <remarks>
    /// Always applies to the caller; no user id is accepted. Requires the current password. Policy: 10-100 characters with an
    /// uppercase letter, a lowercase letter and a digit, different from the current password. On success ALL previous refresh tokens of
    /// the user are revoked (other sessions end when their access token expires, at most 15 minutes) and a new session
    /// (access + refresh token) is returned for the caller. Repeated wrong current passwords count towards the temporary account lockout.
    /// </remarks>
    /// <response code="200">Password changed; body is a fresh session.</response>
    /// <response code="400">Weak/identical new password, or the current password is incorrect (code <c>current_password_incorrect</c>).</response>
    /// <response code="429">Account temporarily locked after repeated failures (code <c>account_locked</c>), or rate limit exceeded.</response>
    [HttpPost("change-password"), Authorize(Policies.AnyRole), EnableRateLimiting("login")]
    [ProducesResponseType<LoginResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(401)]
    [ProducesResponseType<ApiError>(429)]
    public async Task<ActionResult<LoginResponse>> ChangePassword(ChangePasswordRequest req, CancellationToken ct) =>
        await auth.ChangePasswordAsync(CurrentUser.From(User).Id, req, ct);

    /// <summary>Revoke a refresh token. The short-lived access token simply expires.</summary>
    /// <response code="204">Refresh token revoked (or already invalid).</response>
    [HttpPost("logout"), Authorize(Policies.AnyRole)]
    [ProducesResponseType(204)]
    [ProducesResponseType<ApiError>(401)]
    public async Task<IActionResult> Logout(RefreshRequest req, CancellationToken ct)
    {
        await auth.LogoutAsync(CurrentUser.From(User).Id, req, ct);
        return NoContent();
    }

    /// <summary>The authenticated user's profile.</summary>
    [HttpGet("me"), Authorize(Policies.AnyRole)]
    [ProducesResponseType<ProfileResponse>(200)]
    [ProducesResponseType<ApiError>(401)]
    public async Task<ActionResult<ProfileResponse>> Me(CancellationToken ct) =>
        await auth.MeAsync(CurrentUser.From(User).Id, ct);
}
