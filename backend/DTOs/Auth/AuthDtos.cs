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

