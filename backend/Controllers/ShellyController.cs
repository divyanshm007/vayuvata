using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using VayuVata.Authorization;
using VayuVata.DTOs.Shelly;
using VayuVata.Helpers;
using VayuVata.Services;

namespace VayuVata.Controllers;

/// <summary>
/// Shelly smart switches (power on/off of a VayuVata device through the Shelly Cloud).
/// SuperAdmin: registers, edits, configures (daily schedule, override) and sees all switches, with the electrical details. Admin: sees and switches (unless the SuperAdmin override is on) only the switches of devices assigned to them or their Users, ON / OFF state only. User: sees the ON / OFF state of the switches of their devices, no control.
/// </summary>
[ApiController]
[Route("api/v1/shelly-devices")]
[Produces("application/json")]
[Authorize(Policies.AnyRole)]
[ProducesResponseType<ApiError>(401)]
[ProducesResponseType<ApiError>(403)]
public class ShellyController(ShellyService shelly) : ControllerBase
{
    private CurrentUser Me => CurrentUser.From(User);

    /// <summary>The switches the caller may see (with whether the caller may switch them). The auth key is never included.</summary>
    [HttpGet]
    public async Task<ActionResult<List<ShellyDeviceDto>>> List(CancellationToken ct) => await shelly.ListAsync(Me, ct);

    /// <summary>Register a Shelly switch (SuperAdmin only): its device id, cloud auth key, cloud server and the VayuVata device it belongs to.</summary>
    [HttpPost, Authorize(Policies.SuperAdminOnly)]
    [ProducesResponseType<ShellyDeviceDto>(201)]
    public async Task<ActionResult<ShellyDeviceDto>> Create(CreateShellyRequest req, CancellationToken ct)
    {
        var created = await shelly.CreateAsync(req, Me, ct);
        return StatusCode(StatusCodes.Status201Created, created);
    }

    /// <summary>Edit a switch (SuperAdmin only). Send <c>authKey</c> only to replace the key; <c>deviceId</c> empty removes the link.</summary>
    [HttpPut("{id:int}"), Authorize(Policies.SuperAdminOnly)]
    public async Task<ActionResult<ShellyDeviceDto>> Update(int id, UpdateShellyRequest req, CancellationToken ct) => await shelly.UpdateAsync(id, req, Me, ct);

    /// <summary>Delete a switch and its command history for good (SuperAdmin only). To keep the record but stop using it, deactivate it instead.</summary>
    [HttpDelete("{id:int}"), Authorize(Policies.SuperAdminOnly)]
    [ProducesResponseType(204)]
    public async Task<IActionResult> Delete(int id, CancellationToken ct) { await shelly.DeleteAsync(id, Me, ct); return NoContent(); }

    /// <summary>Daily ON / OFF time and the override of one switch (SuperAdmin only). Each switch has its own settings.</summary>
    [HttpPut("{id:int}/config"), Authorize(Policies.SuperAdminOnly)]
    public async Task<ActionResult<ShellyDeviceDto>> UpdateConfig(int id, UpdateShellyConfigRequest req, CancellationToken ct) => await shelly.UpdateConfigAsync(id, req, Me, ct);

    /// <summary>Live state from the Shelly Cloud: online and ON/OFF for everyone; power, voltage, current, temperature and Wi-Fi for the SuperAdmin only.</summary>
    [HttpGet("{id:int}/status")]
    public async Task<ActionResult<ShellyStatusDto>> Status(int id, CancellationToken ct) => await shelly.StatusAsync(id, Me, ct);

    /// <summary>Turn the switch ON or OFF. SuperAdmin always; Admin only while the SuperAdmin override is off (403 control_locked otherwise); Users never. Audited (who, when, result). The same switch cannot be commanded twice within a couple of seconds.</summary>
    [HttpPost("{id:int}/switch"), Authorize(Policies.AdminOrAbove)]
    public async Task<ActionResult<SwitchResultDto>> Switch(int id, SwitchRequest req, CancellationToken ct) => await shelly.SwitchAsync(id, req.On, Me, ct);

    /// <summary>The last 20 ON/OFF commands of the switch.</summary>
    [HttpGet("{id:int}/commands"), Authorize(Policies.AdminOrAbove)]
    public async Task<ActionResult<List<ShellyCommandDto>>> Commands(int id, CancellationToken ct) => await shelly.CommandsAsync(id, Me, ct);
}
