using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;
using VayuVata.Authorization;
using VayuVata.DTOs.Video;
using VayuVata.Helpers;
using VayuVata.Services;

namespace VayuVata.Controllers;

/// <summary>
/// Settings -> Video Management. Super Admin: everything. Admin: upload, list, delete their own videos (if permitted), playback ON/OFF only when the Super Admin allows it for the device.
/// User: view the list only when the Super Admin permits it. Subscription expiry blocks upload and playback for everyone; every rule is enforced here, not in the UI.
/// </summary>
[ApiController]
[Route("api/v1/video-management")]
[Produces("application/json")]
[Authorize(Policies.AnyRole)]
public class VideoController(VideoService video, IOptions<VideoOptions> options) : ControllerBase
{
    private CurrentUser Me => CurrentUser.From(User);

    /// <summary>Subscription, playback state, what the caller may do on this device, and (Super Admin) the override flags.</summary>
    [HttpGet("devices/{deviceId}")]
    public async Task<ActionResult<VideoOverviewDto>> Overview(string deviceId, CancellationToken ct) => await video.OverviewAsync(deviceId, Me, ct);

    [HttpGet("devices/{deviceId}/videos")]
    public async Task<ActionResult<List<VideoDto>>> List(string deviceId, CancellationToken ct) => await video.ListAsync(deviceId, Me, ct);

    [HttpGet("devices/{deviceId}/history"), Authorize(Policies.AdminOrAbove)]
    public async Task<ActionResult<List<VideoHistoryDto>>> History(string deviceId, CancellationToken ct) => await video.HistoryAsync(deviceId, Me, ct);

    /// <summary>Upload a video (multipart/form-data, one file part). Streamed to disk, size and format checked. Blocked while the subscription is expired. An Admin's upload is emailed to the Super Admin.</summary>
    [HttpPost("devices/{deviceId}/videos"), Authorize(Policies.AdminOrAbove), EnableRateLimiting("login")]
    [DisableFormValueModelBinding]
    [ProducesResponseType<VideoDto>(201)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(413)]
    public async Task<ActionResult<VideoDto>> Upload([FromRoute] string deviceId, CancellationToken ct)   // [FromRoute]: without it MVC would read the whole multipart body while binding deviceId
    {
        var max = (long)options.Value.MaxSizeMb * 1024 * 1024 + 2 * 1024 * 1024;
        // The API-wide request cap is tiny (16 KB); only this action may carry a video.
        var limit = HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (limit is { IsReadOnly: false }) limit.MaxRequestBodySize = max;
        if (!Request.HasFormContentType || !MediaTypeHeaderValue.TryParse(Request.ContentType, out var mt) || string.IsNullOrEmpty(mt.Boundary.Value))
            throw ApiException.BadRequest("Send the video as multipart/form-data with one file part.", "validation_failed");
        var reader = new MultipartReader(HeaderUtilities.RemoveQuotes(mt.Boundary).Value!, Request.Body) { BodyLengthLimit = max };
        MultipartSection? section;
        while ((section = await reader.ReadNextSectionAsync(ct)) is not null)
        {
            if (!ContentDispositionHeaderValue.TryParse(section.ContentDisposition, out var cd) || !cd.IsFileDisposition()) continue;
            var created = await video.UploadAsync(deviceId, cd.FileName.Value ?? cd.FileNameStar.Value, section.Body, Request.ContentLength, Me, ct);
            return StatusCode(StatusCodes.Status201Created, created);
        }
        throw ApiException.BadRequest("No video file was sent.", "validation_failed");
    }

    [HttpDelete("videos/{id:int}"), Authorize(Policies.AdminOrAbove)]
    [ProducesResponseType(204)]
    public async Task<IActionResult> Delete(int id, CancellationToken ct) { await video.DeleteAsync(id, Me, ct); return NoContent(); }

    /// <summary>Playback ON/OFF. Super Admin always; Admin only while the Super Admin allows it for this device and the subscription is active.</summary>
    [HttpPost("devices/{deviceId}/playback"), Authorize(Policies.AdminOrAbove)]
    public async Task<ActionResult<VideoOverviewDto>> Playback(string deviceId, SetPlaybackRequest req, CancellationToken ct) => await video.SetPlaybackAsync(deviceId, req.Enabled, Me, ct);

