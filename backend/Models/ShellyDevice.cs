namespace VayuVata.Models;

/// <summary>
/// A Shelly smart switch (relay) controlled through the Shelly Cloud, optionally linked to ONE VayuVata device.
/// The cloud auth key is stored as plain text (owner's decision) and is never returned by the API (only its last 4 characters, to the SuperAdmin).
/// </summary>
public class ShellyDevice
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    /// <summary>The Shelly device id used by the cloud API, e.g. d0cf13cb84d4 (the MAC without separators).</summary>
    public string ShellyId { get; set; } = "";
    /// <summary>The Shelly Cloud "auth_key" of the account that owns the device.</summary>
    public string AuthKey { get; set; } = "";
    /// <summary>Cloud server of the account, e.g. shelly-277-eu.shelly.cloud (must end in .shelly.cloud).</summary>
    public string CloudHost { get; set; } = "";
    /// <summary>Switch channel (0 for a single-output device).</summary>
    public byte Channel { get; set; }
    /// <summary>The VayuVata device (Devices.DeviceId) this switch belongs to; null = not linked yet.</summary>
    public string? DeviceCode { get; set; }
    public Device? Device { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // ---- Device Configuration (SuperAdmin): daily schedule and override. Every switch has its own, independent settings.
    /// <summary>When true the backend switches this Shelly ON at <see cref="DailyOnTime"/> and OFF at <see cref="DailyOffTime"/> every day (India time).</summary>
    public bool ScheduleEnabled { get; set; }
    public TimeOnly? DailyOnTime { get; set; }
    public TimeOnly? DailyOffTime { get; set; }
    /// <summary>SuperAdmin override: while true an Admin cannot switch this Shelly and the daily schedule is paused. Stays until the SuperAdmin releases it.</summary>
    public bool OverrideActive { get; set; }
    public DateTime? OverrideSetAt { get; set; }
    public int? OverrideSetByUserId { get; set; }
    /// <summary>The (India) date on which the scheduled ON / OFF last ran, so each runs once a day and a restart never repeats it.</summary>
    public DateOnly? LastScheduleOnDate { get; set; }
    public DateOnly? LastScheduleOffDate { get; set; }
    public DateTime? ConfigUpdatedAt { get; set; }
    public int? ConfigUpdatedByUserId { get; set; }

    public List<ShellyCommand> Commands { get; set; } = [];
}

/// <summary>Audit trail: every ON/OFF request, who sent it, and what the Shelly Cloud answered. Insert-only.</summary>
public class ShellyCommand
{
    public long Id { get; set; }
    public int ShellyDeviceId { get; set; }
    public ShellyDevice ShellyDevice { get; set; } = null!;
    /// <summary>Who sent it; null for the automatic daily schedule.</summary>
    public int? UserId { get; set; }
    public User? User { get; set; }
    /// <summary>Manual | Schedule</summary>
    public string Source { get; set; } = "Manual";
    public bool TurnOn { get; set; }
    public bool Succeeded { get; set; }
    public string? Error { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
}
