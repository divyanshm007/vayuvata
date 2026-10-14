using VayuVata.Helpers;

namespace VayuVata.DTOs.Devices;

public class CreateDeviceRequest
{
    /// <summary>Physical ESP32 identifier (letters, digits, dash, underscore, colon).</summary>
    /// <example>ESP32-A1B2C3</example>
    public string DeviceId { get; set; } = "";
    /// <example>Living room monitor</example>
    public string DeviceName { get; set; } = "";
    /// <example>Second floor, north wall</example>
    public string? Description { get; set; }
}

public class UpdateDeviceRequest
{
    /// <example>Living room monitor</example>
    public string DeviceName { get; set; } = "";
    public string? Description { get; set; }
}

public class SetDeviceStatusRequest
{
    /// <example>true</example>
    public bool IsActive { get; set; }
}

public class AssignDeviceRequest
{
    /// <example>3</example>
    public int UserId { get; set; }
    /// <example>Installed on 2026-10-11</example>
    public string? Notes { get; set; }
}

public class UnassignDeviceRequest
{
    public string? Notes { get; set; }
}

public class DeviceQuery : PageQuery
{
    public string? Search { get; set; }
    public bool? IsActive { get; set; }
    /// <summary>true = only assigned devices, false = only unassigned.</summary>
    public bool? Assigned { get; set; }
}

public class DeviceDto
{
    public int Id { get; set; }
    public string DeviceId { get; set; } = "";
    public string DeviceName { get; set; } = "";
    public string? Description { get; set; }
    public bool IsActive { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public int? AssignedUserId { get; set; }
    public string? AssignedUserName { get; set; }
    public DateTime? AssignedAt { get; set; }
}

/// <summary>Returned once on registration / key rotation. The raw key cannot be retrieved later.</summary>
public class DeviceWithKeyDto : DeviceDto
{
    public string ApiKey { get; set; } = "";
}

/// <summary>SuperAdmin only. The stored key hash; a device presents it as X-Device-Key when DeviceAuth:AcceptStoredHashAsKey is on.</summary>
public class DeviceKeyHashDto
{
    public int Id { get; set; }
    public string DeviceId { get; set; } = "";
    public string? ApiKeyHash { get; set; }
}

public class AssignmentDto
{
    public int Id { get; set; }
    public int DeviceRecordId { get; set; }
    public string DeviceId { get; set; } = "";
    public int UserId { get; set; }
    public string UserName { get; set; } = "";
    public int AssignedByUserId { get; set; }
    public string AssignedByName { get; set; } = "";
    public DateTime AssignedAt { get; set; }
    public DateTime? UnassignedAt { get; set; }
    public bool IsActive { get; set; }
    public string? Notes { get; set; }
}
