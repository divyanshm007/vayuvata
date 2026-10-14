using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using VayuVata.Authorization;
using VayuVata.DTOs.SensorData;
using VayuVata.Helpers;
using VayuVata.Services;

namespace VayuVata.Controllers;

/// <summary>Sensor readings: ESP32 ingestion (device key) and authorized reads (JWT). Reads return the processed rows of dbo.ManipulatedSensorData (AQI calculated in SQL); the raw dbo.SensorData table is never returned.</summary>
[ApiController]
[Produces("application/json")]
public class SensorDataController(SensorDataService sensors) : ControllerBase
{
    private CurrentUser Me => CurrentUser.From(User);

    /// <summary>
    /// ESP32 ingestion. Authenticate with the per-device key in the <c>X-Device-Key</c> header (NOT a JWT).
    /// The key is issued when the device is registered / rotated.
    /// </summary>
    /// <response code="201">Reading stored.</response>
    /// <response code="400">Invalid measurement values.</response>
    /// <response code="401">Unknown device, or missing/invalid X-Device-Key.</response>
    /// <response code="403">Device is inactive.</response>
    /// <response code="409">Duplicate (deviceId, recordedAt).</response>
    /// <response code="429">Too many requests from this IP.</response>
    [HttpPost("api/v1/sensor-data"), AllowAnonymous, EnableRateLimiting("ingest")]
    [ProducesResponseType<SensorDataDto>(201)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(401)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(409)]
    [ProducesResponseType(429)]
    public async Task<ActionResult<SensorDataDto>> Ingest(
        CreateSensorDataRequest req, [FromHeader(Name = "X-Device-Key")] string? deviceKey, CancellationToken ct)
    {
        var created = await sensors.IngestAsync(req, deviceKey, ct);
        return CreatedAtAction(nameof(Get), new { id = created.Id }, created);
    }

    /// <summary>Readings the caller may see, with device/time filters, sorting and paging.</summary>
    [HttpGet("api/v1/sensor-data"), Authorize(Policies.AnyRole)]
    [ProducesResponseType<PagedResult<SensorDataDto>>(200)]
    [ProducesResponseType<ApiError>(401)]
    public async Task<ActionResult<PagedResult<SensorDataDto>>> List([FromQuery] SensorDataQuery q, CancellationToken ct) =>
        await sensors.QueryAsync(q, Me, ct);

    /// <summary>One reading (404 when its device is outside the caller's scope).</summary>
    [HttpGet("api/v1/sensor-data/{id:long}"), Authorize(Policies.AnyRole)]
    [ProducesResponseType<SensorDataDto>(200)]
    [ProducesResponseType<ApiError>(404)]
    public async Task<ActionResult<SensorDataDto>> Get(long id, CancellationToken ct) => await sensors.GetAsync(id, Me, ct);

    /// <summary>Latest reading of a device (by database id).</summary>
    [HttpGet("api/v1/devices/{id:int}/sensor-data/latest"), Authorize(Policies.AnyRole)]
    [ProducesResponseType<SensorDataDto>(200)]
    [ProducesResponseType<ApiError>(404)]
    public async Task<ActionResult<SensorDataDto>> Latest(int id, CancellationToken ct) => await sensors.LatestAsync(id, Me, ct);

    /// <summary>Paged reading history of a device with optional from/to (UTC).</summary>
    [HttpGet("api/v1/devices/{id:int}/sensor-data/history"), Authorize(Policies.AnyRole)]
    [ProducesResponseType<PagedResult<SensorDataDto>>(200)]
    [ProducesResponseType<ApiError>(404)]
    public async Task<ActionResult<PagedResult<SensorDataDto>>> History(int id, [FromQuery] HistoryQuery q, CancellationToken ct) =>
        await sensors.HistoryAsync(id, q, Me, ct);
}
