namespace VayuVata.Models;

public class RefreshToken
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User User { get; set; } = null!;

    /// <summary>SHA-256 hex of the raw token. The raw token is never stored.</summary>
    public string TokenHash { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }

    /// <summary>All tokens descended from one login share a family; reuse of a rotated token revokes the whole family.</summary>
    public Guid FamilyId { get; set; } = Guid.NewGuid();
    /// <summary>Set when this token was exchanged for a new one (rotation). Null for logout/admin revocations.</summary>
    public int? ReplacedByTokenId { get; set; }

    public bool IsUsable(DateTime now) => RevokedAt == null && ExpiresAt > now;
}
