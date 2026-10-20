namespace VayuVata.DTOs.Shelly;

public class ShellyDeviceDto
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string ShellyId { get; set; } = "";
    public string CloudHost { get; set; } = "";
    public byte Channel { get; set; }
    /// <summary>The linked VayuVata device (e.g. Vayu_004), or null.</summary>
    public string? DeviceId { get; set; }
    public string? DeviceName { get; set; }
    public bool IsActive { get; set; }
    /// <summary>Last 4 characters of the auth key, shown to the SuperAdmin only so a key can be recognised. The full key is never returned.</summary>
    public string? AuthKeyHint { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? LastCommandAt { get; set; }
    public bool? LastCommandOn { get; set; }
    public string? LastCommandBy { get; set; }
}

public class CreateShellyRequest
{
    /// <summary>Display name, e.g. "Vayu_004 power switch".</summary>
    public string Name { get; set; } = "";
    /// <summary>Shelly device id, e.g. d0cf13cb84d4.</summary>
    public string ShellyId { get; set; } = "";
    /// <summary>Shelly Cloud auth_key.</summary>
    public string AuthKey { get; set; } = "";
    /// <summary>Optional; defaults to the server's default Shelly Cloud host. Must end in .shelly.cloud.</summary>
    public string? CloudHost { get; set; }
    public byte Channel { get; set; }
    /// <summary>VayuVata device to link, e.g. Vayu_004 (optional).</summary>
    public string? DeviceId { get; set; }
}

public class UpdateShellyRequest
{
    public string Name { get; set; } = "";
    public string? CloudHost { get; set; }
    public byte Channel { get; set; }
    /// <summary>Linked VayuVata device; null or empty removes the link.</summary>
    public string? DeviceId { get; set; }
    /// <summary>Only sent to replace the key; null or empty keeps the current one.</summary>
    public string? AuthKey { get; set; }
    public bool IsActive { get; set; } = true;
}

public class SwitchRequest
{
    public bool On { get; set; }
}

public class ShellyStatusDto
{
    public int Id { get; set; }
    /// <summary>true when the Shelly Cloud says the switch is connected.</summary>
    public bool Online { get; set; }
    /// <summary>Output state: true = ON. Null when the device is offline or did not report it.</summary>
    public bool? On { get; set; }
    public decimal? PowerW { get; set; }
    public decimal? VoltageV { get; set; }
    public decimal? CurrentA { get; set; }
    public decimal? TemperatureC { get; set; }
    public int? WifiRssi { get; set; }
    public string? Ssid { get; set; }
    public decimal? EnergyTotalWh { get; set; }
    /// <summary>When the cloud last heard from the device (as the cloud reports it).</summary>
    public string? CloudUpdatedAt { get; set; }
    public DateTime CheckedAt { get; set; }
}

public class SwitchResultDto
{
    public bool Ok { get; set; }
    public bool On { get; set; }
    public string Message { get; set; } = "";
}

public class ShellyCommandDto
{
    public long Id { get; set; }
    public bool TurnOn { get; set; }
    public bool Succeeded { get; set; }
    public string? Error { get; set; }
    public string UserName { get; set; } = "";
    public DateTime At { get; set; }
}
