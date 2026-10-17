using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using VayuVata.Authorization;
using VayuVata.DTOs.Gps;
using VayuVata.Helpers;
using VayuVata.Services;

namespace VayuVata.Controllers;

/// <summary>GPS / cell position reports: push (device key) and two open reads. Plain storage - no trigger, no processing.</summary>
[ApiController]
[Produces("application/json")]
public class GpsDataController(GpsLocationService gps) : ControllerBase
{
    /// <summary>
    /// Position upload (Raspberry Pi, once a minute). Authenticate with the per-device key in the <c>X-Device-Key</c> header (NOT a JWT). Same key rule as sensor data (the issued key, or the stored key hash when the server's compatibility switch is on).
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

    /// <summary>All GPS data in the table, newest first (no filters; the newest 5000 rows). No login needed.</summary>
    [HttpGet("api/v1/gps-data"), AllowAnonymous]
    [ProducesResponseType<List<GpsLocationDto>>(200)]
    public async Task<ActionResult<List<GpsLocationDto>>> List(CancellationToken ct) => await gps.AllAsync(ct);

    /// <summary>GPS history (positions over time) of the devices the caller may see: filter by device, from/to and fix, paged. Login required.</summary>
    /// <remarks>SuperAdmin: all devices. Admin: devices assigned to them or to their Users. User: their own devices. Times are IST.</remarks>
    [HttpGet("api/v1/gps-data/history"), Authorize(Policies.AnyRole)]
    [ProducesResponseType<PagedResult<GpsLocationDto>>(200)]
    public async Task<ActionResult<PagedResult<GpsLocationDto>>> History([FromQuery] GpsHistoryQuery q, CancellationToken ct) =>
        await gps.HistoryAsync(q, CurrentUser.From(User), ct);

    /// <summary>Current position of a device: enter the deviceId; it must exist and be active, then its latest GPS report is returned. No login needed.</summary>
    /// <remarks>404 = unknown device, or no GPS data yet; 409 <c>device_inactive</c> = the device exists but is not active.</remarks>
    /// <param name="deviceId">The device's id, e.g. Vayu_004.</param>
    [HttpGet("api/v1/gps-data/current"), AllowAnonymous]
    [ProducesResponseType<GpsLocationDto>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(409)]
    public async Task<ActionResult<GpsLocationDto>> Current([FromQuery] string deviceId, CancellationToken ct) =>
        await gps.CurrentAsync(deviceId, ct);
}
