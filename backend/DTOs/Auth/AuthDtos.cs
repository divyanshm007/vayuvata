namespace VayuVata.DTOs.Auth;

public class LoginRequest
{
    /// <example>admin@example.com</example>
    public string Email { get; set; } = "";
    /// <example>YourPassword1</example>
    public string Password { get; set; } = "";
}

public class LoginResponse
{
    public string AccessToken { get; set; } = "";
    public DateTime ExpiresAt { get; set; }
    public string RefreshToken { get; set; } = "";
    public DateTime RefreshTokenExpiresAt { get; set; }
    public int UserId { get; set; }
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public string Role { get; set; } = "";
}

public class RefreshRequest
{
    public string RefreshToken { get; set; } = "";
}

public class ProfileResponse
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public string Role { get; set; } = "";
    public int? ManagerId { get; set; }
    public bool IsActive { get; set; }
    public DateTime? LastLoginAt { get; set; }
}


/// <summary>
/// Password policy: 10-100 characters with at least one uppercase letter, one lowercase letter and one digit,
/// and different from the current password.
/// </summary>
public class ChangePasswordRequest
{
    /// <example>OldPassw0rd1</example>
    public string CurrentPassword { get; set; } = "";
    /// <example>NewPassw0rd2</example>
    public string NewPassword { get; set; } = "";
}
