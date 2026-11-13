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

    // ---- registration / approval / activation
    /// <summary>Mobile number (digits, optional leading +). Null for accounts created before registration existed.</summary>
    public string? Mobile { get; set; }
    /// <summary>When the owner proved ownership of the email by using the activation link and chose a password. Null for older accounts and for accounts not yet activated.</summary>
    public DateTime? EmailConfirmedAt { get; set; }
    /// <summary>When the Super Admin approved the account (public registration) or created it directly. Null for older accounts.</summary>
    public DateTime? ApprovedAt { get; set; }
    public int? ApprovedByUserId { get; set; }
    /// <summary>Public | Direct (null for older accounts).</summary>
    public string? Source { get; set; }

    public List<DeviceAssignment> Assignments { get; set; } = [];
}

