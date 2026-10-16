using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using VayuVata.Authorization;
using VayuVata.DTOs.Government;
using VayuVata.Services;

namespace VayuVata.Controllers;

/// <summary>Comparison of each VayuVata device with the nearest official CPCB station (data.gov.in). SuperAdmin only.</summary>
[ApiController]
[Authorize(Policies.SuperAdminOnly)]
[Route("api/v1/government")]
[Produces("application/json")]
public class GovernmentController(GovernmentDataService gov) : ControllerBase
{
    /// <summary>Sync state: API key present, stations stored, last sync result and the newest government observation.</summary>
    [HttpGet("status")]
    public async Task<ActionResult<GovernmentStatusDto>> Status(CancellationToken ct) => await gov.StatusAsync(ct);

    /// <summary>Fetch the government feed now, store it and re-match devices (normally this runs hourly in the background).</summary>
    [HttpPost("sync")]
    public async Task<ActionResult<SyncResultDto>> Sync(CancellationToken ct) => await gov.SyncAsync("manual", ct);

    /// <summary>Re-run the nearest-station matching for all active devices without fetching.</summary>
    [HttpPost("match")]
    public async Task<ActionResult<object>> Match(CancellationToken ct)
    {
        var (matched, switched) = await gov.MatchAllAsync(ct);
        return new { matched, switched };
    }

    /// <summary>Every active device compared with its matched station (device side, government side, differences, nearby stations).</summary>
    [HttpGet("comparison")]
    public async Task<ActionResult<List<DeviceComparisonDto>>> All([FromQuery] double radiusKm = 25, CancellationToken ct = default)
        => await gov.CompareAllAsync(Math.Clamp(radiusKm, 1, 200), ct);

    /// <summary>One device's comparison.</summary>
    [HttpGet("comparison/{deviceId}")]
    public async Task<ActionResult<DeviceComparisonDto>> One(string deviceId, [FromQuery] double radiusKm = 25, CancellationToken ct = default)
        => await gov.CompareAsync(deviceId, Math.Clamp(radiusKm, 1, 200), ct);
}
