namespace VayuVata.Models;

public class DeviceAssignment
{
    public int Id { get; set; }
    public int DeviceRecordId { get; set; }
    public Device Device { get; set; } = null!;
    public int UserId { get; set; }
    public User User { get; set; } = null!;
    public int AssignedByUserId { get; set; }
    public User AssignedBy { get; set; } = null!;
    public DateTime AssignedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UnassignedAt { get; set; }
    public bool IsActive { get; set; } = true;
    public string? Notes { get; set; }
}
