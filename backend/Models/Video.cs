namespace VayuVata.Models;

/// <summary>An uploaded video of one device (table dbo.VideoLibrary). The file lives on disk under <c>Video:StorageRoot</c>; only its path and details are in the database.</summary>
public class VideoItem
{
    public int Id { get; set; }
    /// <summary>The device this video belongs to (Devices.DeviceId, e.g. Vayu_004).</summary>
    public string DeviceCode { get; set; } = "";
    public Device Device { get; set; } = null!;
    /// <summary>Original file name as uploaded (cleaned of path parts and control characters).</summary>
    public string FileName { get; set; } = "";
    /// <summary>Name on disk (a random GUID + the extension): the uploaded name never reaches the file system.</summary>
    public string StoredFileName { get; set; } = "";
    /// <summary>Storage location, relative to <c>Video:StorageRoot</c>: "{deviceCode}/{StoredFileName}".</summary>
    public string FilePath { get; set; } = "";
    public string ContentType { get; set; } = "video/mp4";
    public long SizeBytes { get; set; }
    public string Sha256 { get; set; } = "";
    public int UploadedByUserId { get; set; }
    public User UploadedBy { get; set; } = null!;
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
    /// <summary>Ready (stored and checked). Failed uploads are not kept.</summary>
    public string ProcessingStatus { get; set; } = "Ready";
    /// <summary>Soft delete: the file is removed from disk at once; the row stays for the history.</summary>
    public DateTime? DeletedAt { get; set; }
    public int? DeletedByUserId { get; set; }
}

/// <summary>Video settings of one device (dbo.DeviceVideoConfiguration). Created on first use; a device without a row has the defaults (everything off, no subscription).</summary>
public class DeviceVideoConfiguration
{
    public string DeviceCode { get; set; } = "";
    public Device Device { get; set; } = null!;
    /// <summary>Playback ON for this device. Only effective while the subscription is active, the video is not forced off, and an active video exists.</summary>
    public bool PlaybackEnabled { get; set; }
    /// <summary>Admin Video Control Permission: while true an Admin may turn playback ON/OFF for this device. The Super Admin always may.</summary>
    public bool AdminControlEnabled { get; set; }
    /// <summary>Super Admin force-OFF: playback is off and only the Super Admin can lift it.</summary>
    public bool ForcedOff { get; set; }
    /// <summary>Subscription period of a device that has NO owner Admin (UTC). For a device owned by an Admin the Admin's own settings (<see cref="AdminVideoConfiguration"/>) apply instead.</summary>
    public DateTime? SubscriptionStartsAt { get; set; }
    /// <summary>End of the subscription (UTC). NULL = no subscription recorded. Upload and playback work only between the start and this date.</summary>
    public DateTime? SubscriptionExpiresAt { get; set; }
    /// <summary>The video the device plays.</summary>
    public int? ActiveVideoId { get; set; }
    public VideoItem? ActiveVideo { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public int? UpdatedByUserId { get; set; }
}

/// <summary>
/// Video settings of ONE Admin (the client), dbo.AdminVideoConfiguration. Every device that belongs to the Admin (assigned to the Admin or to one of the Admin's Users) follows these:
/// the subscription period, the Admin Video Control Permission, force-OFF and the upload / delete / view permissions. Admins never affect each other.
/// </summary>
public class AdminVideoConfiguration
{
    public int AdminUserId { get; set; }
    public User AdminUser { get; set; } = null!;
    /// <summary>Subscription start (UTC); NULL = from the beginning.</summary>
    public DateTime? SubscriptionStartsAt { get; set; }
    /// <summary>Subscription end (UTC); NULL = no subscription recorded.</summary>
    public DateTime? SubscriptionExpiresAt { get; set; }
    public bool AdminControlEnabled { get; set; }
    /// <summary>Super Admin force-OFF for ALL devices of this Admin.</summary>
    public bool ForcedOff { get; set; }
    public bool AdminCanUpload { get; set; } = true;
    public bool AdminCanDeleteOwn { get; set; } = true;
    public bool UserCanView { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public int? UpdatedByUserId { get; set; }
}

/// <summary>Who may do what with the videos of a device (dbo.VideoAccessPermission). Set by the Super Admin.</summary>
public class VideoAccessPermission
{
    public string DeviceCode { get; set; } = "";
    public Device Device { get; set; } = null!;
    public bool AdminCanUpload { get; set; } = true;
    public bool AdminCanDeleteOwn { get; set; } = true;
    /// <summary>Users of the device may see the video list (view only).</summary>
    public bool UserCanView { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public int? UpdatedByUserId { get; set; }
}

/// <summary>The last playback state the device itself reported (dbo.VideoPlaybackStatus).</summary>
public class VideoPlaybackStatus
{
    public string DeviceCode { get; set; } = "";
    public Device Device { get; set; } = null!;
    public int? VideoId { get; set; }
    /// <summary>Playing | Stopped | Downloading | Error</summary>
    public string State { get; set; } = "Stopped";
    public string? Message { get; set; }
    public DateTime ReportedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Insert-only trail of every video action: who, what, on which device and video, and whether it worked (dbo.VideoCommandHistory).</summary>
public class VideoCommandHistory
{
    public long Id { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
    public string DeviceCode { get; set; } = "";
    public int? VideoId { get; set; }
    /// <summary>The person; null when the device or the system acted.</summary>
    public int? UserId { get; set; }
    public User? User { get; set; }
    /// <summary>User | Device | System</summary>
    public string Source { get; set; } = "User";
    /// <summary>Upload | Delete | PlaybackOn | PlaybackOff | ForceOff | ForceOffLifted | SetActive | AdminControl | Permissions | Subscription | DeviceStatus | Blocked</summary>
    public string Action { get; set; } = "";
    public bool Success { get; set; } = true;
    public string? Detail { get; set; }
}
