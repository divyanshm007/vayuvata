using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using VayuVata.Authorization;
using VayuVata.DTOs.Devices;
using VayuVata.Helpers;
using VayuVata.Services;

namespace VayuVata.Controllers;

/// <summary>Device registry and assignments. Only SuperAdmin registers/edits devices.</summary>
[ApiController]
[Route("api/v1/devices")]
[Produces("application/json")]
[Authorize(Policies.AnyRole)]
[ProducesResponseType<ApiError>(401)]
[ProducesResponseType<ApiError>(403)]
public class DevicesController(DeviceService devices, DeviceAssignmentService assignments) : ControllerBase
{
    private CurrentUser Me => CurrentUser.From(User);

    /// <summary>Register a device. The response contains its API key — shown only once.</summary>
    [HttpPost, Authorize(Policies.SuperAdminOnly)]
    [ProducesResponseType<DeviceWithKeyDto>(201)]
    [ProducesResponseType<ApiError>(409)]
    public async Task<ActionResult<DeviceWithKeyDto>> Create(CreateDeviceRequest req, CancellationToken ct)
    {
        var d = await devices.CreateAsync(req, Me, ct);
        return CreatedAtAction(nameof(Get), new { id = d.Id }, d);
    }

    /// <summary>List devices visible to the caller (paged).</summary>
    [HttpGet]
    [ProducesResponseType<PagedResult<DeviceDto>>(200)]
    public async Task<ActionResult<PagedResult<DeviceDto>>> List([FromQuery] DeviceQuery q, CancellationToken ct) =>
        await devices.ListAsync(q, Me, ct);

    /// <summary>Get one device by database id.</summary>
    /// <summary>Device health from the last hour of readings: offline, or the RS485 outer sensor missing from many readings. Only the caller's own devices.</summary>
    [HttpGet("health")]
    [ProducesResponseType<List<DeviceHealthDto>>(200)]
    public async Task<ActionResult<List<DeviceHealthDto>>> Health(CancellationToken ct) => await devices.HealthAsync(Me, ct);

    [HttpGet("{id:int}")]
    [ProducesResponseType<DeviceDto>(200)]
    [ProducesResponseType<ApiError>(404)]
    public async Task<ActionResult<DeviceDto>> Get(int id, CancellationToken ct) => await devices.GetAsync(id, Me, ct);

    /// <summary>Update device name/description (SuperAdmin).</summary>
    [HttpPut("{id:int}"), Authorize(Policies.SuperAdminOnly)]
    [ProducesResponseType<DeviceDto>(200)]
    public async Task<ActionResult<DeviceDto>> Update(int id, UpdateDeviceRequest req, CancellationToken ct) =>
        await devices.UpdateAsync(id, req, Me, ct);

    /// <summary>Activate or deactivate a device (SuperAdmin). Inactive devices cannot ingest or be assigned.</summary>
    [HttpPatch("{id:int}/status"), Authorize(Policies.SuperAdminOnly)]
    [ProducesResponseType<DeviceDto>(200)]
    public async Task<ActionResult<DeviceDto>> SetStatus(int id, SetDeviceStatusRequest req, CancellationToken ct) =>
        await devices.SetStatusAsync(id, req, Me, ct);

    /// <summary>Issue a new device API key; the old key stops working immediately (SuperAdmin).</summary>
    [HttpPost("{id:int}/rotate-key"), Authorize(Policies.SuperAdminOnly)]
    [ProducesResponseType<DeviceWithKeyDto>(200)]
    public async Task<ActionResult<DeviceWithKeyDto>> RotateKey(int id, CancellationToken ct) =>
        await devices.RotateKeyAsync(id, Me, ct);

    /// <summary>The device's stored key hash (SuperAdmin). Flash the DeviceId and this value into the ESP32; it sends the hash as X-Device-Key.</summary>
    [HttpGet("{id:int}/key-hash"), Authorize(Policies.SuperAdminOnly)]
    [ProducesResponseType<DeviceKeyHashDto>(200)]
    [ProducesResponseType<ApiError>(404)]
    public async Task<ActionResult<DeviceKeyHashDto>> KeyHash(int id, CancellationToken ct) => await devices.GetKeyHashAsync(id, Me, ct);

    /// <summary>Assign or reassign a device to a User. History is preserved.</summary>
    [HttpPost("{id:int}/assign"), Authorize(Policies.AdminOrAbove)]
    [ProducesResponseType<DeviceDto>(200)]
    [ProducesResponseType<ApiError>(409)]
    public async Task<ActionResult<DeviceDto>> Assign(int id, AssignDeviceRequest req, CancellationToken ct) =>
        await assignments.AssignAsync(id, req, Me, ct);

    /// <summary>End the device's current assignment.</summary>
    [HttpPost("{id:int}/unassign"), Authorize(Policies.AdminOrAbove)]
    [ProducesResponseType<DeviceDto>(200)]
    [ProducesResponseType<ApiError>(409)]
    public async Task<ActionResult<DeviceDto>> Unassign(int id, [FromBody] UnassignDeviceRequest? req, CancellationToken ct) =>
        await assignments.UnassignAsync(id, req, Me, ct);

    /// <summary>Assignment history of a device, newest first.</summary>
    [HttpGet("{id:int}/assignments"), Authorize(Policies.AdminOrAbove)]
    [ProducesResponseType<PagedResult<AssignmentDto>>(200)]
    public async Task<ActionResult<PagedResult<AssignmentDto>>> History(int id, [FromQuery] PageQuery paging, CancellationToken ct) =>
        await assignments.HistoryAsync(id, paging, Me, ct);
}