    /// <summary>Choose which uploaded video the device plays.</summary>
    [HttpPut("devices/{deviceId}/active-video"), Authorize(Policies.AdminOrAbove)]
    public async Task<ActionResult<VideoOverviewDto>> Active(string deviceId, SetActiveVideoRequest req, CancellationToken ct) => await video.SetActiveAsync(deviceId, req.VideoId, Me, ct);

    /// <summary>Super Admin: the video settings of every Admin (client) with the devices that follow them.</summary>
    [HttpGet("admins"), Authorize(Policies.SuperAdminOnly)]
    public async Task<ActionResult<List<AdminVideoSettingsDto>>> Admins(CancellationToken ct) => await video.AdminsAsync(Me, ct);

    /// <summary>Super Admin: subscription period (From, To), Admin Video Control Permission, force OFF and upload/delete/view permissions of ONE Admin. Applies to all that Admin's devices at once.</summary>
    [HttpPut("admins/{adminId:int}/config"), Authorize(Policies.SuperAdminOnly)]
    public async Task<ActionResult<AdminVideoSettingsDto>> AdminConfig(int adminId, UpdateVideoConfigRequest req, CancellationToken ct) => await video.UpdateAdminConfigAsync(adminId, req, Me, ct);

    /// <summary>Super Admin, one device: its own force-OFF. A device with no owner Admin also keeps its own subscription and permissions here.</summary>
    [HttpPut("devices/{deviceId}/config"), Authorize(Policies.SuperAdminOnly)]
    public async Task<ActionResult<VideoOverviewDto>> Config(string deviceId, UpdateVideoConfigRequest req, CancellationToken ct) => await video.UpdateConfigAsync(deviceId, req, Me, ct);
}

/// <summary>
/// For the Raspberry Pi of a device. No login: the device presents its device key (X-Device-Key). Nothing here is a public URL: the file link is signed, expires, and is re-checked
/// against the subscription, the Super Admin force-OFF and the playback switch every time it is used.
/// </summary>
[ApiController]
[Route("api/v1/device-video")]
[Produces("application/json")]
[AllowAnonymous]
public class DeviceVideoController(VideoService video) : ControllerBase
{
    /// <summary>The active video and whether playback is allowed right now (plus a signed, expiring download URL). Poll every <c>pollAfterSeconds</c>.</summary>
    [HttpGet("active"), EnableRateLimiting("ingest")]
    public async Task<ActionResult<DeviceVideoActiveDto>> Active([FromQuery] string deviceId, [FromHeader(Name = "X-Device-Key")] string? key, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        return await video.ActiveForDeviceAsync(deviceId, key, ct);
    }

    /// <summary>Download / stream the active video (HTTP Range supported). Use the signed URL from <c>active</c>, or send the device key. Refused with 403 as soon as playback is not allowed.</summary>
    [HttpGet("stream/{videoId:int}"), EnableRateLimiting("ingest")]
    public async Task<IActionResult> Stream(int videoId, [FromQuery] string deviceId, [FromQuery] long exp, [FromQuery] string? sig, [FromHeader(Name = "X-Device-Key")] string? key, CancellationToken ct)
    {
        var (path, contentType, _) = await video.StreamAsync(videoId, deviceId, exp, sig, key, ct);
        Response.Headers.CacheControl = "no-store";
        return PhysicalFile(path, contentType, fileDownloadName: null, enableRangeProcessing: true);
    }

    /// <summary>The Pi reports what it is doing (Playing, Stopped, Downloading, Error).</summary>
    [HttpPost("status"), EnableRateLimiting("ingest")]
    [ProducesResponseType(204)]
    public async Task<IActionResult> Status(DeviceVideoStatusReport req, [FromHeader(Name = "X-Device-Key")] string? key, CancellationToken ct) { await video.ReportStatusAsync(req, key, ct); return NoContent(); }
}
