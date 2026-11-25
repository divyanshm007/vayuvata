using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using VayuVata.Authorization;
using VayuVata.DTOs.Alerts;
using VayuVata.Helpers;
using VayuVata.Services;

namespace VayuVata.Controllers;

/// <summary>
/// Alerts: maintenance reminders, machine errors and abnormal readings, kept separate. Super Admin sees everything and configures it. Admin sees maintenance and machine errors of their devices and
/// escalated abnormal readings. User sees only escalated abnormal readings of their devices.
/// </summary>
[ApiController]
[Route("api/v1/alerts")]
[Produces("application/json")]
[Authorize(Policies.AnyRole)]
public class AlertsController(AlertService alerts) : ControllerBase
{
    private CurrentUser Me => CurrentUser.From(User);

    /// <summary>Open alerts (Warning, Critical) the caller may see; pass <c>status=Resolved</c> for resolved ones. Filter by category and device.</summary>
    [HttpGet]
    public async Task<ActionResult<PagedResult<AlertDto>>> List([FromQuery] AlertQuery q, CancellationToken ct) => await alerts.ListAsync(q, Me, ct);

    /// <summary>Counts for the dashboard: normal devices, warnings, criticals, resolved in the last 7 days, per category.</summary>
    [HttpGet("summary")]
    public async Task<ActionResult<AlertSummaryDto>> Summary(CancellationToken ct) => await alerts.SummaryAsync(Me, ct);

    /// <summary>Alert history: date and time, device ID, category, type and status of every change.</summary>
    [HttpGet("history")]
    public async Task<ActionResult<PagedResult<AlertEventDto>>> History([FromQuery] AlertQuery q, CancellationToken ct) => await alerts.HistoryAsync(q, Me, ct);

    /// <summary>When the filter and bin of each device are due (Super Admin, Admin).</summary>
    [HttpGet("maintenance"), Authorize(Policies.AdminOrAbove)]
    public async Task<ActionResult<List<DeviceMaintenanceDto>>> Maintenance(CancellationToken ct) => await alerts.MaintenanceAsync(Me, ct);

    /// <summary>Record that the filter was replaced or the bin cleaned (Super Admin, or the Admin of the device). The next reminder counts from this date.</summary>
    [HttpPost("maintenance/{deviceId}/done"), Authorize(Policies.AdminOrAbove)]
    public async Task<ActionResult<DeviceMaintenanceDto>> Done(string deviceId, MarkMaintenanceDoneRequest req, CancellationToken ct) => await alerts.MarkDoneAsync(deviceId, req, Me, ct);

    /// <summary>Maintenance intervals, abnormal-reading thresholds and notification timings (Super Admin).</summary>
    [HttpGet("config"), Authorize(Policies.SuperAdminOnly)]
    public async Task<ActionResult<AlertConfigDto>> GetConfig(CancellationToken ct) => await alerts.GetConfigAsync(Me, ct);

    [HttpPut("config"), Authorize(Policies.SuperAdminOnly)]
    public async Task<ActionResult<AlertConfigDto>> PutConfig(AlertConfigDto req, CancellationToken ct) => await alerts.UpdateConfigAsync(req, Me, ct);

    /// <summary>Run the alert evaluation now (Super Admin). It normally runs by itself every few minutes.</summary>
    [HttpPost("evaluate"), Authorize(Policies.SuperAdminOnly)]
    public async Task<ActionResult<EvaluateResultDto>> Evaluate([FromQuery] DateTime? asOf, CancellationToken ct) => await alerts.EvaluateAsOfAsync(asOf, ct);
}
