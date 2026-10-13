using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using VayuVata.Authorization;
using VayuVata.DTOs.Gps;
using VayuVata.Helpers;
using VayuVata.Services;

namespace VayuVata.Controllers;

/// <summary>GPS / cell position reports: push (device key) and get (JWT). Plain storage - no trigger, no processing.</summary>
[ApiController]
[Produces("application/json")]
public class GpsDataController(GpsLocationService gps) : ControllerBase
{
    private CurrentUser Me => CurrentUser.From(User);

    /// <summary>
    /// Position upload (Raspberry Pi, once a minute). Authenticate with the per-device key in the <c>X-Device-Key</c> header (NOT a JWT).
    /// </summary>
    /// <remarks>
    /// Idempotent: re-sending the same (deviceId, recordedAt) returns 200 with the stored report instead of an error, so a retry is safe.
    /// A "no fix" minute is <c>fix:false</c> with null lat/lon/altM/speedKmh. Bad payload = 400 (do not retry); bad key = 401/403; 5xx / timeout = retry later.
    /// </remarks>
    /// <response code="201">Report stored.</response>
    /// <response code="200">The same report was already stored (duplicate); nothing changed.</response>
    /// <response code="400">Invalid payload (coordinates out of range, future recordedAt, fix/position mismatch ...).</response>
    /// <response code="401">Unknown device, or missing/invalid X-Device-Key.</response>
    /// <response code="403">Device is inactive.</response>
    /// <response code="429">Too many requests from this IP.</response>
    [HttpPost("api/v1/gps-data"), AllowAnonymous, EnableRateLimiting("ingest")]
    [ProducesResponseType<GpsLocationDto>(201)]
    [ProducesResponseType<GpsLocationDto>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(401)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType(429)]
    public async Task<ActionResult<GpsLocationDto>> Ingest(
        CreateGpsLocationRequest req, [FromHeader(Name = "X-Device-Key")] string? deviceKey, CancellationToken ct)
    {
        var (report, created) = await gps.IngestAsync(req, deviceKey, ct);
        return created ? StatusCode(StatusCodes.Status201Created, report) : Ok(report);
    }

    /// <summary>Position reports the caller may see. Filter by <c>deviceId</c>, time window, fix and source; newest first (use <c>pageSize=1</c> for the latest position of a device).</summary>
    [HttpGet("api/v1/gps-data"), Authorize(Policies.AnyRole)]
    [ProducesResponseType<PagedResult<GpsLocationDto>>(200)]
    [ProducesResponseType<ApiError>(401)]
    public async Task<ActionResult<PagedResult<GpsLocationDto>>> List([FromQuery] GpsLocationQuery q, CancellationToken ct) =>
        await gps.QueryAsync(q, Me, ct);
}
