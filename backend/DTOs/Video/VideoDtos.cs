namespace VayuVata.DTOs.Video;

public class VideoSubscriptionDto
{
    /// <summary>Active | NotStarted | Expired | NotSet (no subscription recorded)</summary>
    public string Status { get; set; } = "NotSet";
    /// <summary>Subscription period: From (null = from the beginning) and To.</summary>
    public DateTime? StartsAt { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public bool Active { get; set; }
    public string? Message { get; set; }
}

public class VideoDto
{
    public int Id { get; set; }
    public string DeviceId { get; set; } = "";
    public string FileName { get; set; } = "";
    public long SizeBytes { get; set; }
    public DateTime UploadedAt { get; set; }
    public string UploadedByName { get; set; } = "";
    public int UploadedByUserId { get; set; }
    public string ProcessingStatus { get; set; } = "Ready";
    /// <summary>This is the video the device plays.</summary>
    public bool IsActive { get; set; }
    /// <summary>Playing now (active video and playback authorised) | Ready | Blocked (why)</summary>
    public string PlaybackStatus { get; set; } = "Ready";
    /// <summary>Whether the CALLER may delete this video.</summary>
    public bool CanDelete { get; set; }
}

public class VideoCapabilitiesDto
{
    public bool CanView { get; set; }
    public bool CanUpload { get; set; }
    /// <summary>Why upload is not possible right now (subscription, permission), or null.</summary>
    public string? UploadBlockedReason { get; set; }
    public bool CanControlPlayback { get; set; }
    /// <summary>Shown to an Admin who cannot control playback: "Video playback control is currently managed by Super Admin."</summary>
    public string? ControlMessage { get; set; }
    /// <summary>Super Admin: change permissions, force OFF, subscription.</summary>
    public bool CanConfigure { get; set; }
}

public class VideoEffectiveDto
{
    /// <summary>The device may play its active video right now (subscription, Super Admin, playback ON, active video).</summary>
    public bool Allowed { get; set; }
    public string? Reason { get; set; }
}

public class VideoDeviceStatusDto
{
    public string State { get; set; } = "Stopped";
    public string? Message { get; set; }
    public DateTime ReportedAt { get; set; }
    public int? VideoId { get; set; }
}

/// <summary>Super Admin only.</summary>
public class VideoConfigDto
{
    /// <summary>Admin = the settings come from the device's owner Admin (edit them under Admin accounts). Device = the device has no owner Admin and has its own settings.</summary>
    public string Scope { get; set; } = "Device";
    public int? AdminId { get; set; }
    public string? AdminName { get; set; }
    public bool AdminControlEnabled { get; set; }
    /// <summary>Effective force-OFF (the Admin's or this device's).</summary>
    public bool ForcedOff { get; set; }
    /// <summary>Force-OFF set on this device alone.</summary>
    public bool DeviceForcedOff { get; set; }
    public bool AdminCanUpload { get; set; } = true;
    public bool AdminCanDeleteOwn { get; set; } = true;
    public bool UserCanView { get; set; }
}

public class VideoOverviewDto
{
    public string DeviceId { get; set; } = "";
    public string DeviceName { get; set; } = "";
    public VideoSubscriptionDto Subscription { get; set; } = new();
    public bool PlaybackEnabled { get; set; }
    public VideoEffectiveDto Effective { get; set; } = new();
    public int? ActiveVideoId { get; set; }
    public string? ActiveVideoName { get; set; }
    public VideoDeviceStatusDto? DeviceStatus { get; set; }
    public VideoCapabilitiesDto Capabilities { get; set; } = new();
    /// <summary>Super Admin only (null for everyone else).</summary>
    public VideoConfigDto? Config { get; set; }
    public int MaxSizeMb { get; set; }
    public string[] AllowedFormats { get; set; } = [];
}

public class UpdateVideoConfigRequest
{
    /// <summary>Subscription start (UTC). Null = from the beginning.</summary>
    public DateTime? SubscriptionStartsAt { get; set; }
    public bool AdminControlEnabled { get; set; }
    public bool ForcedOff { get; set; }
    public bool AdminCanUpload { get; set; } = true;
    public bool AdminCanDeleteOwn { get; set; } = true;
    public bool UserCanView { get; set; }
    /// <summary>End of the subscription (UTC). Null = no subscription. This is the complete state: send it every time.</summary>
    public DateTime? SubscriptionExpiresAt { get; set; }
}

/// <summary>Super Admin: the video settings of one Admin (client), listed with the devices that follow them.</summary>
public class AdminVideoSettingsDto
{
    public int AdminId { get; set; }
    public string AdminName { get; set; } = "";
    public string AdminEmail { get; set; } = "";
    public List<string> DeviceIds { get; set; } = [];
    public VideoSubscriptionDto Subscription { get; set; } = new();
    public VideoConfigDto Config { get; set; } = new();
}

public class SetPlaybackRequest { public bool Enabled { get; set; } }
public class SetActiveVideoRequest { public int VideoId { get; set; } }

public class VideoHistoryDto
{
    public long Id { get; set; }
    public DateTime At { get; set; }
    public string Action { get; set; } = "";
    public string Source { get; set; } = "";
    public string? UserName { get; set; }
    public int? VideoId { get; set; }
    public bool Success { get; set; }
    public string? Detail { get; set; }
}

// ------------------------------------------------------------------ Raspberry Pi

public class DeviceVideoDto
{
    public int Id { get; set; }
    public string FileName { get; set; } = "";
    public long SizeBytes { get; set; }
    public string ContentType { get; set; } = "";
    /// <summary>SHA-256 (hex) of the file, so the Pi can verify what it downloaded.</summary>
    public string Sha256 { get; set; } = "";
    /// <summary>Expiring, signed path of the file on this server (supports HTTP Range). Valid only while playback stays authorised.</summary>
    public string Url { get; set; } = "";
    public DateTime UrlExpiresAt { get; set; }
}

public class DeviceVideoActiveDto
{
    public string DeviceId { get; set; } = "";
    /// <summary>true = the device should play <c>video</c>. false = it must stop / not play, see <c>reason</c>.</summary>
    public bool PlaybackAllowed { get; set; }
    public string? Reason { get; set; }
    public DeviceVideoDto? Video { get; set; }
    public int PollAfterSeconds { get; set; }
    public DateTime ServerTime { get; set; }
}

public class DeviceVideoStatusReport
{
    public string DeviceId { get; set; } = "";
    public int? VideoId { get; set; }
    /// <summary>Playing | Stopped | Downloading | Error</summary>
    public string State { get; set; } = "Stopped";
    public string? Message { get; set; }
}
