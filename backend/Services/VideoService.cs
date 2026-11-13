using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using VayuVata.Authorization;
using VayuVata.Data;
using VayuVata.DTOs.Video;
using VayuVata.Helpers;
using VayuVata.Models;
using static VayuVata.Services.EmailTemplates;

namespace VayuVata.Services;

public class VideoOptions
{
    /// <summary>Folder the video files are stored in. Keep it OUTSIDE the application folder in production so a new release never touches the files.</summary>
    public string StorageRoot { get; set; } = "";
    public int MaxSizeMb { get; set; } = 500;
    public int MaxVideosPerDevice { get; set; } = 20;
    /// <summary>How long a signed stream URL given to the Raspberry Pi stays valid.</summary>
    public int UrlMinutes { get; set; } = 15;
    /// <summary>How often the Pi should ask again for the active video / playback state.</summary>
    public int PollAfterSeconds { get; set; } = 30;
}

/// <summary>
/// Video management: upload, list, delete, playback ON/OFF, the Super Admin override flags, subscription control, and the secure Raspberry Pi access.
/// Settings belong to the ADMIN (the client): every device assigned to an Admin, or to one of the Admin's Users, follows that Admin's subscription period, Admin Video Control
/// Permission, force-OFF and upload / delete / view permissions. A device with no owner Admin has its own settings. A device can additionally be forced OFF on its own.
/// Authorization order for playback (every step must pass): 1 subscription active (between From and To), 2 Super Admin has not forced it OFF, 3 playback is ON for the device, 4 an active video exists.
/// For an Admin who tries to switch playback, "Admin Video Control Permission" is checked right after the subscription. The subscription always wins.
/// </summary>
public class VideoService(
    VayuVataDbContext db, NotificationService notifier, IOptions<VideoOptions> options, IOptions<JwtOptions> jwt, IOptions<DeviceAuthOptions> deviceAuth,
    IWebHostEnvironment env, ILogger<VideoService> log)
{
    private readonly VideoOptions _o = options.Value;

    public const string SubscriptionExpiredMessage = "Your subscription has expired. Please contact Super Admin.";
    public const string ControlLockedMessage = "Video playback control is currently managed by Super Admin.";
    public const string ForcedOffMessage = "Video playback is switched off by Super Admin.";

    private static readonly string[] Formats = [".mp4", ".m4v", ".mov", ".webm", ".mkv"];
    private static string ContentTypeOf(string ext) => ext switch { ".webm" => "video/webm", ".mkv" => "video/x-matroska", ".mov" => "video/quicktime", _ => "video/mp4" };

    private string Root()
    {
        var root = string.IsNullOrWhiteSpace(_o.StorageRoot) ? Path.Combine(env.ContentRootPath, "App_Data", "videos") : _o.StorageRoot;
        return Path.GetFullPath(root);
    }

    // ------------------------------------------------------------------ the settings that apply to a device

    /// <summary>What really applies to one device: the owner Admin's settings (or the device's own when it has no owner Admin) plus the device's own switches.</summary>
    private sealed record Resolved(
        string Scope, int? AdminId, string? AdminName, DateTime? Starts, DateTime? Expires, bool AdminControl, bool ForcedOff, bool DeviceForcedOff,
        bool AdminCanUpload, bool AdminCanDeleteOwn, bool UserCanView, bool PlaybackEnabled, int? ActiveVideoId, DeviceVideoConfiguration? Device);

    /// <summary>The Admin a device belongs to: the Admin it is assigned to, or the manager of the User it is assigned to. Null = no owner Admin.</summary>
    private async Task<(int? Id, string? Name)> OwnerAdminAsync(string code, CancellationToken ct)
    {
        var a = await db.DeviceAssignments.AsNoTracking().Where(x => x.IsActive && x.Device.DeviceId == code)
            .Select(x => new { x.UserId, UserName = x.User.Name, x.User.Role, x.User.ManagerId, ManagerRole = x.User.Manager != null ? x.User.Manager.Role : null, ManagerName = x.User.Manager != null ? x.User.Manager.Name : null })
            .FirstOrDefaultAsync(ct);
        if (a is null) return (null, null);
        if (a.Role == Roles.Admin) return (a.UserId, a.UserName);
        if (a.Role == Roles.User && a.ManagerRole == Roles.Admin) return (a.ManagerId, a.ManagerName);
        return (null, null);
    }

    private async Task<Resolved> ResolveAsync(string code, CancellationToken ct)
    {
        var dev = await db.DeviceVideoConfigurations.FirstOrDefaultAsync(x => x.DeviceCode == code, ct);
        var (adminId, adminName) = await OwnerAdminAsync(code, ct);
        if (adminId is { } id)
        {
            var ac = await db.AdminVideoConfigurations.AsNoTracking().FirstOrDefaultAsync(x => x.AdminUserId == id, ct);
            return new Resolved("Admin", id, adminName, ac?.SubscriptionStartsAt, ac?.SubscriptionExpiresAt, ac?.AdminControlEnabled ?? false, (ac?.ForcedOff ?? false) || (dev?.ForcedOff ?? false), dev?.ForcedOff ?? false,
                ac?.AdminCanUpload ?? true, ac?.AdminCanDeleteOwn ?? true, ac?.UserCanView ?? false, dev?.PlaybackEnabled ?? false, dev?.ActiveVideoId, dev);
        }
        var perm = await db.VideoAccessPermissions.AsNoTracking().FirstOrDefaultAsync(x => x.DeviceCode == code, ct);
        return new Resolved("Device", null, null, dev?.SubscriptionStartsAt, dev?.SubscriptionExpiresAt, dev?.AdminControlEnabled ?? false, dev?.ForcedOff ?? false, dev?.ForcedOff ?? false,
            perm?.AdminCanUpload ?? true, perm?.AdminCanDeleteOwn ?? true, perm?.UserCanView ?? false, dev?.PlaybackEnabled ?? false, dev?.ActiveVideoId, dev);
    }

    // ------------------------------------------------------------------ rules

    private static string SubStatus(DateTime? starts, DateTime? expires)
    {
        var now = DateTime.UtcNow;
        if (expires is null) return "NotSet";
        if (now >= expires) return "Expired";
        if (starts is { } s && now < s) return "NotStarted";
        return "Active";
    }

    private static bool SubActive(Resolved r) => SubStatus(r.Starts, r.Expires) == "Active";

    private static VideoSubscriptionDto SubDto(DateTime? starts, DateTime? expires)
    {
        var status = SubStatus(starts, expires);
        return new VideoSubscriptionDto
        {
            Status = status, StartsAt = starts, ExpiresAt = expires, Active = status == "Active",
            Message = status == "Active" ? null : status == "NotStarted" ? $"Your subscription starts on {starts:yyyy-MM-dd}. Please contact Super Admin." : SubscriptionExpiredMessage,
        };
    }

    /// <summary>The four-step playback authorization. Reads only; never changes anything.</summary>
    private static VideoEffectiveDto Effective(Resolved r, bool activeVideoReady)
    {
        var sub = SubDto(r.Starts, r.Expires);
        if (!sub.Active) return new() { Allowed = false, Reason = sub.Message };
        if (r.ForcedOff) return new() { Allowed = false, Reason = ForcedOffMessage };
        if (!r.PlaybackEnabled) return new() { Allowed = false, Reason = "Playback is switched off." };
        if (!activeVideoReady) return new() { Allowed = false, Reason = "No video is selected for this device." };
        return new() { Allowed = true };
    }

    private async Task<Device> ScopedDeviceAsync(string code, CurrentUser c, CancellationToken ct)
    {
        var q = c.IsSuperAdmin ? db.Devices : db.DataDevices(c);
        return await q.AsNoTracking().FirstOrDefaultAsync(d => d.DeviceId == code, ct) ?? throw ApiException.NotFound("Device not found.");
    }

    private async Task<DeviceVideoConfiguration> DeviceCfgOrCreateAsync(string code, CancellationToken ct)
    {
        var c = await db.DeviceVideoConfigurations.FirstOrDefaultAsync(x => x.DeviceCode == code, ct);
        if (c is null) { c = new DeviceVideoConfiguration { DeviceCode = code }; db.DeviceVideoConfigurations.Add(c); }
        return c;
    }

    private void Hist(string code, int? videoId, int? userId, string source, string action, bool success, string? detail) =>
        db.VideoCommandHistories.Add(new VideoCommandHistory { DeviceCode = code, VideoId = videoId, UserId = userId, Source = source, Action = action, Success = success, Detail = detail is { Length: > 300 } ? detail[..300] : detail });

    /// <summary>Records a refused action (so the history shows attempts too), then returns the error to throw.</summary>
    private async Task<Exception> BlockAsync(string code, int? videoId, CurrentUser c, string action, int status, string errCode, string message)
    {
        Hist(code, videoId, c.Id, "User", action, false, message);
        await db.SaveChangesAsync(CancellationToken.None);
        return new ApiException(status, errCode, message);
    }

    private static bool CanSeeList(CurrentUser c, Resolved r) => c.IsSuperAdmin || c.IsAdmin || (c.IsUser && r.UserCanView);

    private VideoConfigDto ConfigDto(Resolved r) => new()
    {
        Scope = r.Scope, AdminId = r.AdminId, AdminName = r.AdminName, AdminControlEnabled = r.AdminControl, ForcedOff = r.ForcedOff, DeviceForcedOff = r.DeviceForcedOff,
        AdminCanUpload = r.AdminCanUpload, AdminCanDeleteOwn = r.AdminCanDeleteOwn, UserCanView = r.UserCanView,
    };

    // ------------------------------------------------------------------ read

    public async Task<VideoOverviewDto> OverviewAsync(string code, CurrentUser c, CancellationToken ct)
    {
        var d = await ScopedDeviceAsync(code, c, ct);
        var r = await ResolveAsync(code, ct);
        var active = r.ActiveVideoId is { } vid ? await db.VideoItems.AsNoTracking().FirstOrDefaultAsync(v => v.Id == vid && v.DeletedAt == null, ct) : null;
        var st = await db.VideoPlaybackStatuses.AsNoTracking().FirstOrDefaultAsync(s => s.DeviceCode == code, ct);
        var sub = SubDto(r.Starts, r.Expires);

        var caps = new VideoCapabilitiesDto { CanView = CanSeeList(c, r), CanConfigure = c.IsSuperAdmin };
        if (c.IsSuperAdmin || c.IsAdmin)
        {
            caps.UploadBlockedReason = !sub.Active ? sub.Message : c.IsAdmin && !r.AdminCanUpload ? "Video upload is not allowed for Admins on this device. Contact Super Admin." : null;
            caps.CanUpload = caps.UploadBlockedReason is null;
            caps.CanControlPlayback = c.IsSuperAdmin || (sub.Active && r.AdminControl && !r.ForcedOff);
            if (c.IsAdmin && !caps.CanControlPlayback) caps.ControlMessage = !sub.Active ? sub.Message : ControlLockedMessage;
        }
        return new VideoOverviewDto
        {
            DeviceId = d.DeviceId, DeviceName = d.DeviceName, Subscription = sub, PlaybackEnabled = r.PlaybackEnabled,
            Effective = Effective(r, active is not null), ActiveVideoId = active?.Id, ActiveVideoName = active?.FileName,
            DeviceStatus = st is null ? null : new VideoDeviceStatusDto { State = st.State, Message = st.Message, ReportedAt = st.ReportedAt, VideoId = st.VideoId },
            Capabilities = caps, MaxSizeMb = _o.MaxSizeMb, AllowedFormats = Formats, Config = c.IsSuperAdmin ? ConfigDto(r) : null,
        };
    }

    public async Task<List<VideoDto>> ListAsync(string code, CurrentUser c, CancellationToken ct)
    {
        await ScopedDeviceAsync(code, c, ct);
        var r = await ResolveAsync(code, ct);
        if (!CanSeeList(c, r)) throw ApiException.Forbidden("Video list is not available to you for this device.");
        var rows = await db.VideoItems.AsNoTracking().Where(v => v.DeviceCode == code && v.DeletedAt == null).OrderByDescending(v => v.UploadedAt).ThenByDescending(v => v.Id)
            .Select(v => new { v.Id, v.DeviceCode, v.FileName, v.SizeBytes, v.UploadedAt, By = v.UploadedBy.Name, v.UploadedByUserId, v.ProcessingStatus }).ToListAsync(ct);
        var eff = Effective(r, r.ActiveVideoId is not null);
        return rows.Select(v =>
        {
            var isActive = r.ActiveVideoId == v.Id;
            return new VideoDto
            {
                Id = v.Id, DeviceId = v.DeviceCode, FileName = v.FileName, SizeBytes = v.SizeBytes, UploadedAt = v.UploadedAt, UploadedByName = v.By, UploadedByUserId = v.UploadedByUserId,
                ProcessingStatus = v.ProcessingStatus, IsActive = isActive,
                PlaybackStatus = !isActive ? "Ready" : eff.Allowed ? "Playing" : "Blocked: " + eff.Reason,
                CanDelete = c.IsSuperAdmin || (c.IsAdmin && v.UploadedByUserId == c.Id && r.AdminCanDeleteOwn),
            };
        }).ToList();
    }

    public async Task<List<VideoHistoryDto>> HistoryAsync(string code, CurrentUser c, CancellationToken ct)
    {
        if (c.IsUser) throw ApiException.Forbidden();
        await ScopedDeviceAsync(code, c, ct);
        return await db.VideoCommandHistories.AsNoTracking().Where(h => h.DeviceCode == code).OrderByDescending(h => h.At).ThenByDescending(h => h.Id).Take(50)
            .Select(h => new VideoHistoryDto { Id = h.Id, At = h.At, Action = h.Action, Source = h.Source, UserName = h.User != null ? h.User.Name : null, VideoId = h.VideoId, Success = h.Success, Detail = h.Detail }).ToListAsync(ct);
    }

    // ------------------------------------------------------------------ upload / delete

    private static string CleanName(string? raw)
    {
        var n = Path.GetFileName((raw ?? "").Replace('\\', '/'));
        n = new string(n.Where(ch => !char.IsControl(ch)).ToArray()).Trim();
        return n.Length == 0 ? "video" : n.Length > 255 ? n[^255..] : n;
    }

    /// <summary>Checks the first bytes so a renamed non-video file is refused: MP4 / MOV have "ftyp" at byte 4, WebM / MKV start with the EBML marker.</summary>
    private static bool LooksLikeVideo(string ext, byte[] head, int n)
    {
        if (n < 12) return false;
        return ext is ".webm" or ".mkv" ? head[0] == 0x1A && head[1] == 0x45 && head[2] == 0xDF && head[3] == 0xA3
                                          : head[4] == (byte)'f' && head[5] == (byte)'t' && head[6] == (byte)'y' && head[7] == (byte)'p';
    }

    public async Task<VideoDto> UploadAsync(string code, string? fileName, Stream body, long? declaredLength, CurrentUser c, CancellationToken ct)
    {
        if (c.IsUser) throw ApiException.Forbidden();
        var device = await ScopedDeviceAsync(code, c, ct);
        if (!device.IsActive) throw ApiException.Conflict("The device is inactive.", "device_inactive");
        var r = await ResolveAsync(code, ct);
        if (!SubActive(r)) throw await BlockAsync(code, null, c, "Upload", 409, "subscription_expired", SubDto(r.Starts, r.Expires).Message!);
        if (c.IsAdmin && !r.AdminCanUpload) throw await BlockAsync(code, null, c, "Upload", 403, "upload_not_allowed", "Video upload is not allowed for Admins on this device. Contact Super Admin.");
        if (await db.VideoItems.CountAsync(v => v.DeviceCode == code && v.DeletedAt == null, ct) >= _o.MaxVideosPerDevice)
            throw ApiException.Conflict($"This device already has {_o.MaxVideosPerDevice} videos. Delete one first.", "video_limit");

        var name = CleanName(fileName);
        var ext = Path.GetExtension(name).ToLowerInvariant();
        if (!Formats.Contains(ext)) throw ApiException.BadRequest("Unsupported video format. Allowed: " + string.Join(", ", Formats) + ".", "unsupported_format");
        var max = (long)_o.MaxSizeMb * 1024 * 1024;
        if (declaredLength > max + 1024 * 1024) throw new ApiException(413, "file_too_large", $"The video is larger than {_o.MaxSizeMb} MB.");

        var root = Root(); var dir = Path.Combine(root, code); var tmpDir = Path.Combine(root, ".tmp");
        Directory.CreateDirectory(dir); Directory.CreateDirectory(tmpDir);
        var stored = Guid.NewGuid().ToString("N") + ext;
        var tmp = Path.Combine(tmpDir, stored); var final = Path.Combine(dir, stored);
        long size = 0; var head = new byte[16]; var headLen = 0;
        using var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        try
        {
            await using (var fs = new FileStream(tmp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, useAsync: true))
            {
                var buf = new byte[81920]; int read;
                while ((read = await body.ReadAsync(buf, ct)) > 0)
                {
                    if (headLen < head.Length) { var take = Math.Min(head.Length - headLen, read); Array.Copy(buf, 0, head, headLen, take); headLen += take; }
                    size += read;
                    if (size > max) throw new ApiException(413, "file_too_large", $"The video is larger than {_o.MaxSizeMb} MB.");
                    sha.AppendData(buf, 0, read);
                    await fs.WriteAsync(buf.AsMemory(0, read), ct);
                }
            }
            if (size == 0) throw ApiException.BadRequest("The file is empty.", "empty_file");
            if (!LooksLikeVideo(ext, head, headLen)) throw ApiException.BadRequest("The file is not a valid video (its content does not match its format).", "invalid_video");
            File.Move(tmp, final);
        }
        catch { TryDelete(tmp); TryDelete(final); throw; }

        var item = new VideoItem
        {
            DeviceCode = code, FileName = name, StoredFileName = stored, FilePath = $"{code}/{stored}", ContentType = ContentTypeOf(ext), SizeBytes = size,
            Sha256 = Convert.ToHexString(sha.GetHashAndReset()).ToLowerInvariant(), UploadedByUserId = c.Id, ProcessingStatus = "Ready",
        };
        try
        {
            db.VideoItems.Add(item);
            await db.SaveChangesAsync(ct);
            var conf = await DeviceCfgOrCreateAsync(code, ct);
            var becameActive = conf.ActiveVideoId is null;
            if (becameActive) { conf.ActiveVideoId = item.Id; conf.UpdatedAt = DateTime.UtcNow; conf.UpdatedByUserId = c.Id; }
            Hist(code, item.Id, c.Id, "User", "Upload", true, $"{name} ({size / 1024} KB){(becameActive ? ", set as the active video" : "")}");
            await db.SaveChangesAsync(ct);
        }
        catch { TryDelete(final); throw; }
        log.LogInformation("AUDIT video {VideoId} uploaded for {Device} by {Role} {UserId} ({Size} bytes)", item.Id, code, c.Role, c.Id, size);

        // An Admin's upload is reported to the Super Admin(s) by email. A failed email never undoes the upload.
        if (c.IsAdmin)
        {
            var who = await db.Users.AsNoTracking().Where(u => u.Id == c.Id).Select(u => new { u.Name, u.Email }).FirstAsync(ct);
            await notifier.ToSuperAdminsAsync("VideoUploaded", $"Video uploaded by Admin {who.Name}: {name}", "An Admin uploaded a video",
                [$"<b>{H(who.Name)}</b> ({H(who.Email)}) uploaded the video <b>{H(name)}</b> ({size / 1024 / 1024.0:0.#} MB) for the device <b>{H(device.DeviceName)}</b> ({H(code)}).",
                 "You can review, enable or delete it under Settings, Video Management."], null, c.Id, ct);
        }
        return (await ListAsync(code, c, ct)).First(v => v.Id == item.Id);
    }

    private static void TryDelete(string path) { try { if (File.Exists(path)) File.Delete(path); } catch (IOException) { /* left for manual cleanup */ } }

    public async Task DeleteAsync(int videoId, CurrentUser c, CancellationToken ct)
    {
        if (c.IsUser) throw ApiException.Forbidden();
        var v = await db.VideoItems.FirstOrDefaultAsync(x => x.Id == videoId && x.DeletedAt == null, ct) ?? throw ApiException.NotFound("Video not found.");
        await ScopedDeviceAsync(v.DeviceCode, c, ct);
        if (c.IsAdmin)
        {
            var r = await ResolveAsync(v.DeviceCode, ct);
            if (v.UploadedByUserId != c.Id) throw await BlockAsync(v.DeviceCode, v.Id, c, "Delete", 403, "delete_not_allowed", "Admins can delete only the videos they uploaded themselves.");
            if (!r.AdminCanDeleteOwn) throw await BlockAsync(v.DeviceCode, v.Id, c, "Delete", 403, "delete_not_allowed", "Deleting videos is not allowed for Admins on this device. Contact Super Admin.");
        }
        v.DeletedAt = DateTime.UtcNow; v.DeletedByUserId = c.Id;
        var cfg = await db.DeviceVideoConfigurations.FirstOrDefaultAsync(x => x.DeviceCode == v.DeviceCode, ct);
        if (cfg?.ActiveVideoId == v.Id) { cfg.ActiveVideoId = null; cfg.PlaybackEnabled = false; cfg.UpdatedAt = DateTime.UtcNow; cfg.UpdatedByUserId = c.Id; }
        Hist(v.DeviceCode, v.Id, c.Id, "User", "Delete", true, v.FileName);
        await db.SaveChangesAsync(ct);
        TryDelete(Path.Combine(Root(), v.FilePath));
        log.LogInformation("AUDIT video {VideoId} deleted by {Role} {UserId}", v.Id, c.Role, c.Id);
    }

    // ------------------------------------------------------------------ playback control

    /// <summary>Playback ON/OFF. Order: subscription (all roles), then for an Admin the permission flag and the Super Admin force-OFF. Super Admin turning ON also lifts a force-OFF of the device (an Admin-level force-OFF is lifted under Admin accounts).</summary>
    public async Task<VideoOverviewDto> SetPlaybackAsync(string code, bool enabled, CurrentUser c, CancellationToken ct)
    {
        if (c.IsUser) throw ApiException.Forbidden();
        await ScopedDeviceAsync(code, c, ct);
        var r = await ResolveAsync(code, ct);
        var sub = SubDto(r.Starts, r.Expires);
        var action = enabled ? "PlaybackOn" : "PlaybackOff";
        if (!sub.Active && (enabled || c.IsAdmin)) throw await BlockAsync(code, null, c, action, 409, "subscription_expired", sub.Message!);
        if (c.IsAdmin && (!r.AdminControl || r.ForcedOff)) throw await BlockAsync(code, null, c, action, 403, "control_locked", ControlLockedMessage);
        if (enabled && r.ActiveVideoId is null) throw ApiException.Conflict("There is no video selected for this device. Upload or choose one first.", "no_active_video");
        if (enabled && c.IsSuperAdmin && r.Scope == "Admin" && r.ForcedOff && !r.DeviceForcedOff)
            throw ApiException.Conflict("Playback is forced OFF for all devices of this Admin. Lift it under Admin accounts first.", "admin_forced_off");
        var cfg = await DeviceCfgOrCreateAsync(code, ct);
        var lifted = enabled && cfg.ForcedOff && c.IsSuperAdmin;
        if (lifted) cfg.ForcedOff = false;
        cfg.PlaybackEnabled = enabled; cfg.UpdatedAt = DateTime.UtcNow; cfg.UpdatedByUserId = c.Id;
        Hist(code, cfg.ActiveVideoId, c.Id, "User", action, true, lifted ? "Super Admin force-OFF lifted" : null);
        await db.SaveChangesAsync(ct);
        log.LogInformation("AUDIT video playback {State} for {Device} by {Role} {UserId}", enabled ? "ON" : "OFF", code, c.Role, c.Id);
        return await OverviewAsync(code, c, ct);
    }

    /// <summary>Choose which uploaded video the device plays. Admins may do this while the subscription is active; it never turns playback ON by itself.</summary>
    public async Task<VideoOverviewDto> SetActiveAsync(string code, int videoId, CurrentUser c, CancellationToken ct)
    {
        if (c.IsUser) throw ApiException.Forbidden();
        await ScopedDeviceAsync(code, c, ct);
        var r = await ResolveAsync(code, ct);
        var sub = SubDto(r.Starts, r.Expires);
        if (c.IsAdmin && !sub.Active) throw await BlockAsync(code, videoId, c, "SetActive", 409, "subscription_expired", sub.Message!);
        var v = await db.VideoItems.AsNoTracking().FirstOrDefaultAsync(x => x.Id == videoId && x.DeviceCode == code && x.DeletedAt == null, ct) ?? throw ApiException.NotFound("Video not found for this device.");
        var cfg = await DeviceCfgOrCreateAsync(code, ct);
        cfg.ActiveVideoId = v.Id; cfg.UpdatedAt = DateTime.UtcNow; cfg.UpdatedByUserId = c.Id;
        Hist(code, v.Id, c.Id, "User", "SetActive", true, v.FileName);
        await db.SaveChangesAsync(ct);
        return await OverviewAsync(code, c, ct);
    }

    private static DateTime? Utc(DateTime? d) => d is { } e ? (e.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(e, DateTimeKind.Utc) : e.ToUniversalTime()) : null;

    private static void CheckPeriod(DateTime? from, DateTime? to)
    {
        if (from is not null && to is not null && from >= to) throw ApiException.BadRequest("The subscription 'From' date must be before the 'To' date.", "validation_failed");
    }

    /// <summary>
    /// Super Admin, one DEVICE. For a device that belongs to an Admin only the device's own force-OFF can be changed here (everything else is the Admin's: see
    /// <see cref="UpdateAdminConfigAsync"/>). A device without an owner Admin keeps its own full settings, including the subscription period.
    /// </summary>
    public async Task<VideoOverviewDto> UpdateConfigAsync(string code, UpdateVideoConfigRequest req, CurrentUser c, CancellationToken ct)
    {
        if (!c.IsSuperAdmin) throw ApiException.Forbidden();
        await ScopedDeviceAsync(code, c, ct);
        var r = await ResolveAsync(code, ct);
        var cfg = await DeviceCfgOrCreateAsync(code, ct);
        var now = DateTime.UtcNow;
        if (req.ForcedOff != cfg.ForcedOff) Hist(code, null, c.Id, "User", req.ForcedOff ? "ForceOff" : "ForceOffLifted", true, "Device only");
        cfg.ForcedOff = req.ForcedOff;
        if (req.ForcedOff) cfg.PlaybackEnabled = false;

        if (r.Scope == "Device")
        {
            var perm = await db.VideoAccessPermissions.FirstOrDefaultAsync(x => x.DeviceCode == code, ct);
            if (perm is null) { perm = new VideoAccessPermission { DeviceCode = code }; db.VideoAccessPermissions.Add(perm); }
            var from = Utc(req.SubscriptionStartsAt); var to = Utc(req.SubscriptionExpiresAt);
            CheckPeriod(from, to);
            if (req.AdminControlEnabled != cfg.AdminControlEnabled) Hist(code, null, c.Id, "User", "AdminControl", true, req.AdminControlEnabled ? "Admin video control ENABLED" : "Admin video control DISABLED");
            if (req.AdminCanUpload != perm.AdminCanUpload || req.AdminCanDeleteOwn != perm.AdminCanDeleteOwn || req.UserCanView != perm.UserCanView)
                Hist(code, null, c.Id, "User", "Permissions", true, $"Admin upload {req.AdminCanUpload}, Admin delete own {req.AdminCanDeleteOwn}, Users view {req.UserCanView}");
            var wasActive = SubActive(r);
            if (from != cfg.SubscriptionStartsAt || to != cfg.SubscriptionExpiresAt)
            {
                cfg.SubscriptionStartsAt = from; cfg.SubscriptionExpiresAt = to;
                var nowActive = SubStatus(from, to) == "Active";
                if (!wasActive && nowActive) cfg.PlaybackEnabled = false;      // reactivation is deliberate: nothing starts playing by itself
                Hist(code, null, c.Id, "User", "Subscription", true, to is null ? "Subscription cleared" : $"Subscription {from:yyyy-MM-dd HH:mm} to {to:yyyy-MM-dd HH:mm} UTC" + (!wasActive && nowActive ? " (reactivated, playback stays OFF until turned ON)" : ""));
            }
            cfg.AdminControlEnabled = req.AdminControlEnabled;
            perm.AdminCanUpload = req.AdminCanUpload; perm.AdminCanDeleteOwn = req.AdminCanDeleteOwn; perm.UserCanView = req.UserCanView;
            perm.UpdatedAt = now; perm.UpdatedByUserId = c.Id;
        }
        cfg.UpdatedAt = now; cfg.UpdatedByUserId = c.Id;
        await db.SaveChangesAsync(ct);
        log.LogInformation("AUDIT video configuration of {Device} changed by SuperAdmin {UserId}", code, c.Id);
        return await OverviewAsync(code, c, ct);
    }

    // ------------------------------------------------------------------ Super Admin: settings per ADMIN

    /// <summary>The devices that belong to each Admin (assigned to the Admin, or to one of the Admin's Users).</summary>
    private async Task<Dictionary<int, List<string>>> DevicesByAdminAsync(CancellationToken ct)
    {
        var rows = await db.DeviceAssignments.AsNoTracking().Where(a => a.IsActive)
            .Select(a => new { Code = a.Device.DeviceId, a.UserId, a.User.Role, a.User.ManagerId, ManagerRole = a.User.Manager != null ? a.User.Manager.Role : null }).ToListAsync(ct);
        var map = new Dictionary<int, List<string>>();
        foreach (var x in rows)
        {
            int? admin = x.Role == Roles.Admin ? x.UserId : x.Role == Roles.User && x.ManagerRole == Roles.Admin ? x.ManagerId : null;
            if (admin is { } id) { if (!map.TryGetValue(id, out var l)) map[id] = l = []; l.Add(x.Code); }
        }
        foreach (var l in map.Values) l.Sort(StringComparer.OrdinalIgnoreCase);
        return map;
    }

    private static VideoConfigDto AdminCfgDto(AdminVideoConfiguration? a, int id, string name) => new()
    {
        Scope = "Admin", AdminId = id, AdminName = name, AdminControlEnabled = a?.AdminControlEnabled ?? false, ForcedOff = a?.ForcedOff ?? false, DeviceForcedOff = false,
        AdminCanUpload = a?.AdminCanUpload ?? true, AdminCanDeleteOwn = a?.AdminCanDeleteOwn ?? true, UserCanView = a?.UserCanView ?? false,
    };

    public async Task<List<AdminVideoSettingsDto>> AdminsAsync(CurrentUser c, CancellationToken ct)
    {
        if (!c.IsSuperAdmin) throw ApiException.Forbidden();
        var admins = await db.Users.AsNoTracking().Where(u => u.Role == Roles.Admin).OrderBy(u => u.Name).Select(u => new { u.Id, u.Name, u.Email }).ToListAsync(ct);
        var configs = (await db.AdminVideoConfigurations.AsNoTracking().ToListAsync(ct)).ToDictionary(x => x.AdminUserId);
        var devices = await DevicesByAdminAsync(ct);
        return admins.Select(a =>
        {
            configs.TryGetValue(a.Id, out var cfg);
            return new AdminVideoSettingsDto { AdminId = a.Id, AdminName = a.Name, AdminEmail = a.Email, DeviceIds = devices.GetValueOrDefault(a.Id) ?? [], Subscription = SubDto(cfg?.SubscriptionStartsAt, cfg?.SubscriptionExpiresAt), Config = AdminCfgDto(cfg, a.Id, a.Name) };
        }).ToList();
    }

    /// <summary>Super Admin: the video settings of ONE Admin. They apply to every device of that Admin at once and never to another Admin's devices. Renewing an expired subscription leaves playback OFF until it is turned ON.</summary>
    public async Task<AdminVideoSettingsDto> UpdateAdminConfigAsync(int adminId, UpdateVideoConfigRequest req, CurrentUser c, CancellationToken ct)
    {
        if (!c.IsSuperAdmin) throw ApiException.Forbidden();
        var admin = await db.Users.AsNoTracking().Where(u => u.Id == adminId && u.Role == Roles.Admin).Select(u => new { u.Id, u.Name, u.Email }).FirstOrDefaultAsync(ct) ?? throw ApiException.NotFound("Admin not found.");
        var from = Utc(req.SubscriptionStartsAt); var to = Utc(req.SubscriptionExpiresAt);
        CheckPeriod(from, to);
        var cfg = await db.AdminVideoConfigurations.FirstOrDefaultAsync(x => x.AdminUserId == adminId, ct);
        if (cfg is null) { cfg = new AdminVideoConfiguration { AdminUserId = adminId }; db.AdminVideoConfigurations.Add(cfg); }
        var devices = (await DevicesByAdminAsync(ct)).GetValueOrDefault(adminId) ?? [];
        void HistAll(string action, string detail) { foreach (var d in devices) Hist(d, null, c.Id, "User", action, true, detail + $" (Admin {admin.Name})"); }

        var wasActive = SubStatus(cfg.SubscriptionStartsAt, cfg.SubscriptionExpiresAt) == "Active";
        if (req.AdminControlEnabled != cfg.AdminControlEnabled) HistAll("AdminControl", req.AdminControlEnabled ? "Admin video control ENABLED" : "Admin video control DISABLED");
        if (req.ForcedOff != cfg.ForcedOff) HistAll(req.ForcedOff ? "ForceOff" : "ForceOffLifted", "All devices of the Admin");
        if (req.AdminCanUpload != cfg.AdminCanUpload || req.AdminCanDeleteOwn != cfg.AdminCanDeleteOwn || req.UserCanView != cfg.UserCanView)
            HistAll("Permissions", $"Admin upload {req.AdminCanUpload}, Admin delete own {req.AdminCanDeleteOwn}, Users view {req.UserCanView}");
        if (from != cfg.SubscriptionStartsAt || to != cfg.SubscriptionExpiresAt)
        {
            var nowActive = SubStatus(from, to) == "Active";
            var reactivated = !wasActive && nowActive;
            HistAll("Subscription", (to is null ? "Subscription cleared" : $"Subscription {from:yyyy-MM-dd HH:mm} to {to:yyyy-MM-dd HH:mm} UTC") + (reactivated ? " (reactivated, playback stays OFF until turned ON)" : ""));
            if (reactivated && devices.Count > 0)
                await db.DeviceVideoConfigurations.Where(d => devices.Contains(d.DeviceCode)).ExecuteUpdateAsync(s => s.SetProperty(d => d.PlaybackEnabled, false), ct);
        }
        cfg.SubscriptionStartsAt = from; cfg.SubscriptionExpiresAt = to; cfg.AdminControlEnabled = req.AdminControlEnabled; cfg.ForcedOff = req.ForcedOff;
        cfg.AdminCanUpload = req.AdminCanUpload; cfg.AdminCanDeleteOwn = req.AdminCanDeleteOwn; cfg.UserCanView = req.UserCanView;
        cfg.UpdatedAt = DateTime.UtcNow; cfg.UpdatedByUserId = c.Id;
        if (req.ForcedOff && devices.Count > 0)
            await db.DeviceVideoConfigurations.Where(d => devices.Contains(d.DeviceCode)).ExecuteUpdateAsync(s => s.SetProperty(d => d.PlaybackEnabled, false), ct);
        await db.SaveChangesAsync(ct);
        log.LogInformation("AUDIT video settings of Admin {AdminId} ({Devices} devices) changed by SuperAdmin {UserId}", adminId, devices.Count, c.Id);
        return (await AdminsAsync(c, ct)).First(a => a.AdminId == adminId);
    }

    // ------------------------------------------------------------------ Raspberry Pi (device key, signed URLs)

    private bool KeyMatches(Device d, string? provided)
    {
        if (string.IsNullOrEmpty(provided) || d.ApiKeyHash is null) return false;
        var stored = Encoding.ASCII.GetBytes(d.ApiKeyHash);
        if (CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(JwtService.Hash(provided)), stored)) return true;
        return deviceAuth.Value.AcceptStoredHashAsKey && CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(provided.Trim().ToLowerInvariant()), stored);
    }

    private async Task<Device> DeviceByKeyAsync(string? code, string? key, CancellationToken ct)
    {
        var c = (code ?? "").Trim();
        var d = c.Length is 0 or > 64 ? null : await db.Devices.AsNoTracking().FirstOrDefaultAsync(x => x.DeviceId == c, ct);
        if (d is null || !KeyMatches(d, key)) throw ApiException.Unauthorized("Unknown device or invalid device key.");   // same answer for both: no device enumeration
        if (!d.IsActive) throw ApiException.Forbidden("Device is inactive.");
        return d;
    }

    private byte[] SigningKey() => SHA256.HashData(Encoding.UTF8.GetBytes("vayuvata-video-url|" + jwt.Value.Key));
    private string Sign(int videoId, string code, long exp) =>
        Convert.ToBase64String(HMACSHA256.HashData(SigningKey(), Encoding.UTF8.GetBytes($"{videoId}|{code}|{exp}"))).Replace('+', '-').Replace('/', '_').TrimEnd('=');

    /// <summary>What should this Raspberry Pi do right now: the authorization result and, when playback is allowed, the active video with a short-lived signed URL.</summary>
    public async Task<DeviceVideoActiveDto> ActiveForDeviceAsync(string? code, string? key, CancellationToken ct)
    {
        var d = await DeviceByKeyAsync(code, key, ct);
        var r = await ResolveAsync(d.DeviceId, ct);
        var v = r.ActiveVideoId is { } vid ? await db.VideoItems.AsNoTracking().FirstOrDefaultAsync(x => x.Id == vid && x.DeletedAt == null && x.ProcessingStatus == "Ready", ct) : null;
        var eff = Effective(r, v is not null);
        var dto = new DeviceVideoActiveDto { DeviceId = d.DeviceId, PlaybackAllowed = eff.Allowed, Reason = eff.Reason, PollAfterSeconds = _o.PollAfterSeconds, ServerTime = DateTime.UtcNow };
        if (eff.Allowed && v is not null)
        {
            var expires = DateTime.UtcNow.AddMinutes(Math.Max(1, _o.UrlMinutes));
            var exp = new DateTimeOffset(expires).ToUnixTimeSeconds();
            dto.Video = new DeviceVideoDto
            {
                Id = v.Id, FileName = v.FileName, SizeBytes = v.SizeBytes, ContentType = v.ContentType, Sha256 = v.Sha256, UrlExpiresAt = expires,
                Url = $"/api/v1/device-video/stream/{v.Id}?deviceId={Uri.EscapeDataString(d.DeviceId)}&exp={exp}&sig={Sign(v.Id, d.DeviceId, exp)}",
            };
        }
        return dto;
    }

    /// <summary>Authorizes one download of the active video: a valid signature (not expired) or the device key, AND playback must be allowed right now. Returns the file to send.</summary>
    public async Task<(string Path, string ContentType, string FileName)> StreamAsync(int videoId, string? code, long exp, string? sig, string? key, CancellationToken ct)
    {
        var v = await db.VideoItems.AsNoTracking().FirstOrDefaultAsync(x => x.Id == videoId && x.DeletedAt == null, ct) ?? throw ApiException.NotFound("Video not found.");
        var deviceCode = (code ?? "").Trim();
        if (deviceCode != v.DeviceCode) throw ApiException.Unauthorized("Invalid or expired video link.");
        if (!string.IsNullOrEmpty(key)) await DeviceByKeyAsync(deviceCode, key, ct);
        else
        {
            var valid = !string.IsNullOrEmpty(sig) && exp > DateTimeOffset.UtcNow.ToUnixTimeSeconds()
                        && CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Sign(videoId, deviceCode, exp)), Encoding.ASCII.GetBytes(sig));
            if (!valid) throw ApiException.Unauthorized("Invalid or expired video link.");
            var dev = await db.Devices.AsNoTracking().FirstOrDefaultAsync(x => x.DeviceId == deviceCode, ct);
            if (dev is null || !dev.IsActive) throw ApiException.Forbidden("Device is inactive.");
        }
        var r = await ResolveAsync(deviceCode, ct);
        var eff = Effective(r, r.ActiveVideoId == v.Id);
        if (!eff.Allowed || r.ActiveVideoId != v.Id) throw ApiException.Forbidden(eff.Reason ?? "This video is not the active video of the device.");
        var path = Path.GetFullPath(Path.Combine(Root(), v.FilePath));
        if (!path.StartsWith(Root(), StringComparison.OrdinalIgnoreCase) || !File.Exists(path)) throw ApiException.NotFound("The video file is not available.");
        return (path, v.ContentType, v.FileName);
    }

    private static readonly string[] States = ["Playing", "Stopped", "Downloading", "Error"];

    public async Task ReportStatusAsync(DeviceVideoStatusReport r, string? key, CancellationToken ct)
    {
        var d = await DeviceByKeyAsync(r.DeviceId, key, ct);
        if (!States.Contains(r.State)) throw ApiException.BadRequest("state must be one of: " + string.Join(", ", States) + ".", "validation_failed");
        var s = await db.VideoPlaybackStatuses.FirstOrDefaultAsync(x => x.DeviceCode == d.DeviceId, ct);
        var changed = s is null || s.State != r.State || s.VideoId != r.VideoId;
        if (s is null) { s = new VideoPlaybackStatus { DeviceCode = d.DeviceId }; db.VideoPlaybackStatuses.Add(s); }
        s.State = r.State; s.VideoId = r.VideoId; s.Message = r.Message is { Length: > 300 } ? r.Message[..300] : r.Message; s.ReportedAt = DateTime.UtcNow;
        if (changed) Hist(d.DeviceId, r.VideoId, null, "Device", "DeviceStatus", r.State != "Error", $"{r.State}{(string.IsNullOrWhiteSpace(r.Message) ? "" : ": " + s.Message)}");
        await db.SaveChangesAsync(ct);
    }
}
