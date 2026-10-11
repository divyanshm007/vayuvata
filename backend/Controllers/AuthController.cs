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
    /// <response code="401">Invalid credentials or inactive account.</response>
    /// <response code="429">Too many login attempts.</response>
    [HttpPost("login"), AllowAnonymous, EnableRateLimiting("login")]
    [ProducesResponseType<LoginResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(401)]
    public async Task<ActionResult<LoginResponse>> Login(LoginRequest req, CancellationToken ct) =>
        await auth.LoginAsync(req, ct);

    /// <summary>Exchange a valid refresh token for a new access token (refresh token rotates).</summary>
    [HttpPost("refresh"), AllowAnonymous, EnableRateLimiting("login")]
    [ProducesResponseType<LoginResponse>(200)]
    [ProducesResponseType<ApiError>(401)]
    public async Task<ActionResult<LoginResponse>> Refresh(RefreshRequest req, CancellationToken ct) =>
        await auth.RefreshAsync(req, ct);

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
