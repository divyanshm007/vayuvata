namespace VayuVata.Models;

public class Device
{
    /// <summary>Database surrogate key. Not the physical identifier.</summary>
    public int Id { get; set; }

    /// <summary>Physical ESP32 identifier (unique). Referenced by SensorData.device_id.</summary>
    public string DeviceId { get; set; } = "";
    public string DeviceName { get; set; } = "";
    public string? Description { get; set; }

    /// <summary>SHA-256 hex of the device API key. The raw key is never stored.</summary>
    public string? ApiKeyHash { get; set; }

    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public List<DeviceAssignment> Assignments { get; set; } = [];
}
