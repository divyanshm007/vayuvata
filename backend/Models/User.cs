namespace VayuVata.Models;

public static class Roles
{
    public const string SuperAdmin = "SuperAdmin";
    public const string Admin = "Admin";
    public const string User = "User";

    public static readonly string[] All = [SuperAdmin, Admin, User];
}

public class User
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string Role { get; set; } = Roles.User;

    /// <summary>Manager of a regular User: an Admin (Admin-managed) or the SuperAdmin (standalone). NULL for SuperAdmin and Admin accounts.</summary>
    public int? ManagerId { get; set; }
    public User? Manager { get; set; }

    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    public DateTime? LastLoginAt { get; set; }

    /// <summary>Consecutive failed password attempts within the lockout window (reset on success).</summary>
    public int FailedLoginCount { get; set; }
    public DateTime? LastFailedLoginAt { get; set; }
    /// <summary>While in the future, login is refused (temporary lockout; expires on its own).</summary>
    public DateTime? LockoutUntil { get; set; }

    public List<DeviceAssignment> Assignments { get; set; } = [];
}

