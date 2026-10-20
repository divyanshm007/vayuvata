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
    public List<ShellyCommand> Commands { get; set; } = [];
}

/// <summary>Audit trail: every ON/OFF request, who sent it, and what the Shelly Cloud answered. Insert-only.</summary>
public class ShellyCommand
{
    public long Id { get; set; }
    public int ShellyDeviceId { get; set; }
    public ShellyDevice ShellyDevice { get; set; } = null!;
    public int UserId { get; set; }
    public User User { get; set; } = null!;
    public bool TurnOn { get; set; }
    public bool Succeeded { get; set; }
    public string? Error { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
}
